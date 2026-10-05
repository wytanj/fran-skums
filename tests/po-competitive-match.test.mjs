import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  MATCH_COLUMNS,
  barcodeLookupKeys,
  buildMatchCatalog,
  dateSeen,
  matchPoLines,
  matchStats,
  newestPricedObservation,
  parseCsv,
  renderMatchCsv,
  resolveBrandKey,
  buildAliasIndex,
} from '../marketplace/poCompetitiveMatch.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const UPC = '036000291452'
const EAN = '0036000291452'

test('12-digit UPC and 13-digit EAN with a leading 0 are one barcode', () => {
  assert.deepEqual(barcodeLookupKeys(UPC).sort(), [EAN, UPC].sort())
  assert.deepEqual(barcodeLookupKeys(EAN).sort(), barcodeLookupKeys(UPC).sort())
  assert.deepEqual(barcodeLookupKeys(`00${UPC}`).sort(), barcodeLookupKeys(UPC).sort())
  assert.deepEqual(barcodeLookupKeys('1234567890128'), ['1234567890128'])
  assert.deepEqual(barcodeLookupKeys('abc'), [])
})

test('exact iHerb barcode wins over a same-title Shopee row', () => {
  const catalog = buildMatchCatalog({
    iherb: [{
      gtin: EAN,
      url: 'https://sg.iherb.com/pr/anua-toner',
      price: 21.5,
      currency: 'SGD',
      captured_at: '2026-08-01T18:00:00Z',
    }],
    shopee: [{
      brand_key: 'anua',
      title: 'Anua Heartleaf Soothing Toner 200ml',
      seller_type: 'mall',
      price: 9,
      currency: 'SGD',
      crawled_at: '2026-08-02T00:00:00Z',
      listing_url: 'https://shopee.sg/product/1/2',
    }],
    brands: [{ brand_key: 'anua', display_name: 'Anua', aliases: [] }],
  })
  const [row] = matchPoLines([{
    barcode: UPC,
    brand: 'Anua',
    product_name: 'Heartleaf Soothing Toner 200ml',
  }], catalog)

  assert.equal(row.match_source, 'iherb')
  assert.equal(row.confidence, 1)
  assert.equal(row.price_sgd, '21.50')
  assert.equal(row.currency, 'SGD')
  assert.equal(row.date_seen, '2026-08-02')
  assert.equal(row.listing_url, 'https://sg.iherb.com/pr/anua-toner')
  assert.equal(row.review_note, '')
})

test('a USD iHerb price stays out of price_sgd', () => {
  const catalog = buildMatchCatalog({
    iherb: [{
      gtin: UPC,
      url: 'https://sg.iherb.com/pr/x',
      price: 18,
      currency: 'USD',
      captured_at: '2026-08-01T00:00:00Z',
    }],
  })
  const [row] = matchPoLines([{ barcode: EAN, brand: 'Anua', product_name: 'Toner' }], catalog)
  assert.equal(row.match_source, 'iherb')
  assert.equal(row.price_sgd, '')
  assert.equal(row.currency, 'USD')
})

test('the priced iHerb row wins when two gtins collapse to one barcode', () => {
  const catalog = buildMatchCatalog({
    iherb: [
      { gtin: UPC, price: null, currency: 'SGD', captured_at: '2026-09-01T00:00:00Z', url: 'https://sg.iherb.com/new' },
      { gtin: EAN, price: 12, currency: 'SGD', captured_at: '2026-07-01T00:00:00Z', url: 'https://sg.iherb.com/priced' },
    ],
  })
  const [row] = matchPoLines([{ barcode: UPC, brand: 'Anua', product_name: 'Toner' }], catalog)
  assert.equal(row.listing_url, 'https://sg.iherb.com/priced')
  assert.equal(row.price_sgd, '12.00')
  assert.equal(row.date_seen, '2026-07-01')
})

