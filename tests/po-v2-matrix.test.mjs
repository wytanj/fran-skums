import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  PO_BRAND_ALIAS_PACK,
  brandKeyForPoBrand,
  listingFromHarvestRow,
  mallHarvestPlan,
  mergeListings,
  resolveAlias,
  shopeePriceRefreshTargets,
} from '../marketplace/poBrandAliasPack.mjs'
import {
  WIDE_COLUMNS,
  buildMatchCatalog,
  iherbRefreshPlan,
  renderWideCsv,
  toWideRow,
} from '../marketplace/poCompetitiveMatch.mjs'
import { buildWideMatrix } from '../marketplace/poV2Matrix.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

test('the alias pack resolves the top uncovered brands and does not invent shop ids', () => {
  assert.equal(PO_BRAND_ALIAS_PACK.length, 30)
  const peripera = resolveAlias('Peripera')
  assert.equal(peripera.brand_key, 'peripera')
  assert.equal(peripera.shop_username, null)
  assert.equal(peripera.shop_verified, false)
  assert.match(peripera.note, /TODO/)

  const joocyee = resolveAlias('joocyee')
  assert.equal(joocyee.shop_username, 'joocyee.sg')
  assert.equal(joocyee.shop_verified, true)

  assert.equal(resolveAlias('t-fit').brand_key, 'tfit')
  assert.equal(resolveAlias('The Saem').brand_key, 'the-saem')
  assert.equal(resolveAlias('bbi@').brand_key, 'bbi')
  assert.equal(resolveAlias('not-a-real-brand'), null)
  assert.equal(brandKeyForPoBrand('VT'), 'vt-cosmetics')
  assert.equal(brandKeyForPoBrand('T-Fit'), 'tfit')

  for (const entry of PO_BRAND_ALIAS_PACK) {
    assert.equal(Object.hasOwn(entry, 'shop_id'), false)
    if (!entry.shop_verified) assert.equal(entry.shop_username, null)
  }
})

test('the mall plan skips an unverified shop and resumes a finished one', () => {
  const plan = mallHarvestPlan(PO_BRAND_ALIAS_PACK, { brands: ['peripera', 'joocyee'], maxPages: 2 })
  const peri = plan.find((entry) => entry.brand_key === 'peripera')
  const joo = plan.find((entry) => entry.brand_key === 'joocyee')
  assert.equal(peri.skipped, 'unverified_shop')
  assert.deepEqual(peri.urls, [])
  assert.equal(joo.skipped, null)
  assert.equal(joo.urls.length, 2)
  assert.match(joo.urls[0], /shopee\.sg\/joocyee\.sg\?/)
  assert.match(joo.urls[0], /page=0/)
  assert.match(joo.urls[1], /page=1/)

  const resumed = mallHarvestPlan(PO_BRAND_ALIAS_PACK, {
    brands: ['joocyee'],
    maxPages: 2,
    resume: { brands: { joocyee: { pages_done: 2, done: true } } },
  })
  assert.equal(resumed[0].skipped, 'resume_done')
  assert.deepEqual(resumed[0].urls, [])
})

test('iHerb wins the wide row and the Shopee columns stay filled', () => {
  const catalog = buildMatchCatalog({
    iherb: [{
      gtin: '8801234567890',
      url: 'https://sg.iherb.com/pr/toner',
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
      listing_url: 'https://shopee.sg/anua-i.1.2',
    }],
    brands: [{ brand_key: 'anua', display_name: 'Anua', aliases: [] }],
  })
  const row = toWideRow({
    barcode: '8801234567890',
    brand: 'Anua',
    product_name: 'Heartleaf Soothing Toner 200ml',
  }, catalog)
  assert.equal(row.match_source, 'iherb')
  assert.equal(row.price_sgd, '21.50')
  assert.equal(row.iherb_price_sgd, '21.50')
  assert.equal(row.iherb_url, 'https://sg.iherb.com/pr/toner')
  assert.equal(row.shopee_price_sgd, '9.00')
  assert.equal(row.shopee_title, 'Anua Heartleaf Soothing Toner 200ml')
  assert.equal(row.review_note, '')

  const csv = renderWideCsv([row])
  assert.equal(csv.split('\n')[0], WIDE_COLUMNS.join(','))
  assert.match(csv, /iherb,1\.0,21\.50,/)
})

test('a size clash and a weak title leave the Shopee channel blank', () => {
  const catalog = buildMatchCatalog({
    shopee: [{
      brand_key: 'anua',
      title: 'Anua Heartleaf Toner 100ml',
      seller_type: 'mall',
      price: 9,
      currency: 'SGD',
      crawled_at: '2026-08-02T00:00:00Z',
      listing_url: 'https://shopee.sg/anua-i.1.2',
    }],
    brands: [{ brand_key: 'anua', display_name: 'Anua', aliases: [] }],
  })
  const clash = toWideRow({
    barcode: '111',
    brand: 'Anua',
    product_name: 'Heartleaf Toner 200ml',
  }, catalog)
  assert.equal(clash.match_source, 'none')
  assert.equal(clash.shopee_url, '')

  const weak = toWideRow({
    barcode: '222',
    brand: 'Anua',
    product_name: 'Zebra Quilt',
  }, catalog)
  assert.equal(weak.match_source, 'none')
  assert.equal(weak.shopee_confidence, '')
})

