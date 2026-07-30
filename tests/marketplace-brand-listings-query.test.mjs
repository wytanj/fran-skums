import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  BRAND_LISTING_COLUMNS,
  buildBrandRadarSummary,
  dedupeSnapshotsByListing,
  filterBrandListingRows,
  queryBrandListings,
  snapshotToBrandListingRow,
  soldBand,
  summarizeBrandListings,
  toColumnar,
} from '../marketplace/brandListingsQuery.mjs'
import { snapshotDimensions } from '../marketplace/writers/upsertObservations.mjs'
import { exportRowsToCsv } from '../marketplace/normalize/metrics.mjs'

/**
 * Chainable Supabase mock that records what reached SQL.
 * `count` answers the head:true count query; `rows` answers the data query.
 */
function mockDb({ rows = [], count = 0 }) {
  const calls = { tables: [], filters: [], ranges: [], orders: [] }
  function builder(isCount) {
    const rec = (op) => (col, val) => {
      calls.filters.push({ op, col, val })
      return api
    }
    const api = {
      select(_sel, opts) {
        if (opts?.head) return builder(true)
        return api
      },
      eq: rec('eq'),
      gte: rec('gte'),
      lte: rec('lte'),
      in: rec('in'),
      ilike: rec('ilike'),
      order(col, opts) {
        calls.orders.push({ col, ...opts })
        return api
      },
      range(from, to) {
        calls.ranges.push({ from, to })
        return Promise.resolve({ data: rows, error: null })
      },
      then(resolve) {
        return Promise.resolve(
          isCount ? { count, error: null } : { data: rows, error: null },
        ).then(resolve)
      },
    }
    return api
  }
  return {
    calls,
    from(table) {
      calls.tables.push(table)
      return builder(false)
    },
  }
}

const snap = (over = {}) => ({
  listing_id: over.listing_id || 'L1',
  sold_label: '1k+ sold',
  sold_count_lower_bound: over.sold ?? 1000,
  crawled_at: '2026-07-28T00:00:00Z',
  signals: { brand_key: 'biodance', shop_username: 'biodance.sg' },
  marketplace_listings: { id: over.listing_id || 'L1', title: over.title || 'X', shop_id: '1', item_id: '2' },
})

test('snapshotToBrandListingRow flattens signals + listing', () => {
  const row = snapshotToBrandListingRow({
    listing_id: 'L1',
    sold_label: '90k+ sold',
    sold_count_lower_bound: 90000,
    price: 12.9,
    currency: 'SGD',
    crawled_at: '2026-07-21T05:00:00Z',
    seller_type: 'mall',
    signals: {
      brand_key: 'biodance',
      shop_username: 'biodance.sg',
      shop_collection_name: 'All Products',
      shop_collection_id: null,
      platform_category_path: ['Shopee', 'Skincare', 'Face Mask'],
      platform_category_leaf: 'Face Mask',
      harvest_source: 'mall_all_products_harvest',
    },
    marketplace_listings: {
      id: 'L1',
      shop_id: '951591050',
      item_id: '16793820273',
      title: 'Bio Collagen Mask',
      shop_name: 'biodance.sg',
      listing_url: 'https://shopee.sg/x-i.951591050.16793820273',
      seller_type: 'mall',
    },
  })
  assert.equal(row.brand_key, 'biodance')
  assert.equal(row.sold_count_lower_bound, 90000)
  assert.equal(row.platform_category_leaf, 'Face Mask')
  assert.match(row.platform_category_path_text, /Face Mask/)
  assert.equal(row.item_id, '16793820273')
})

test('dedupeSnapshotsByListing prefers higher sold', () => {
  const out = dedupeSnapshotsByListing([
    {
      listing_id: 'A',
      sold_count_lower_bound: 100,
      crawled_at: '2026-07-20T00:00:00Z',
    },
    {
      listing_id: 'A',
      sold_count_lower_bound: 500,
      crawled_at: '2026-07-19T00:00:00Z',
    },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].sold_count_lower_bound, 500)
})

