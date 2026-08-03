/**
 * MH-14 sales harvest: the month-vs-lifetime distinction.
 *
 * Two grids report "sold" and they do not mean the same thing. The Mall shop
 * grid shows a cumulative lifetime bucket ("1.2k sold"); the keyword SERP under
 * sortBy=sales shows a rate ("517 Sold/Month"). Averaging one into the other
 * produces confident nonsense — this is the same class of bug that once let a
 * title containing "100M Sold" make banila-co the top seller in every rollup.
 *
 * These tests pin the period tag that keeps them apart, and the URL + card
 * plumbing that carries it.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { detectSoldPeriod, parseSoldLabel } from '../marketplace/soldLabel.mjs'
import { shopeeSearchUrl } from '../marketplace/shopee/urls.mjs'
import { harvestToObservationCards } from '../marketplace/shopProductExtract.mjs'

// ---------------------------------------------------------------------------
// detectSoldPeriod
// ---------------------------------------------------------------------------

test('a monthly label is tagged month, not lifetime', () => {
  // The exact strings the sortBy=sales SERP renders.
  assert.equal(detectSoldPeriod('517 Sold/Month'), 'month')
  assert.equal(detectSoldPeriod('517 sold / month'), 'month')
  assert.equal(detectSoldPeriod('1.2k Sold/mo'), 'month')
  assert.equal(detectSoldPeriod('Monthly Sales 340'), 'month')
})

test('a plain sold label is tagged lifetime', () => {
  assert.equal(detectSoldPeriod('1.2k sold'), 'lifetime')
  assert.equal(detectSoldPeriod('4k+ Sold'), 'lifetime')
})

test('no sold wording yields no period rather than a guess', () => {
  // Guessing here is what mixes the two buckets. Null must stay null.
  assert.equal(detectSoldPeriod(''), null)
  assert.equal(detectSoldPeriod('   '), null)
  assert.equal(detectSoldPeriod(null), null)
  assert.equal(detectSoldPeriod('Free shipping'), null)
})

// ---------------------------------------------------------------------------
// parseSoldLabel carries the period alongside the number
// ---------------------------------------------------------------------------

test('a monthly figure parses to its number AND keeps the month tag', () => {
  const parsed = parseSoldLabel('517 Sold/Month')
  assert.equal(parsed.lower_bound, 517)
  assert.equal(parsed.period, 'month')
  // Raw label retained so an operator can audit the reading.
  assert.equal(parsed.label, '517 Sold/Month')
})

test('the /month suffix does not corrupt the number', () => {
  // "sold" and "/month" are stripped before the k/M matchers run; a naive
  // strip would leave a stray digit or drop the multiplier.
  assert.equal(parseSoldLabel('1.2k Sold/Month').lower_bound, 1200)
  assert.equal(parseSoldLabel('2.5M sold/month').lower_bound, 2_500_000)
})

test('lifetime labels are unchanged and tagged lifetime', () => {
  const parsed = parseSoldLabel('4.5k+ sold')
  assert.equal(parsed.lower_bound, 4500)
  assert.equal(parsed.is_bucket, true)
  assert.equal(parsed.period, 'lifetime')
})

test('an unparseable label reports no number and no period claim', () => {
  const parsed = parseSoldLabel('Free shipping')
  assert.equal(parsed.lower_bound, null)
  assert.equal(parsed.period, null)
})

test('period is present on every return path', () => {
  // Downstream reads .period unconditionally; an undefined here would be
  // indistinguishable from "lifetime" after a JSON round trip.
  for (const input of [null, '', 'nonsense', '12 sold', '12 Sold/Month']) {
    assert.ok('period' in parseSoldLabel(input), `missing period for ${JSON.stringify(input)}`)
  }
})

// ---------------------------------------------------------------------------
// Keyword SERP URL
// ---------------------------------------------------------------------------

test('sortBy=sales reaches the URL — that is what selects the Top Sales grid', () => {
  assert.equal(
    shopeeSearchUrl('biodance', 'sg', 0, { sortBy: 'sales' }),
    'https://shopee.sg/search?keyword=biodance&page=0&sortBy=sales',
  )
})

test('page is always explicit, including page 0', () => {
  // Changed behaviour: the old form omitted &page= on page 0. Pinned because
  // operators paste these URLs and compare them to what the harvester logged.
  assert.equal(
    shopeeSearchUrl('anua official', 'sg', 0),
    'https://shopee.sg/search?keyword=anua%20official&page=0',
  )
  assert.equal(
    shopeeSearchUrl('anua official', 'sg', 1),
    'https://shopee.sg/search?keyword=anua%20official&page=1',
  )
})

test('a blank or absent sortBy adds no parameter', () => {
  for (const sortBy of [null, undefined, '', '   ']) {
    const url = shopeeSearchUrl('anua', 'sg', 0, { sortBy })
    assert.ok(!url.includes('sortBy'), `sortBy leaked for ${JSON.stringify(sortBy)}`)
  }
})

test('negative and junk page values floor to 0 instead of reaching Shopee', () => {
  assert.match(shopeeSearchUrl('anua', 'sg', -3), /[?&]page=0/)
  assert.match(shopeeSearchUrl('anua', 'sg', Number.NaN), /[?&]page=0/)
})

// ---------------------------------------------------------------------------
// Card plumbing — the period and price must survive into signals
// ---------------------------------------------------------------------------

function harvestFixture(product) {
  return {
    shop_username: 'biodanceofficial',
    shop_collection_name: 'Serums',
    harvest_source: 'mall_list_harvest',
    products: [product],
  }
}

test('sold_period reaches the snapshot signals', () => {
  const [card] = harvestToObservationCards(
    harvestFixture({
      name: 'Biodance Collagen Mask',
      url: 'https://shopee.sg/x-i.1.2',
      sold_label: '517 Sold/Month',
      sold_count_lower_bound: 517,
      sold_period: 'month',
    }),
    { brand_key: 'biodance' },
  )
  // Without this, a monthly reading lands in the same column as lifetime
  // totals and every WoW comparison downstream is wrong.
  assert.equal(card.signals.sold_period, 'month')
  assert.equal(card.sold_count_lower_bound, 517)
})

test('a card with no period carries no sold_period key at all', () => {
  const [card] = harvestToObservationCards(
    harvestFixture({
      name: 'Biodance Collagen Mask',
      url: 'https://shopee.sg/x-i.1.2',
      sold_label: '1.2k sold',
      sold_count_lower_bound: 1200,
    }),
    { brand_key: 'biodance' },
  )
  // Absent rather than null: a null would read as "we checked and there is no
  // period", which is a different claim from "this harvest never tagged one".
  assert.ok(!('sold_period' in card.signals))
})

test('price and original_price are numbers on the card, not strings', () => {
  const [card] = harvestToObservationCards(
    harvestFixture({
      name: 'Biodance Collagen Mask',
      url: 'https://shopee.sg/x-i.1.2',
      price: '18.90',
      original_price: '32.00',
    }),
    { brand_key: 'biodance' },
  )
  assert.equal(card.price, 18.9)
  assert.equal(card.original_price, 32)
})

test('a missing price stays undefined rather than becoming 0', () => {
  // 0 would be a real price and would drag every average down.
  const [card] = harvestToObservationCards(
    harvestFixture({ name: 'X', url: 'https://shopee.sg/x-i.1.2' }),
    { brand_key: 'biodance' },
  )
  assert.equal(card.price, undefined)
  assert.equal(card.original_price, undefined)
})
