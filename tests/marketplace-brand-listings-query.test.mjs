import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  BRAND_LISTING_COLUMNS,
  buildBrandRadarSummary,
  dedupeSnapshotsByListing,
  filterBrandListingRows,
  snapshotToBrandListingRow,
  soldBand,
  summarizeBrandListings,
} from '../marketplace/brandListingsQuery.mjs'
import { exportRowsToCsv } from '../marketplace/normalize/metrics.mjs'

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