test('the iHerb queue is empty prices then unmatched rows', () => {
  const plan = iherbRefreshPlan([
    { barcode: '1', brand: 'a', product_name: 'priced', match_source: 'iherb', price_sgd: '4.00' },
    { barcode: '2', brand: 'b', product_name: 'empty', match_source: 'iherb', price_sgd: '' },
    { barcode: '3', brand: 'c', product_name: 'none', match_source: 'none', price_sgd: '' },
    { barcode: '4', brand: 'd', product_name: 'shop', match_source: 'shopee', price_sgd: '' },
  ])
  assert.deepEqual(plan.queue.map((row) => row.barcode), ['2', '3'])
  assert.equal(plan.queue[0].priority, 'empty_price')
  assert.equal(plan.queue[1].priority, 'none')
})

test('price refresh keeps Shopee rows with a blank price and a real item url', () => {
  const targets = shopeePriceRefreshTargets([
    {
      barcode: '4',
      brand: 'd',
      product_name: 'Shop Toner',
      match_source: 'shopee',
      price_sgd: '',
      listing_url: 'https://shopee.sg/shop-toner-i.9.8',
    },
    {
      barcode: '5',
      brand: 'e',
      product_name: 'Priced',
      match_source: 'shopee',
      price_sgd: '3.00',
      listing_url: 'https://shopee.sg/priced-i.1.2',
    },
    {
      barcode: '6',
      brand: 'f',
      product_name: 'No id',
      match_source: 'shopee',
      price_sgd: '',
      listing_url: 'https://shopee.sg/search?keyword=x',
    },
  ])
  assert.equal(targets.length, 1)
  assert.equal(targets[0].shop_id, '9')
  assert.equal(targets[0].item_id, '8')

  const deduped = shopeePriceRefreshTargets([
    { match_source: 'shopee', price_sgd: '', listing_url: 'https://shopee.sg/a-i.9.8', barcode: '1' },
    { match_source: 'shopee', price_sgd: '', listing_url: 'https://shopee.sg/b-i.9.8', barcode: '2' },
  ])
  assert.equal(deduped.length, 1)
})

test('a price-only refresh keeps the workbook title and fills the price', () => {
  const workbook = listingFromHarvestRow({
    brand_key: 'anua',
    title: 'Anua Heartleaf Soothing Toner 200ml',
    price: '',
    currency: 'SGD',
    seller_type: 'mall',
    shop_id: '9',
    item_id: '8',
    listing_url: 'https://shopee.sg/anua-i.9.8',
    crawled_at: '2026-07-01T00:00:00Z',
  })
  const [merged] = mergeListings([[workbook], [{
    brand_key: 'anua',
    title: 'short',
    price: 12.5,
    price_sgd: 12.5,
    currency: 'SGD',
    seller_type: 'mall',
    shop_id: '9',
    item_id: '8',
    listing_url: 'https://shopee.sg/anua-i.9.8',
    crawled_at: '2026-10-06T00:00:00Z',
    price_only: true,
  }]])
  assert.equal(merged.title, 'Anua Heartleaf Soothing Toner 200ml')
  assert.equal(merged.price, 12.5)
})

test('the wide builder prefers a refresh price and a harvest title', () => {
  const { rows } = buildWideMatrix({
    lines: [{
      barcode: '8801234567890',
      brand: 'Anua',
      product_name: 'Heartleaf Soothing Toner 200ml',
      match_source: 'iherb',
      price_sgd: '',
      currency_or_date_seen: 'SGD 2026-08-11',
      listing_url: 'https://sg.iherb.com/pr/old',
    }],
    iherbRefreshHits: [{
      barcode: '8801234567890',
      price_sgd: '19.00',
      url: 'https://sg.iherb.com/pr/new',
      seen_at: '2026-10-06',
      confidence: 1,
    }],
    listings: [{
      brand_key: 'anua',
      title: 'Anua Heartleaf Soothing Toner 200ml',
      price: 11,
      currency: 'SGD',
      seller_type: 'mall',
      shop_id: '1',
      item_id: '2',
      listing_url: 'https://shopee.sg/anua-i.1.2',
      crawled_at: '2026-08-02T00:00:00Z',
    }],
  })
  assert.equal(rows[0].match_source, 'iherb')
  assert.equal(rows[0].iherb_price_sgd, '19.00')
  assert.equal(rows[0].iherb_url, 'https://sg.iherb.com/pr/new')
  assert.equal(rows[0].shopee_title, 'Anua Heartleaf Soothing Toner 200ml')
  assert.equal(rows[0].review_note, '')
})

