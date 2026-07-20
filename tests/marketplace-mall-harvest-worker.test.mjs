import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  browserHarvestEvaluate,
  mergeHarvestProducts,
  resolveShelvesForBrand,
} from '../marketplace/mallHarvestWorker.mjs'
import { shopCollectionListUrl } from '../marketplace/shopCollections.mjs'
import { harvestToObservationCards } from '../marketplace/shopProductExtract.mjs'

test('All Products URL uses sortBy=pop and product_list hash', () => {
  const url = shopCollectionListUrl('beautyofjoseonsg', { page: 0, sort_by: 'pop' })
  assert.match(url, /beautyofjoseonsg/)
  assert.match(url, /sortBy=pop/)
  assert.match(url, /#product_list/)
  assert.ok(!url.includes('shopCollection='))
})

test('page>0 includes page param', () => {
  const url = shopCollectionListUrl('beautyofjoseonsg', { page: 2, sort_by: 'pop' })
  assert.match(url, /page=2/)
})

test('mergeHarvestProducts dedupes by item and prefers sold', () => {
  const merged = mergeHarvestProducts([
    [
      {
        shop_id: '1',
        item_id: 'a',
        name: 'X',
        sold_label: null,
        category: 'All Products',
      },
    ],
    [
      {
        shop_id: '1',
        item_id: 'a',
        name: 'X',
        sold_label: '1k+ sold',
        sold_count_lower_bound: 1000,
        category: 'All Products',
      },
      {
        shop_id: '1',
        item_id: 'b',
        name: 'Y',
        sold_label: '100 sold',
        category: 'All Products',
      },
    ],
  ])
  assert.equal(merged.length, 2)
  assert.equal(merged.find((p) => p.item_id === 'a').sold_label, '1k+ sold')
})

test('browserHarvestEvaluate is a function for page.evaluate', () => {
  assert.equal(typeof browserHarvestEvaluate, 'function')
  assert.match(String(browserHarvestEvaluate), /sold_label/)
  assert.match(String(browserHarvestEvaluate), /shop-collection-view__item/)
})

test('harvest cards stamp brand for BOJ shape', () => {
  const cards = harvestToObservationCards(
    {
      shop_username: 'beautyofjoseonsg',
      products: [
        {
          name: 'BOJ Serum',
          sold_label: '9k+ sold',
          sold_count_lower_bound: 9000,
          category: 'All Products',
          shop_id: '1111230332',
          item_id: '1',
          listing_url: 'https://shopee.sg/x-i.1111230332.1',
          rank_position: 1,
        },
      ],
    },
    { brand_key: 'beauty-of-joseon' },
  )
  assert.equal(cards[0].signals.brand_key, 'beauty-of-joseon')
  assert.equal(cards[0].seller_type, 'mall')
  assert.equal(cards[0].sold_label, '9k+ sold')
})

test('CLI script exists', () => {
  const script = readFileSync(
    new URL('../scripts/mall-all-products-harvest.mjs', import.meta.url),
    'utf8',
  )
  assert.match(script, /harvestBrandAllProducts/)
  assert.match(script, /harvestBrandCollections/)
  assert.match(script, /userDataDir|SHOPEE_PROFILE_DIR/)
  assert.match(script, /pilot-only/)
  assert.match(script, /mode/)
})

test('resolveShelvesForBrand modes', () => {
  const brand = {
    shop_username: 'beautyofjoseonsg',
    metadata: {
      shop_collections: [
        { name: 'All Products', shop_collection_id: null, is_all_products: true },
        { name: 'Serums', shop_collection_id: '248405931', is_all_products: false },
        { name: 'Sunscreens', shop_collection_id: '248405946', is_all_products: false },
      ],
    },
  }
  assert.equal(resolveShelvesForBrand(brand, { mode: 'all' }).length, 1)
  assert.equal(resolveShelvesForBrand(brand, { mode: 'collections' }).length, 2)
  assert.equal(resolveShelvesForBrand(brand, { mode: 'both' }).length, 3)
  const onlySerum = resolveShelvesForBrand(brand, {
    mode: 'collections',
    collection_names: ['serum'],
  })
  assert.equal(onlySerum.length, 1)
  assert.match(onlySerum[0].name, /Serum/i)
})

test('harvest cards stamp shop_collection fields', () => {
  const cards = harvestToObservationCards(
    {
      shop_username: 'beautyofjoseonsg',
      shop_collection_name: 'Serums',
      shop_collection_id: '248405931',
      harvest_source: 'mall_collection_harvest',
      products: [
        {
          name: 'BOJ Eye Serum',
          sold_label: '30k+ sold',
          sold_count_lower_bound: 30000,
          category: 'Serums',
          shop_id: '1',
          item_id: '2',
          listing_url: 'https://shopee.sg/x-i.1.2',
        },
      ],
    },
    { brand_key: 'beauty-of-joseon' },
  )
  assert.equal(cards[0].signals.shop_collection_name, 'Serums')
  assert.equal(cards[0].signals.shop_collection_id, '248405931')
  assert.equal(cards[0].signals.category, 'Serums')
  assert.match(cards[0].search_query, /coll:248405931/)
})
