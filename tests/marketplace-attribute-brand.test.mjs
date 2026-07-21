import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  attributeBrandFromTitle,
  attributeProductsToBrands,
  normalizeBrandKeyList,
} from '../marketplace/attributeBrandFromTitle.mjs'
import { harvestToObservationCards } from '../marketplace/shopProductExtract.mjs'
import {
  mergeDistributorMetadata,
  isMultiBrandDistributor,
} from '../marketplace/distributorShop.mjs'
import { stampBrandSignalsOnCards } from '../marketplace/stampBrandSignals.mjs'

const brands = [
  { brand_key: 'laneige', display_name: 'Laneige' },
  { brand_key: 'mise-en-scene', display_name: 'Mise en Scene' },
  { brand_key: 'ryo', display_name: 'Ryo' },
]

test('attributeBrandFromTitle matches display name in title', () => {
  const a = attributeBrandFromTitle(
    'Laneige Official Cream Skin Refiner 150ml',
    brands,
  )
  assert.equal(a.brand_key, 'laneige')
  assert.equal(a.method, 'title_match')
})

test('attributeBrandFromTitle prefers longer brand names', () => {
  const a = attributeBrandFromTitle(
    'Mise en Scene Perfect Serum Rose Perfume Hair Oil',
    brands,
  )
  assert.equal(a.brand_key, 'mise-en-scene')
})

test('attributeBrandFromTitle none when no match', () => {
  const a = attributeBrandFromTitle('Generic Shampoo 500ml', brands)
  assert.equal(a.brand_key, null)
  assert.equal(a.method, 'none')
})

test('attributeProductsToBrands stamps brand_key', () => {
  const out = attributeProductsToBrands(
    [
      { name: 'Ryo Hair Loss Care Shampoo', shop_id: '1', item_id: '2' },
      { name: 'Unknown Item', shop_id: '1', item_id: '3' },
    ],
    brands,
  )
  assert.equal(out[0].brand_key, 'ryo')
  assert.equal(out[1].brand_key, null)
})

test('harvestToObservationCards multi_brand attribution', () => {
  const cards = harvestToObservationCards(
    {
      shop_username: 'amorepacific.hair.body.shop',
      active_category: 'All Products',
      harvest_source: 'mall_list_harvest',
      products: [
        {
          name: 'Laneige Lip Sleeping Mask',
          sold_label: '1k+ sold',
          sold_count_lower_bound: 1000,
          shop_id: '9',
          item_id: '1',
          listing_url: 'https://shopee.sg/x-i.9.1',
        },
      ],
    },
    {
      multi_brand: true,
      brand_profiles: brands,
    },
  )
  assert.equal(cards[0].signals.brand_key, 'laneige')
  assert.equal(cards[0].signals.shop_kind, 'multi_brand_distributor')
})

test('mergeDistributorMetadata + isMultiBrandDistributor', () => {
  const meta = mergeDistributorMetadata({}, {
    shop_username: 'amorepacific.hair.body.shop',
    brand_keys: ['laneige', 'ryo', 'laneige'],
  })
  assert.equal(meta.shop_kind, 'multi_brand_distributor')
  assert.deepEqual(meta.distributor_brand_keys, ['laneige', 'ryo'])
  assert.ok(
    isMultiBrandDistributor({
      shop_kind: 'multi_brand_distributor',
      metadata: meta,
    }),
  )
})

test('normalizeBrandKeyList', () => {
  assert.deepEqual(normalizeBrandKeyList(['A', 'a', 'B']), ['a', 'b'])
})

test('stampBrandSignals preserves multi-brand per-SKU brand_key', () => {
  const cards = harvestToObservationCards(
    {
      shop_username: 'amorepacific.hair.body.shop',
      products: [
        {
          name: 'Ryo Damage Care Shampoo',
          shop_id: '1',
          item_id: '9',
          listing_url: 'https://shopee.sg/x-i.1.9',
        },
      ],
    },
    { multi_brand: true, brand_profiles: brands },
  )
  const stamped = stampBrandSignalsOnCards(cards, {
    target: 'amorepacific.hair.body.shop',
    mode: 'shop',
    metadata: {
      brand_key: 'laneige',
      shop_kind: 'multi_brand_distributor',
      shop_username: 'amorepacific.hair.body.shop',
    },
  })
  assert.equal(stamped[0].signals.brand_key, 'ryo')
})

test('API + extension MH-7 wired', () => {
  const api = readFileSync(
    new URL(
      '../server/api/v1/marketplace/brand-universe/resolve-distributor-shop.post.ts',
      import.meta.url,
    ),
    'utf8',
  )
  assert.match(api, /resolveDistributorShop/)

  const panel = readFileSync(
    new URL('../extensions/skums-shopee-shop-resolve/panel.js', import.meta.url),
    'utf8',
  )
  assert.match(panel, /multiBrandToggle|multiBrandMode/)
  assert.match(panel, /resolve-distributor-shop/)

  const mig = readFileSync(
    new URL(
      '../supabase/migrations/202607210070_brand_universe_multi_brand_shop.sql',
      import.meta.url,
    ),
    'utf8',
  )
  assert.match(mig, /multi_brand_distributor/)
})