test('Shopee alias and title overlap, with size and seller gates', () => {
  const brands = [{
    brand_key: 'dear-klairs',
    display_name: 'Dear Klairs',
    aliases: ['klairs'],
  }]
  const shopee = [
    {
      brand_key: 'dear-klairs',
      title: 'Klairs Supple Preparation Toner 180ml',
      seller_type: 'mall',
      price: 15,
      currency: 'SGD',
      crawled_at: '2026-08-11T02:00:00Z',
      listing_url: 'https://shopee.sg/klairs-i.9.8',
    },
    {
      brand_key: 'dear-klairs',
      title: 'Klairs Supple Preparation Toner 180ml',
      seller_type: 'preferred',
      price: 1,
      currency: 'SGD',
      crawled_at: '2026-08-12T02:00:00Z',
      listing_url: 'https://shopee.sg/not-mall',
    },
    {
      brand_key: 'dear-klairs',
      title: 'Klairs Supple Preparation Toner 100ml',
      seller_type: 'mall',
      price: 11,
      currency: 'SGD',
      crawled_at: '2026-08-12T02:00:00Z',
      listing_url: 'https://shopee.sg/wrong-size',
    },
  ]
  const catalog = buildMatchCatalog({ iherb: [], shopee, brands })
  assert.equal(resolveBrandKey('Klairs', buildAliasIndex(brands)), 'dear-klairs')

  const [hit] = matchPoLines([{
    barcode: '111',
    brand: 'Klairs',
    product_name: 'Supple Preparation Toner 180ml',
  }], catalog)
  assert.equal(hit.match_source, 'shopee')
  assert.ok(hit.confidence >= 0.6)
  assert.equal(hit.listing_url, 'https://shopee.sg/klairs-i.9.8')
  assert.equal(hit.price_sgd, '15.00')
  assert.equal(hit.review_note, '')

  const [low] = matchPoLines([{
    barcode: '',
    brand: 'Klairs',
    product_name: 'Midnight Blue Calming Cream',
  }], catalog)
  assert.equal(low.match_source, 'none')
  assert.equal(low.confidence, '')
  assert.equal(low.price_sgd, '')
  assert.equal(low.listing_url, '')
})

test('stripping the brand lets a long Shopee title clear 0.6', () => {
  const catalog = buildMatchCatalog({
    shopee: [{
      brand_key: 'beauty-of-joseon',
      title: 'Beauty of Joseon Heartleaf Soothing Toner Cream mini set',
      seller_type: 'mall',
      price_sgd: 9.5,
      price: 9.5,
      currency: 'SGD',
      crawled_at: '2026-08-03T00:00:00Z',
      listing_url: 'https://shopee.sg/boj',
    }],
    brands: [{ brand_key: 'beauty-of-joseon', display_name: 'Beauty of Joseon' }],
  })
  const [row] = matchPoLines([{
    barcode: '',
    brand: 'Beauty of Joseon',
    product_name: 'Heartleaf Soothing Toner Cream',
  }], catalog)
  assert.equal(row.match_source, 'shopee')
  assert.ok(row.confidence >= 0.6)
  assert.equal(row.price_sgd, '9.50')
})

test('a brand outside the universe does not fuzzy-match', () => {
  const catalog = buildMatchCatalog({
    shopee: [{
      brand_key: 'peripera',
      title: 'Ink Velvet 01',
      seller_type: 'mall',
      price: 8,
      currency: 'SGD',
      listing_url: 'https://shopee.sg/peri',
    }],
    brands: [{ brand_key: 'anua', display_name: 'Anua' }],
  })
  const [row] = matchPoLines([{
    barcode: '',
    brand: 'Peripera',
    product_name: 'Ink Velvet 01',
  }], catalog)
  assert.equal(row.match_source, 'none')
})

