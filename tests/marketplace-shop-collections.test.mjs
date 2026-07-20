import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  extractShopCollectionsFromHtml,
  mergeShopCollectionsMetadata,
  parseShopCollectionId,
  shopCollectionListUrl,
} from '../marketplace/shopCollections.mjs'

test('parseShopCollectionId', () => {
  assert.equal(
    parseShopCollectionId(
      'https://shopee.sg/beautyofjoseonsg?shopCollection=248405931#product_list',
    ),
    '248405931',
  )
  assert.equal(parseShopCollectionId('https://shopee.sg/beautyofjoseonsg#product_list'), null)
})

test('shopCollectionListUrl', () => {
  assert.equal(
    shopCollectionListUrl('beautyofjoseonsg', {
      shop_collection_id: '248405931',
      page: 0,
      sort_by: 'pop',
    }),
    'https://shopee.sg/beautyofjoseonsg?shopCollection=248405931&sortBy=pop#product_list',
  )
  assert.match(
    shopCollectionListUrl('beautyofjoseonsg', { page: 2 }),
    /page=2/,
  )
})

test('extract collections from BOJ mall sample HTML', () => {
  const dir = 'extensions/sample-beauty-of-joseon'
  if (!existsSync(dir)) return
  const htmlFile = readdirSync(dir).find((f) => f.endsWith('.html'))
  const html = readFileSync(join(dir, htmlFile), 'utf8')
  const disc = extractShopCollectionsFromHtml(html, {
    page_url: 'https://shopee.sg/beautyofjoseonsg',
  })

  assert.equal(disc.shop_username, 'beautyofjoseonsg')
  assert.ok(disc.collections.length >= 5, `got ${disc.collections.length}`)

  const all = disc.collections.find((c) => c.is_all_products)
  assert.ok(all)
  assert.equal(all.shop_collection_id, null)

  const names = disc.collections.map((c) => c.name.toLowerCase())
  assert.ok(names.some((n) => /serum/i.test(n)))
  assert.ok(names.some((n) => /sunscreen/i.test(n)))

  const serums = disc.collections.find((c) => /serum/i.test(c.name))
  assert.ok(serums?.shop_collection_id)
  assert.match(serums.url, /shopCollection=/)
})

test('mergeShopCollectionsMetadata preserves other keys', () => {
  const meta = mergeShopCollectionsMetadata(
    { foo: 1, brand_key: 'x' },
    {
      shop_username: 'beautyofjoseonsg',
      collections: [{ name: 'Serums', shop_collection_id: '1', url: '', is_all_products: false }],
      discovered_at: '2026-07-20T00:00:00.000Z',
    },
  )
  assert.equal(meta.foo, 1)
  assert.equal(meta.shop_collections.length, 1)
  assert.equal(meta.shop_collections_discovered_at, '2026-07-20T00:00:00.000Z')
})

test('collections API route exists', () => {
  const route = readFileSync(
    new URL('../server/api/v1/marketplace/brand-universe/collections.post.ts', import.meta.url),
    'utf8',
  )
  assert.match(route, /intel:write/)
  assert.match(route, /mergeShopCollectionsMetadata/)
})