test('a quoted title survives the wide csv', () => {
  const csv = renderWideCsv([{
    barcode: '1',
    brand: 'Anua',
    product_name: 'Toner, 200ml',
    iherb_price_sgd: '',
    iherb_url: '',
    iherb_seen_at: '',
    iherb_confidence: '',
    shopee_price_sgd: '',
    shopee_url: '',
    shopee_title: '',
    shopee_seen_at: '',
    shopee_confidence: '',
    match_source: 'none',
    confidence: '',
    price_sgd: '',
    seen_at: '',
    review_note: '',
  }])
  assert.match(csv, /"Toner, 200ml"/)
})

test('the v2 scripts do not write the database', () => {
  const files = [
    'scripts/po-v2-iherb-refresh.mjs',
    'scripts/po-v2-shopee-mall-harvest.mjs',
    'scripts/po-v2-build-matrix.mjs',
    'scripts/po-v2-run.ps1',
    'marketplace/poBrandAliasPack.mjs',
    'marketplace/poV2Matrix.mjs',
  ]
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8')
    assert.equal(text.includes('identity_candidates'), false, file)
    assert.equal(text.includes('upsertObservationCards'), false, file)
    assert.equal(text.includes('upsertIherb'), false, file)
    assert.equal(/watsons|guardian|sephora/i.test(text), false, file)
  }
})

test('dry-run harvest writes a plan and does not open Chrome', () => {
  const dir = mkdtempSync(join(tmpdir(), 'po-v2-harvest-'))
  const po = join(dir, 'po.csv')
  writeFileSync(po, [
    'barcode,brand,product_name,match_source,confidence,price_sgd,currency_or_date_seen,listing_url,review_note',
    '8801,peripera,Ink Velvet,none,,,,, ',
    '8802,anua,Toner,shopee,,,"",https://shopee.sg/toner-i.9.8,',
  ].join('\n'))
  const out = join(dir, 'out.json')
  const resume = join(dir, 'resume.json')
  const result = spawnSync(process.execPath, [
    'scripts/po-v2-shopee-mall-harvest.mjs',
    '--dry-run',
    '--price-refresh',
    '--po', po,
    '--brands', 'peripera,joocyee',
    '--max-pages', '1',
    '--out', out,
    '--resume', resume,
  ], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const body = JSON.parse(readFileSync(out, 'utf8'))
  assert.equal(body.dry_run, true)
  assert.equal(body.db_writes, false)
  assert.equal(body.price_refresh_targets, 1)
  const peri = body.brands.find((entry) => entry.brand_key === 'peripera')
  assert.equal(peri.skipped, 'unverified_shop')
  assert.match(result.stdout, /dry_run=true/)
})

test('the matrix cli writes the wide csv from a local sheet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'po-v2-matrix-'))
  const po = join(dir, 'po.csv')
  writeFileSync(po, [
    'barcode,brand,product_name,match_source,confidence,price_sgd,currency_or_date_seen,listing_url,review_note',
    '8801234567890,Anua,Heartleaf Soothing Toner 200ml,iherb,1.0,21.50,SGD 2026-08-11,https://sg.iherb.com/pr/old,',
  ].join('\n'))
  const refresh = join(dir, 'refresh.json')
  writeFileSync(refresh, JSON.stringify({
    hits: [{
      barcode: '8801234567890',
      price_sgd: '19.00',
      url: 'https://sg.iherb.com/pr/new',
      seen_at: '2026-10-06',
      confidence: 1,
    }],
  }))
  const shopee = join(dir, 'shopee.json')
  writeFileSync(shopee, JSON.stringify({
    listings: [{
      brand_key: 'anua',
      title: 'Anua Heartleaf Soothing Toner 200ml',
      price: 11,
      currency: 'SGD',
      seller_type: 'mall',
      shop_id: '1',
      item_id: '2',
      listing_url: 'https://shopee.sg/anua-i.1.2',
      crawled_at: '2026-08-02T00:00:00Z',
    }],
  }))
  const out = join(dir, 'v2.csv')
  const result = spawnSync(process.execPath, [
    'scripts/po-v2-build-matrix.mjs',
    '--po', po,
    '--iherb-refresh', refresh,
    '--shopee', shopee,
    '--out', out,
  ], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const csv = readFileSync(out, 'utf8')
  assert.equal(csv.split('\n')[0], WIDE_COLUMNS.join(','))
  assert.match(csv, /19\.00,https:\/\/sg\.iherb\.com\/pr\/new/)
  assert.match(csv, /,iherb,1\.0,19\.00,/)
  const stats = JSON.parse(readFileSync(join(dir, 'po-competitive-match-v2-stats.json'), 'utf8'))
  assert.equal(stats.iherb, 1)
  assert.equal(stats.shopee_channel, 1)
  assert.equal(stats.pr1.iherb, 1)
})