test('filterBrandListingRows brand + min_sold', () => {
  const rows = [
    { brand_key: 'biodance', sold_count_lower_bound: 90000, title: 'Mask' },
    { brand_key: 'biodance', sold_count_lower_bound: 10, title: 'Mini' },
    { brand_key: 'anua', sold_count_lower_bound: 5000, title: 'Serum' },
  ]
  const f = filterBrandListingRows(rows, { brand_key: 'biodance', min_sold: 1000, limit: 50 })
  assert.equal(f.length, 1)
  assert.equal(f[0].title, 'Mask')
})

test('CSV includes brand columns', () => {
  const rows = [
    {
      brand_key: 'biodance',
      shop_username: 'biodance.sg',
      title: 'X',
      sold_label: '1k+ sold',
      sold_count_lower_bound: 1000,
    },
  ]
  const ordered = rows.map((r) => {
    const o = {}
    for (const k of BRAND_LISTING_COLUMNS) o[k] = r[k] ?? ''
    return o
  })
  const csv = exportRowsToCsv(ordered)
  assert.match(csv, /brand_key/)
  assert.match(csv, /biodance/)
  assert.match(csv, /sold_count_lower_bound/)
})

test('summarizeBrandListings counts', () => {
  const s = summarizeBrandListings([
    { brand_key: 'biodance', sold_label: '1k', platform_category_leaf: 'Masks' },
    { brand_key: 'biodance', sold_label: null, platform_category_leaf: null },
  ])
  assert.equal(s.row_count, 2)
  assert.equal(s.with_sold, 1)
  assert.equal(s.with_platform_path, 1)
  assert.equal(s.by_brand.biodance, 2)
})

test('soldBand buckets', () => {
  assert.equal(soldBand(90000), '50k+')
  assert.equal(soldBand(3000), '1k–5k')
  assert.equal(soldBand(0), 'unknown')
})

test('buildBrandRadarSummary top products', () => {
  const s = buildBrandRadarSummary(
    [
      {
        brand_key: 'biodance',
        title: 'A',
        sold_count_lower_bound: 90000,
        sold_label: '90k+ sold',
        shop_collection_name: 'All Products',
      },
      {
        brand_key: 'biodance',
        title: 'B',
        sold_count_lower_bound: 100,
        sold_label: '100 sold',
        shop_collection_name: 'Bundle',
      },
    ],
    { top_n: 1 },
  )
  assert.equal(s.top_products.length, 1)
  assert.equal(s.top_products[0].title, 'A')
  assert.equal(s.by_sold_band['50k+'], 1)
  assert.equal(s.brands[0].sku_count, 2)
})

// ——— Track RP: filters must reach SQL, truncation must be declared ———

test('RP-1: reads the latest-per-listing view, not the raw snapshot table', async () => {
  const db = mockDb({ rows: [snap()], count: 1 })
  await queryBrandListings(db, 'ws-1', { limit: 10 })
  // The JS dedupe + fetch window are gone; SQL returns one row per listing.
  assert.ok(db.calls.tables.every((t) => t === 'v_marketplace_listing_latest'))
  assert.ok(!db.calls.tables.includes('marketplace_listing_snapshots'))
})

test('RP-1: min_sold is a SQL predicate, not a post-window JS filter', async () => {
  const db = mockDb({ rows: [snap()], count: 910 })
  const res = await queryBrandListings(db, 'ws-1', { min_sold: 1000, limit: 500 })

  const gte = db.calls.filters.find((f) => f.op === 'gte' && f.col === 'sold_count_lower_bound')
  assert.ok(gte, 'min_sold must be pushed to SQL — this is the 910-vs-176 bug')
  assert.equal(gte.val, 1000)
  // total_matching comes from the DB count, not from the returned page
  assert.equal(res.total_matching, 910)
})

