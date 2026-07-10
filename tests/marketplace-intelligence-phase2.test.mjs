import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildExportTable,
  computeSellerMixMetrics,
  exportRowsToCsv,
  percentile,
} from '../marketplace/normalize/metrics.mjs'

const metricsUtil = readFileSync(new URL('../server/utils/marketplaceMetrics.ts', import.meta.url), 'utf8')
const exportUtil = readFileSync(new URL('../server/utils/marketplaceExport.ts', import.meta.url), 'utf8')
const metricsTick = readFileSync(
  new URL('../server/api/internal/marketplace/metrics-tick.post.ts', import.meta.url),
  'utf8',
)
const metricsGet = readFileSync(new URL('../server/api/v1/marketplace/metrics.get.ts', import.meta.url), 'utf8')
const exportGet = readFileSync(new URL('../server/api/v1/marketplace/export.get.ts', import.meta.url), 'utf8')
const listingsGet = readFileSync(new URL('../server/api/v1/marketplace/listings.get.ts', import.meta.url), 'utf8')
const snapshotsGet = readFileSync(new URL('../server/api/v1/marketplace/snapshots.get.ts', import.meta.url), 'utf8')
const seedsPatch = readFileSync(
  new URL('../server/api/v1/marketplace/seeds/[id].patch.ts', import.meta.url),
  'utf8',
)
const majorUpdate = readFileSync(new URL('../Major Update.md', import.meta.url), 'utf8')
const readme = readFileSync(new URL('../marketplace/README.md', import.meta.url), 'utf8')

const sampleRows = [
  {
    shop_id: '1',
    item_id: 'a',
    title: 'Mall item',
    seller_type: 'mall',
    price: 30,
    sold_count_lower_bound: 5000,
    rank_position: 1,
    signals: {},
  },
  {
    shop_id: '2',
    item_id: 'b',
    title: 'Preferred item',
    seller_type: 'preferred',
    price: 25,
    sold_count_lower_bound: 1100,
    rank_position: 2,
    signals: {},
  },
  {
    shop_id: '3',
    item_id: 'c',
    title: 'Reseller overseas',
    seller_type: 'normal',
    price: 18,
    sold_count_lower_bound: 400,
    rank_position: 3,
    signals: { ships_from_overseas: true, preorder: true },
  },
]

test('percentile and seller mix metrics', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5)
  assert.equal(percentile([], 0.5), null)

  const m = computeSellerMixMetrics(sampleRows, { query: 'anua official', country: 'sg' })
  assert.equal(m.listing_count, 3)
  assert.equal(m.seller_mix.counts.mall, 1)
  assert.equal(m.seller_mix.counts.preferred, 1)
  assert.equal(m.seller_mix.counts.normal, 1)
  assert.ok(m.seller_mix.official_store_share_pct > 0)
  assert.equal(m.price.mall_p50, 30)
  assert.equal(m.reseller_pressure.undercut_count, 2)
  assert.ok(m.reseller_pressure.top_undercutters[0].undercut_vs_mall_p50_pct > 0)
  assert.equal(m.signals.overseas_count, 1)
  assert.equal(m.signals.preorder_count, 1)
})

test('export table and CSV builders', () => {
  const table = buildExportTable(
    sampleRows.map((r, i) => ({
      ...r,
      id: `snap-${i}`,
      listing_id: `list-${i}`,
      search_query: 'anua official',
      currency: 'SGD',
      crawled_at: '2026-07-10T00:00:00.000Z',
    })),
    { marketplace: 'shopee', country: 'sg', query: 'anua official' },
  )
  assert.equal(table.length, 3)
  assert.equal(table[0].seller_type, 'mall')
  assert.equal(table[2].ships_from_overseas, true)

  const csv = exportRowsToCsv(table)
  assert.match(csv, /seller_type/)
  assert.match(csv, /Mall item/)
  assert.ok(csv.split('\n').length >= 4)
})

test('phase 2 routes and utils are wired', () => {
  assert.match(metricsUtil, /runMarketplaceMetricsDaily/)
  assert.match(metricsUtil, /marketplace_metrics_daily/)
  assert.match(exportUtil, /buildMarketplaceExportTable/)
  assert.match(exportUtil, /buildExportTable/)
  assert.match(metricsTick, /runMarketplaceMetricsDaily/)
  assert.match(metricsGet, /marketplace_metrics_daily/)
  assert.match(exportGet, /buildMarketplaceExportTable/)
  assert.match(exportGet, /format/)
  assert.match(listingsGet, /seller_type/)
  assert.match(snapshotsGet, /min_price/)
  assert.match(snapshotsGet, /overseas/)
  assert.match(seedsPatch, /computeNextRunAt/)
  assert.match(seedsPatch, /intel:write/)
  assert.match(readme, /Phase 2|metrics|export/i)
  assert.match(majorUpdate, /Phase 2/)
})
