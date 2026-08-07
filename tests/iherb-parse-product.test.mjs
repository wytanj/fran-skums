/**
 * iHerb PDP parser, plus a second catalogue to prove the first was not a fluke.
 *
 * Two fixtures, both real captures from the warm profile:
 *   sample-iherb-skin1004.html     a second brand catalogue (41 products, 1 page)
 *   skin1004-product-page.html     one product detail page
 *
 * The cross-check at the bottom is the valuable one: SIO-26111 appears in both,
 * so the two parsers can be validated against each other rather than against my
 * expectations of them.
 *
 * @see marketplace/iherb/parseProduct.mjs
 * @see marketplace/iherb/parseCatalogue.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseIherbCatalogue } from '../marketplace/iherb/parseCatalogue.mjs'
import {
  availabilityToInStock,
  parseIherbProduct,
  parseProductBreadcrumb,
} from '../marketplace/iherb/parseProduct.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOGUE = join(root, 'extensions/sample-iherb-skin1004.html')
const PDP = join(root, 'extensions/skin1004-product-page.html')
const has = existsSync(CATALOGUE) && existsSync(PDP)

const catalogue = has
  ? parseIherbCatalogue(readFileSync(CATALOGUE, 'utf8'), { url: 'https://sg.iherb.com/c/skin1004' })
  : null
const pdp = has ? parseIherbProduct(readFileSync(PDP, 'utf8')) : null

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('availability maps to a tri-state, never guessing false', () => {
  assert.equal(availabilityToInStock('https://schema.org/InStock'), true)
  assert.equal(availabilityToInStock('https://schema.org/OutOfStock'), false)
  assert.equal(availabilityToInStock('https://schema.org/LimitedAvailability'), true)
  // Unknown must stay null — a false here would read as a real stockout.
  assert.equal(availabilityToInStock('https://schema.org/PreOrder'), null)
  assert.equal(availabilityToInStock(''), null)
  assert.equal(availabilityToInStock(null), null)
})

test('the "Categories" crumb is dropped as site structure', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'BreadcrumbList',
    itemListElement: [
      { position: 1, item: { name: 'Categories' } },
      { position: 2, item: { name: 'Beauty' } },
      { position: 3, item: { name: 'Cleansers' } },
    ],
  })}</script>`
  const b = parseProductBreadcrumb(html)
  assert.deepEqual(b.path, ['Beauty', 'Cleansers'])
  assert.equal(b.leaf, 'Cleansers')
})

test('a page with no Product block says so instead of returning empty data', () => {
  const r = parseIherbProduct('<html><body>Access Denied</body></html>')
  assert.equal(r.found, false)
  assert.match(r.reason, /bot wall|not a product page/i)
})

// ---------------------------------------------------------------------------
// Second catalogue — does the parser generalise?
// ---------------------------------------------------------------------------

test('fixtures are present', () => {
  assert.ok(has, 'missing SKIN1004 fixtures — re-capture with the iHerb probe extension')
})

test('a different brand catalogue parses cleanly', { skip: !has }, () => {
  // Anua was 48 across 2 pages; SKIN1004 is 41 on one. Different shape, same parser.
  assert.equal(catalogue.coverage.products, 41)
  assert.equal(catalogue.coverage.with_price, 41)
  assert.equal(catalogue.coverage.with_rating, 41)
  assert.equal(catalogue.coverage.with_sold, 30)
  assert.equal(catalogue.coverage.out_of_stock, 2)
  assert.deepEqual(catalogue.coverage.currencies, ['SGD'])
  assert.equal(catalogue.products.filter((p) => !p.name || p.price == null).length, 0)
})

test('a single-page catalogue reports no next page and page 1', { skip: !has }, () => {
  // This page carries one stray "?p=0", which used to surface as max_page_seen: 0
  // — a page count that cannot exist.
  assert.equal(catalogue.pagination.next_url, null)
  assert.equal(catalogue.pagination.max_page_seen, 1)
  assert.equal(catalogue.pagination.is_last_page, true)
})

test('brand identity is consistent across every row', { skip: !has }, () => {
  const brands = new Set(catalogue.products.map((p) => p.brand_name))
  assert.deepEqual([...brands], ['SKIN1004'])
  const codes = catalogue.products.map((p) => p.part_number)
  assert.equal(new Set(codes).size, codes.length)
  for (const c of codes) assert.match(c, /^SIO-\d+$/)
})

// ---------------------------------------------------------------------------
// PDP
// ---------------------------------------------------------------------------

test('the PDP yields a full structured product', { skip: !has }, () => {
  assert.equal(pdp.found, true)
  assert.equal(pdp.product_id, '108337')
  assert.equal(pdp.part_number, 'SIO-26111')
  assert.equal(pdp.name, 'SKIN1004, Madagascar Centella Light Cleansing Oil, 6.76 fl oz (200 ml)')
  assert.equal(pdp.price, 27.96)
  assert.equal(pdp.currency, 'SGD')
  assert.equal(pdp.in_stock, true)
})

test('the PDP carries a barcode the catalogue page does not', { skip: !has }, () => {
  // A GTIN is a non-fuzzy identifier — the only one available for joining to
  // another channel or to our own identity spine.
  assert.equal(pdp.gtin, '8809576261110')
  const row = catalogue.products.find((p) => p.part_number === 'SIO-26111')
  assert.ok(row, 'expected the same product in the catalogue')
  assert.equal(row.gtin, undefined, 'catalogue rows have no GTIN — that is why the PDP pass exists')
})

test('the PDP breadcrumb is a real category path, not brand navigation', { skip: !has }, () => {
  // The catalogue page only exposes "Brands A-Z > SKIN1004". This is the
  // taxonomy equivalent of Shopee MH-4, and it costs one navigation per product.
  assert.deepEqual(pdp.breadcrumb.path, ['Beauty', 'Cleansers', 'Face Washes'])
  assert.equal(pdp.breadcrumb.leaf, 'Face Washes')
  assert.equal(pdp.breadcrumb.scope, 'platform_category')
  assert.equal(catalogue.breadcrumb.scope, 'brand_navigation')
})

test('the PDP adds weight for pack-size normalisation', { skip: !has }, () => {
  assert.equal(pdp.weight_value, 0.54)
  assert.equal(pdp.weight_unit, 'kg')
})

test('the PDP still captures the 30-day sold text', { skip: !has }, () => {
  // It is rendered text, not part of the payload — a PDP-only pass would
  // otherwise lose the one field that measures demand.
  assert.equal(pdp.sold_label, '2,000+ sold in 30 days')
})

// ---------------------------------------------------------------------------
// The two parsers must agree
// ---------------------------------------------------------------------------

test('catalogue and PDP agree on the same product', { skip: !has }, () => {
  // Two independent extraction routes — data-ga-* attributes vs schema.org
  // payload — reading the same product. A disagreement means one of them is
  // reading the wrong element, which is exactly the failure a fixture cannot
  // otherwise catch.
  const row = catalogue.products.find((p) => p.part_number === pdp.part_number)
  assert.ok(row)
  assert.equal(row.product_id, pdp.product_id)
  assert.equal(row.name, pdp.name)
  assert.equal(row.price, pdp.price)
  assert.equal(row.currency, pdp.currency)
  assert.equal(row.rating, pdp.rating)
  assert.equal(row.review_count, pdp.review_count)
  assert.equal(row.in_stock, pdp.in_stock)
  assert.equal(row.sold_label, pdp.sold_label)
  assert.equal(row.brand_name, pdp.brand_name)
  assert.equal(row.brand_id, pdp.brand_id)
})