test('RP-1: every documented filter reaches SQL', async () => {
  const db = mockDb({ rows: [], count: 0 })
  await queryBrandListings(db, 'ws-1', {
    brand_keys: ['biodance', 'anua'],
    shop_username: 'Biodance.SG',
    shop_collection_name: 'Bundle',
    platform_category_leaf: 'Face Mask',
    min_sold: 500,
    seller_type: 'mall',
    since: '2026-07-01',
    until: '2026-07-31',
  })
  const byCol = (col) => db.calls.filters.filter((f) => f.col === col)
  assert.equal(byCol('brand_key')[0]?.op, 'in')
  assert.deepEqual(byCol('brand_key')[0]?.val, ['biodance', 'anua'])
  assert.equal(byCol('shop_username')[0]?.val, 'biodance.sg', 'shop should be lowercased')
  assert.equal(byCol('shop_collection_name')[0]?.op, 'ilike')
  assert.equal(byCol('platform_category_leaf')[0]?.op, 'ilike')
  assert.ok(byCol('sold_count_lower_bound').some((f) => f.op === 'gte'))
  assert.ok(byCol('seller_type').length)
  assert.ok(byCol('crawled_at').some((f) => f.op === 'gte'))
  assert.ok(byCol('crawled_at').some((f) => f.op === 'lte'))
})

test('RP-1: declares incompleteness instead of silently truncating', async () => {
  const rows = Array.from({ length: 500 }, (_, i) => snap({ listing_id: `L${i}`, sold: 2000 }))
  const db = mockDb({ rows, count: 910 })
  const res = await queryBrandListings(db, 'ws-1', { min_sold: 1000, limit: 500 })

  assert.equal(res.row_count, 500)
  assert.equal(res.total_matching, 910)
  assert.equal(res.complete, false, 'must not claim completeness over a partial page')
  assert.equal(res.next_offset, 500)
})

test('RP-1: complete=true when the page covers the whole match set', async () => {
  const rows = Array.from({ length: 51 }, (_, i) => snap({ listing_id: `L${i}` }))
  const db = mockDb({ rows, count: 51 })
  const res = await queryBrandListings(db, 'ws-1', { brand_key: 'biodance', limit: 100 })
  assert.equal(res.complete, true)
  assert.equal(res.next_offset, null)
})

test('RP-1: offset pages forward and stays honest', async () => {
  const rows = Array.from({ length: 410 }, (_, i) => snap({ listing_id: `L${i}` }))
  const db = mockDb({ rows, count: 910 })
  const res = await queryBrandListings(db, 'ws-1', { min_sold: 1000, limit: 500, offset: 500 })
  assert.equal(db.calls.ranges[0].from, 500)
  assert.equal(res.offset, 500)
  assert.equal(res.complete, true, '500 + 410 === 910')
})

test('RP-1: sorts by sold in SQL so LIMIT returns the real top N', async () => {
  const db = mockDb({ rows: [snap()], count: 1 })
  await queryBrandListings(db, 'ws-1', { limit: 10 })
  const sortCol = db.calls.orders[0]
  assert.equal(sortCol.col, 'sold_count_lower_bound')
  assert.equal(sortCol.ascending, false)
})

test('RP-1: q flags that its count is page-scoped', async () => {
  const db = mockDb({ rows: [snap({ title: 'Collagen Mask' })], count: 1 })
  const res = await queryBrandListings(db, 'ws-1', { q: 'collagen', limit: 10 })
  assert.equal(res.row_count, 1)
  assert.match(res.note || '', /applied to this page only/)
})

test('RP-1: q pages by consumed SQL candidates and does not claim an incomplete scan is complete', async () => {
  const rows = Array.from({ length: 100 }, (_, i) =>
    snap({ listing_id: `L${i}`, title: i === 50 ? 'Collagen Mask' : 'Cleanser' }),
  )
  const db = mockDb({ rows, count: 1000 })
  const res = await queryBrandListings(db, 'ws-1', {
    q: 'collagen',
    limit: 10,
  })

  assert.equal(res.row_count, 1)
  assert.equal(res.complete, false)
  assert.equal(res.next_offset, 100, 'advance past every candidate already scanned')
})

