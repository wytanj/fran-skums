import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allocateSheetNames,
  sheetNameForBrand,
} from '../marketplace/exportBrandWorkbook.mjs'
import {
  BRAND_LISTING_COLUMNS,
  rowLooksLikeSalesSort,
  snapshotToBrandListingRow,
} from '../marketplace/brandListingsQuery.mjs'

test('sheetNameForBrand sanitizes Excel-illegal characters and length', () => {
  assert.equal(sheetNameForBrand('beauty-of-joseon'), 'beauty-of-joseon')
  assert.ok(!sheetNameForBrand('a/b\\c?d*e[f]g:h').match(/[\\/?*[\]:]/))
  assert.ok(sheetNameForBrand('x'.repeat(50)).length <= 31)
})

test('allocateSheetNames avoids collisions after truncation', () => {
  const keys = ['brand-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'brand-aaaaaaaaaaaaaaaaaaaaaaaaaaab']
  const map = allocateSheetNames(keys)
  const names = [...map.values()]
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length)
  assert.ok(names.every((n) => n.length <= 31))
  assert.ok(!names.includes('_index'))
})

test('BRAND_LISTING_COLUMNS includes MH-14 sales fields and price', () => {
  assert.ok(BRAND_LISTING_COLUMNS.includes('sort_by'))
  assert.ok(BRAND_LISTING_COLUMNS.includes('sales_rank'))
  assert.ok(BRAND_LISTING_COLUMNS.includes('price'))
  assert.ok(BRAND_LISTING_COLUMNS.includes('currency'))
})

test('snapshotToBrandListingRow projects sales_rank from signals', () => {
  const row = snapshotToBrandListingRow({
    listing_id: 'L1',
    sold_label: '1k sold',
    sold_count_lower_bound: 1000,
    crawled_at: '2026-07-31T00:00:00Z',
    signals: {
      brand_key: 'cosrx',
      sort_by: 'sales',
      sales_rank: 3,
      sales_rank_page: 0,
      sales_rank_on_page: 3,
      harvest_source: 'mall_all_products_sales',
    },
    marketplace_listings: {
      title: 'Test',
      shop_id: '1',
      item_id: '2',
    },
  })
  assert.equal(row.sort_by, 'sales')
  assert.equal(row.sales_rank, 3)
  assert.ok(rowLooksLikeSalesSort(row))
  assert.ok(!rowLooksLikeSalesSort({ sort_by: 'pop', harvest_source: 'mall_all_products_harvest' }))
})

test('enrichRowsWithPlatformBreadcrumbs fills missing path from other snaps', async () => {
  const { enrichRowsWithPlatformBreadcrumbs } = await import(
    '../marketplace/brandListingsQuery.mjs'
  )
  const calls = []
  const db = {
    from(table) {
      calls.push(table)
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        in() {
          return this
        },
        not() {
          return this
        },
        order() {
          return Promise.resolve({
            data: [
              {
                listing_id: 'L-missing',
                platform_category_leaf: 'Blusher',
                crawled_at: '2026-07-20T00:00:00Z',
                signals: {
                  platform_category_path_text:
                    'Shopee > Beauty & Personal Care > Makeup > Blusher',
                },
              },
            ],
            error: null,
          })
        },
      }
    },
  }
  const rows = [
    {
      listing_id: 'L-missing',
      title: 'X',
      platform_category_leaf: null,
      platform_category_path_text: null,
    },
    {
      listing_id: 'L-has',
      title: 'Y',
      platform_category_leaf: 'Mask',
      platform_category_path_text: 'Shopee > Beauty & Personal Care > Skincare > Mask',
    },
  ]
  await enrichRowsWithPlatformBreadcrumbs(db, 'ws', rows)
  assert.equal(rows[0].platform_category_leaf, 'Blusher')
  assert.match(rows[0].platform_category_path_text, /Blusher/)
  assert.equal(rows[1].platform_category_leaf, 'Mask')
  assert.ok(calls.includes('marketplace_listing_snapshots'))
})

test('enrichRowsWithPrice fills missing price from other snaps', async () => {
  const { enrichRowsWithPrice } = await import('../marketplace/brandListingsQuery.mjs')
  const db = {
    from() {
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        in() {
          return this
        },
        not() {
          return this
        },
        order() {
          return Promise.resolve({
            data: [
              {
                listing_id: 'L-no-price',
                price: 26.9,
                currency: 'SGD',
                crawled_at: '2026-08-03T12:00:00Z',
              },
            ],
            error: null,
          })
        },
      }
    },
  }
  const rows = [
    { listing_id: 'L-no-price', title: 'Mask', price: null, currency: null },
    { listing_id: 'L-has', title: 'Serum', price: 18.5, currency: 'SGD' },
  ]
  await enrichRowsWithPrice(db, 'ws', rows)
  assert.equal(rows[0].price, 26.9)
  assert.equal(rows[0].currency, 'SGD')
  assert.equal(rows[1].price, 18.5)
})

test('snapshotToBrandListingRow projects price', () => {
  const row = snapshotToBrandListingRow({
    listing_id: 'L1',
    price: 22.64,
    currency: 'SGD',
    sold_label: '1k+ Sold/Month',
    sold_count_lower_bound: 1000,
    signals: { brand_key: 'biodance', harvest_source: 'mall_all_products_harvest' },
    marketplace_listings: { title: 'Eye Patch', shop_id: '1', item_id: '2' },
  })
  assert.equal(row.price, 22.64)
  assert.equal(row.currency, 'SGD')
})