test('token overlap of 0.6 is included and a disjoint size is not', () => {
  const catalog = buildMatchCatalog({
    shopee: [
      {
        brand_key: 'anua',
        title: 'alpha beta gamma epsilon',
        seller_type: 'mall',
        price: 4,
        currency: 'SGD',
        crawled_at: '2026-01-01T00:00:00Z',
        listing_url: 'https://shopee.sg/edge',
      },
      {
        brand_key: 'anua',
        title: 'heartleaf soothing toner 100ml',
        seller_type: 'mall',
        price: 4,
        currency: 'SGD',
        crawled_at: '2026-01-02T00:00:00Z',
        listing_url: 'https://shopee.sg/size',
      },
    ],
  })
  const [edge] = matchPoLines([{
    barcode: '',
    brand: 'Anua',
    product_name: 'alpha beta gamma delta',
  }], catalog)
  assert.equal(edge.match_source, 'shopee')
  assert.equal(edge.confidence, 0.6)

  const [sized] = matchPoLines([{
    barcode: '',
    brand: 'Anua',
    product_name: 'heartleaf soothing toner 200ml',
  }], catalog)
  assert.equal(sized.match_source, 'none')
})

test('a later empty price does not hide the price date', () => {
  const map = newestPricedObservation([
    { product_row_id: 'p', price: null, currency: 'SGD', captured_at: '2026-09-02T00:00:00Z' },
    { product_row_id: 'p', price: 10, currency: 'SGD', captured_at: '2026-08-02T00:00:00Z' },
  ])
  const snap = map.get('p')
  assert.equal(snap.price, 10)
  assert.equal(dateSeen(snap.captured_at), '2026-08-02')
})

test('csv keeps a comma in the product name and leaves review_note blank', () => {
  const lines = parseCsv('UPC,Brand,Product Name\n036000291452,"Anua","Toner, 200ml"\n')
  assert.deepEqual(lines, [{
    barcode: '036000291452',
    brand: 'Anua',
    product_name: 'Toner, 200ml',
  }])
  const catalog = buildMatchCatalog({ iherb: [], shopee: [] })
  const csv = renderMatchCsv(matchPoLines(lines, catalog))
  assert.equal(csv.split('\n')[0], MATCH_COLUMNS.join(','))
  assert.match(csv, /"Toner, 200ml",none,,,,/)
  assert.equal(csv.trim().endsWith(','), true)
  const stats = matchStats(matchPoLines(lines, catalog))
  assert.equal(stats.none, 1)
  assert.equal(stats.iherb, 0)
  assert.equal(stats.shopee, 0)
})

test('the cli writes the csv from json catalogs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'po-match-'))
  writeFileSync(join(dir, 'po.json'), JSON.stringify([
    { UPC: UPC, Brand: 'Anua', 'Product Name': 'Heartleaf Soothing Toner 200ml' },
  ]))
  writeFileSync(join(dir, 'iherb.json'), JSON.stringify([{
    gtin: EAN,
    url: 'https://sg.iherb.com/pr/x',
    price: 20,
    currency: 'SGD',
    captured_at: '2026-08-01T00:00:00Z',
  }]))
  writeFileSync(join(dir, 'shopee.json'), '[]')
  writeFileSync(join(dir, 'brands.json'), JSON.stringify([
    { brand_key: 'anua', display_name: 'Anua', aliases: [] },
  ]))
  const out = join(dir, 'out.csv')
  const result = spawnSync(process.execPath, [
    'scripts/po-competitive-match.mjs',
    '--po', join(dir, 'po.json'),
    '--iherb', join(dir, 'iherb.json'),
    '--shopee', join(dir, 'shopee.json'),
    '--brands', join(dir, 'brands.json'),
    '--out', out,
  ], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const csv = readFileSync(out, 'utf8')
  assert.equal(csv.split('\n')[0], MATCH_COLUMNS.join(','))
  assert.match(csv, /iherb,1,20\.00,SGD,2026-08-01,https:\/\/sg\.iherb\.com\/pr\/x,/)
  assert.match(result.stdout, /iherb=1/)
  const stats = JSON.parse(readFileSync(join(dir, 'match-stats.json'), 'utf8'))
  assert.equal(stats.iherb_pct, 100)
  assert.equal(stats.rows, 1)
})