test('RP-1: q stops the source cursor at the final returned match', async () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    snap({ listing_id: `L${i}`, title: i < 3 ? 'Collagen Mask' : 'Cleanser' }),
  )
  const db = mockDb({ rows, count: 100 })
  const res = await queryBrandListings(db, 'ws-1', {
    q: 'collagen',
    limit: 1,
  })

  assert.equal(res.row_count, 1)
  assert.equal(res.complete, false)
  assert.equal(res.next_offset, 1, 'do not skip later matches in the widened fetch window')
})

test('RP-1: q with no matches still advances instead of returning the same cursor', async () => {
  const rows = Array.from({ length: 100 }, (_, i) =>
    snap({ listing_id: `L${i}`, title: 'Cleanser' }),
  )
  const db = mockDb({ rows, count: 1000 })
  const res = await queryBrandListings(db, 'ws-1', {
    q: 'collagen',
    limit: 10,
    offset: 200,
  })

  assert.equal(res.row_count, 0)
  assert.equal(res.complete, false)
  assert.equal(res.next_offset, 300)
})

test('RP-2: snapshotDimensions derives indexed columns from signals', () => {
  assert.deepEqual(
    snapshotDimensions({
      brand_key: 'BioDance',
      shop_username: 'Biodance.SG',
      shop_collection_name: 'Bundle SET',
      platform_category_leaf: 'Face Mask',
    }),
    {
      brand_key: 'biodance',
      shop_username: 'biodance.sg',
      shop_collection_name: 'Bundle SET',
      platform_category_leaf: 'Face Mask',
    },
  )
  // Legacy harvests stamped the shelf as `category`
  assert.equal(snapshotDimensions({ category: 'Serums' }).shop_collection_name, 'Serums')
  // Empty strings must become null so partial indexes stay small
  assert.equal(snapshotDimensions({ brand_key: '  ' }).brand_key, null)
  assert.deepEqual(snapshotDimensions(null), {
    brand_key: null,
    shop_username: null,
    shop_collection_name: null,
    platform_category_leaf: null,
  })
})

// ——— RP-7: tiering row access ———

test('RP-7: an unfiltered row request is capped and steered to the rollup', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => snap({ listing_id: `L${i}` }))
  const db = mockDb({ rows, count: 3279 })
  const res = await queryBrandListings(db, 'ws-1', { limit: 100 })

  assert.equal(res.row_count, 25, 'unfiltered dumps are capped')
  assert.match(res.guidance, /market_brand_rollup/)
  assert.match(res.guidance, /sample, not a ranking/)
})

test('RP-7: a narrowed request keeps the full requested limit', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => snap({ listing_id: `L${i}` }))
  const db = mockDb({ rows, count: 100 })
  for (const narrowing of [
    { brand_key: 'biodance' },
    { brand_keys: ['biodance'] },
    { shop_collection_name: 'Serums' },
    { min_sold: 1000 },
    { offset: 25 },
  ]) {
    const res = await queryBrandListings(db, 'ws-1', { limit: 100, ...narrowing })
    assert.equal(res.row_count, 100, `should not cap when ${JSON.stringify(narrowing)}`)
  }
})

test('RP-7: a narrowed but partial result still names the way forward', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => snap({ listing_id: `L${i}` }))
  const db = mockDb({ rows, count: 500 })
  const res = await queryBrandListings(db, 'ws-1', { brand_key: 'biodance', limit: 100 })
  assert.equal(res.complete, false)
  assert.match(res.guidance, /offset=100/)
})

test('RP-7: a complete narrowed result carries no guidance noise', async () => {
  const db = mockDb({ rows: [snap()], count: 1 })
  const res = await queryBrandListings(db, 'ws-1', { brand_key: 'biodance' })
  assert.equal(res.complete, true)
  assert.equal(res.guidance, undefined)
})

// ——— RP-5: payload shaping ———

