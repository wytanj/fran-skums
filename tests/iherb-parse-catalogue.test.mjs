/**
 * iHerb catalogue parser, tested against the real captured page.
 *
 * extensions/sample-iherb-anua.html is a genuine capture from the warm profile —
 * iHerb 403s every non-browser request, so this fixture is the only way these
 * assertions can be trusted. It is checked in for exactly that reason: a future
 * selector break has to be reproducible offline.
 *
 * @see marketplace/iherb/parseCatalogue.mjs
 * @see docs/IHERB_COLLECT_DESIGN.md
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  currencyFromPriceText,
  parseBreadcrumb,
  parseIherbCatalogue,
  parsePagination,
  parseRatingTitle,
} from '../marketplace/iherb/parseCatalogue.mjs'
import { detectSoldPeriod, parseSoldLabel } from '../marketplace/soldLabel.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = join(root, 'extensions/sample-iherb-anua.html')
const hasFixture = existsSync(FIXTURE)
const html = hasFixture ? readFileSync(FIXTURE, 'utf8') : ''
const parsed = hasFixture ? parseIherbCatalogue(html, { url: 'https://sg.iherb.com/c/anua' }) : null

// ---------------------------------------------------------------------------
// Pure helpers — run with or without the fixture
// ---------------------------------------------------------------------------

test('rating and review count come out of one title attribute', () => {
  // This is why the probe reported both missing: nothing is in the element text.
  assert.deepEqual(parseRatingTitle('4.7/5 - 7,354 Reviews'), { rating: 4.7, review_count: 7354 })
  assert.deepEqual(parseRatingTitle('4.5/5 - 18,407 Reviews'), { rating: 4.5, review_count: 18407 })
  assert.deepEqual(parseRatingTitle(''), { rating: null, review_count: null })
  assert.deepEqual(parseRatingTitle('no stars here'), { rating: null, review_count: null })
})

test('currency is read from the tile price, never a page banner', () => {
  // The probe matched a bare "$30.00" free-shipping banner and concluded nothing.
  assert.equal(currencyFromPriceText('SG$17.31'), 'SGD')
  assert.equal(currencyFromPriceText('US$12.00'), 'USD')
  assert.equal(currencyFromPriceText('$30.00'), null)
  assert.equal(currencyFromPriceText(null), null)
})

test('"sold in 30 days" is a rate, and is tagged as one', () => {
  // The headline difference from Shopee, whose sold count is cumulative lifetime.
  assert.equal(detectSoldPeriod('4,000+ sold in 30 days'), 'month')
  assert.equal(detectSoldPeriod('750+ sold in 30 days'), 'month')
  const p = parseSoldLabel('4,000+ sold in 30 days')
  assert.equal(p.lower_bound, 4000)
  assert.equal(p.is_bucket, true)
  assert.equal(p.period, 'month')
})

test('a plain Shopee-style sold label is still lifetime', () => {
  // The 30-day rule must not reclassify everything as a rate.
  assert.equal(detectSoldPeriod('1.2k sold'), 'lifetime')
  assert.equal(parseSoldLabel('4.5k+ sold').period, 'lifetime')
})

// ---------------------------------------------------------------------------
// Against the captured page
// ---------------------------------------------------------------------------

test('fixture is present', () => {
  assert.ok(hasFixture, `missing ${FIXTURE} — re-capture with the iHerb probe extension`)
})

test('every product tile on the page is parsed', { skip: !hasFixture }, () => {
  // 48 is a full iHerb grid. A silent drop to a handful is the failure mode this
  // whole fixture exists to catch.
  assert.equal(parsed.coverage.products, 48)
  assert.equal(parsed.products.length, 48)
})

test('no row is missing a name or a price', { skip: !hasFixture }, () => {
  const bad = parsed.products.filter((p) => !p.name || p.price == null)
  assert.deepEqual(bad.map((p) => p.part_number), [])
})

test('identity comes from the GA attributes, not the URL', { skip: !hasFixture }, () => {
  const first = parsed.products[0]
  assert.equal(first.product_id, '131859')
  assert.equal(first.part_number, 'AUU-73442')
  assert.equal(first.brand_name, 'Anua')
  assert.equal(first.brand_id, 'AUU')
  assert.match(first.url, /^https:\/\/sg\.iherb\.com\/pr\//)
})

test('price is numeric, with list price and discount alongside', { skip: !hasFixture }, () => {
  const first = parsed.products[0]
  assert.equal(first.price, 17.31)
  assert.equal(first.list_price, 17.31)
  assert.equal(first.discount_pct, 0)
  assert.equal(first.currency, 'SGD')
  // Numeric, not a string with a glyph — data-ga-discount-price is already typed.
  for (const p of parsed.products) assert.equal(typeof p.price, 'number', p.part_number)
})

test('rating and reviews resolve for every tile', { skip: !hasFixture }, () => {
  assert.equal(parsed.coverage.with_rating, 48)
  const first = parsed.products[0]
  assert.equal(first.rating, 4.7)
  assert.equal(first.review_count, 7354)
})

test('sold is present on some tiles and absent on others, and that is reported', { skip: !hasFixture }, () => {
  // 34 of 48. Absence means below iHerb's display floor, NOT zero sales — the
  // coverage number is what stops a reader treating the 14 as no demand.
  assert.equal(parsed.coverage.with_sold, 34)
  assert.ok(parsed.coverage.with_sold < parsed.coverage.products)
  const sold = parsed.products.filter((p) => p.sold_lower_bound != null)
  for (const p of sold) {
    assert.equal(p.sold_period, 'month', p.part_number)
    assert.equal(p.sold_is_bucket, true, p.part_number)
  }
})

test('sold is never flattened to a bare number', { skip: !hasFixture }, () => {
  // A 4000 with no period next to a Shopee 4000 would be a lie by omission.
  const p = parsed.products.find((x) => x.sold_lower_bound != null)
  assert.ok(p.sold_label.includes('30 days'))
  assert.equal(p.sold_period, 'month')
  assert.equal(parsed.coverage.sold_period, 'month')
})

test('stock, discontinued and sponsored are captured', { skip: !hasFixture }, () => {
  assert.equal(parsed.coverage.out_of_stock, 4)
  // Sponsored rows are paid placement; counting them as organic rank is wrong.
  assert.equal(parsed.coverage.sponsored, 0)
  for (const p of parsed.products) assert.equal(typeof p.is_sponsored, 'boolean')
})

test('grid position is kept so rank is not inferred from array order', { skip: !hasFixture }, () => {
  assert.equal(parsed.products[0].position, 1)
  assert.equal(parsed.products[1].position, 2)
})

test('the page currency is consistent', { skip: !hasFixture }, () => {
  // A mixed page means the session flipped locale mid-scroll — that run's prices
  // cannot be trusted into an SGD column.
  assert.deepEqual(parsed.coverage.currencies, ['SGD'])
  assert.equal(parsed.coverage.currency_consistent, true)
})

test('breadcrumb is brand navigation, and says so', { skip: !hasFixture }, () => {
  // "Brands A-Z > Anua" is not a product category. Treating it as the equivalent
  // of Shopee's MH-4 platform path would be wrong — that needs a PDP visit each.
  assert.deepEqual(parsed.breadcrumb.path, ['Brands A-Z', 'Anua'])
  assert.equal(parsed.breadcrumb.scope, 'brand_navigation')
})

test('pagination exposes the next page', { skip: !hasFixture }, () => {
  assert.equal(parsed.pagination.next_url, 'https://sg.iherb.com/c/anua?p=2')
  assert.ok(parsed.pagination.max_page_seen >= 2)
})

test('part numbers are unique — no tile counted twice', { skip: !hasFixture }, () => {
  // .product-inner matches 88 elements on this page against 48 real products;
  // splitting on the wrong container would silently double every count.
  const codes = parsed.products.map((p) => p.part_number)
  assert.equal(new Set(codes).size, codes.length)
})

test('parsing an empty or junk page yields nothing rather than throwing', () => {
  for (const input of ['', '<html><body>Access Denied</body></html>', null]) {
    const r = parseIherbCatalogue(input)
    assert.equal(r.products.length, 0)
    assert.equal(r.coverage.products, 0)
  }
})

test('breadcrumb and pagination degrade quietly on a junk page', () => {
  assert.equal(parseBreadcrumb('<html></html>'), null)
  assert.deepEqual(parsePagination('<html></html>'), { next_url: null, max_page_seen: 1 })
})