test('RP-5: columnar is the default JSON shape and drops per-row keys', async () => {
  const rows = [snap({ listing_id: 'L1', title: 'A' }), snap({ listing_id: 'L2', title: 'B' })]
  const db = mockDb({ rows, count: 2 })
  const res = await queryBrandListings(db, 'ws-1', { limit: 10 })

  assert.equal(res.shape, 'columnar')
  assert.ok(Array.isArray(res.columns))
  assert.ok(Array.isArray(res.rows[0]), 'rows must be arrays, not objects')
  assert.equal(res.rows.length, 2)
  assert.equal(res.rows[0].length, res.columns.length)
})

test('RP-5: constant fields are hoisted out of the rows', async () => {
  const rows = [snap({ listing_id: 'L1', title: 'A' }), snap({ listing_id: 'L2', title: 'B' })]
  const db = mockDb({ rows, count: 2 })
  const res = await queryBrandListings(db, 'ws-1', { brand_key: 'biodance', limit: 10 })

  // Same brand on every row → hoisted, and absent from the per-row arrays.
  assert.equal(res.constant.brand_key, 'biodance')
  assert.ok(!res.columns.includes('brand_key'))
  // Title differs → stays a column.
  assert.ok(res.columns.includes('title'))
})

test('RP-5: an all-null field is NOT hoisted (absence is information)', async () => {
  const rows = [snap({ listing_id: 'L1' }), snap({ listing_id: 'L2' })]
  const db = mockDb({ rows, count: 2 })
  const res = await queryBrandListings(db, 'ws-1', { limit: 10 })
  // platform_category_leaf is null on both — must stay visible as a column
  // so the agent can see MH-4 has not enriched these, rather than assume.
  assert.ok(res.columns.includes('platform_category_leaf'))
  assert.equal(res.constant.platform_category_leaf, undefined)
})

test('RP-5: default projection omits the fields measured as pure token cost', async () => {
  const db = mockDb({ rows: [snap()], count: 1 })
  const res = await queryBrandListings(db, 'ws-1', { limit: 10 })
  const present = [...res.columns, ...Object.keys(res.constant)]
  // listing_url was 26% of payload, listing_id 6%, crawled_at 5%.
  for (const dropped of ['listing_url', 'listing_id', 'crawled_at', 'platform_category_path_text']) {
    assert.ok(!present.includes(dropped), `${dropped} should not be in the default projection`)
  }
  // …but the caller can discover them.
  assert.ok(res.available_fields.includes('listing_url'))
})

test('RP-5: url_template replaces per-row URLs', async () => {
  const db = mockDb({ rows: [snap()], count: 1 })
  const res = await queryBrandListings(db, 'ws-1', { limit: 10 })
  assert.match(res.url_template, /\{shop_id\}/)
  assert.match(res.url_template, /\{item_id\}/)
})

test('RP-5: fields lets a caller ask for more, ignoring unknown names', async () => {
  const db = mockDb({ rows: [snap()], count: 1 })
  const res = await queryBrandListings(db, 'ws-1', {
    limit: 10,
    fields: ['title', 'listing_url', 'not_a_field'],
  })
  const present = [...res.columns, ...Object.keys(res.constant)]
  assert.ok(present.includes('listing_url'))
  assert.ok(!present.includes('not_a_field'))
})

test('RP-5: shape=objects still returns keyed rows for non-LLM callers', async () => {
  const db = mockDb({ rows: [snap()], count: 1 })
  const res = await queryBrandListings(db, 'ws-1', { limit: 10, shape: 'objects' })
  assert.equal(res.shape, 'objects')
  assert.equal(typeof res.rows[0], 'object')
  assert.ok(!Array.isArray(res.rows[0]))
  assert.equal(res.rows[0].brand_key, 'biodance')
})

test('RP-5: toColumnar is pure and handles the empty case', () => {
  assert.deepEqual(toColumnar([], ['a', 'b']), { columns: ['a', 'b'], constant: {}, rows: [] })
  const t = toColumnar([{ a: 1, b: 2 }, { a: 1, b: 3 }], ['a', 'b'])
  assert.deepEqual(t.constant, { a: 1 })
  assert.deepEqual(t.columns, ['b'])
  assert.deepEqual(t.rows, [[2], [3]])
})

test('RP-5: operator-facing callers keep row objects', () => {
  const cli = readFileSync(
    new URL('../scripts/export-brand-listings.mjs', import.meta.url),
    'utf8',
  )
  assert.match(cli, /shape: 'objects'/, 'CLI JSON output is read by humans')

  const route = readFileSync(
    new URL('../server/api/v1/marketplace/brand-listings.get.ts', import.meta.url),
    'utf8',
  )
  assert.match(route, /shape === 'columnar' \? 'columnar' : 'objects'/, 'HTTP stays back-compatible')

  const bi = readFileSync(new URL('../mcp/src/lib/bi.mjs', import.meta.url), 'utf8')
  assert.match(bi, /shape: filters\.shape === 'objects' \? 'objects' : 'columnar'/, 'MCP defaults columnar')
})

test('RP-2: BOTH snapshot write paths stamp the dimension columns', () => {
  // There are two writers. Patching only upsertObservationCards left 22
  // MH-4 rows with brand_key in signals but NULL in the column — invisible to
  // every SQL filter. Any third writer must do the same.
  const writer = readFileSync(
    new URL('../marketplace/writers/upsertObservations.mjs', import.meta.url),
    'utf8',
  )
  assert.match(writer, /export function snapshotDimensions/)
  assert.match(writer, /\.\.\.snapshotDimensions\(card\.signals\)/)

  const pdp = readFileSync(new URL('../marketplace/pdpEnrich.mjs', import.meta.url), 'utf8')
  assert.match(pdp, /snapshotDimensions/, 'MH-4 PDP writer must stamp dimensions too')
  assert.match(pdp, /Object\.assign\(snapshotRow, snapshotDimensions/)
})

test('RP: migration 076 ships the columns, indexes and view the query depends on', () => {
  const sql = readFileSync(
    new URL('../core/db/076_marketplace_snapshot_dimensions.sql', import.meta.url),
    'utf8',
  )
  for (const col of ['brand_key', 'shop_username', 'shop_collection_name', 'platform_category_leaf']) {
    assert.match(sql, new RegExp(`add column if not exists\\s+${col}`))
  }
  assert.match(sql, /create or replace view public\.v_marketplace_listing_latest/)
  assert.match(sql, /distinct on \(s\.listing_id\)/)
  assert.match(sql, /idx_mls_workspace_brand_sold/)
})

test('API route and MCP tools registered', () => {
  const api = readFileSync(
    new URL('../server/api/v1/marketplace/brand-listings.get.ts', import.meta.url),
    'utf8',
  )
  assert.match(api, /queryBrandListings/)
  assert.match(api, /intel:read/)

  const sumApi = readFileSync(
    new URL('../server/api/v1/marketplace/brand-summary.get.ts', import.meta.url),
    'utf8',
  )
  assert.match(sumApi, /queryBrandSummary/)

  const tools = readFileSync(new URL('../mcp/src/tools.mjs', import.meta.url), 'utf8')
  assert.match(tools, /market_brand_listings/)
  assert.match(tools, /market_brand_export_csv/)
  assert.match(tools, /market_brand_summary/)
  assert.match(tools, /case 'market_brand_listings'/)
  assert.match(tools, /case 'market_brand_summary'/)

  const scopes = readFileSync(new URL('../mcp/src/toolScopes.mjs', import.meta.url), 'utf8')
  assert.match(scopes, /market_brand_listings/)
  assert.match(scopes, /market_brand_export_csv/)
  assert.match(scopes, /market_brand_summary/)

  const cli = readFileSync(
    new URL('../scripts/export-brand-listings.mjs', import.meta.url),
    'utf8',
  )
  assert.match(cli, /queryBrandListings/)
})
