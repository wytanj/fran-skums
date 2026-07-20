import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  extractShopProductsFromHtml,
  harvestToObservationCards,
  parseShopPageContext,
  productNameFromHref,
} from '../marketplace/shopProductExtract.mjs'

const sampleDir = 'extensions/sample-beauty-of-joseon'

test('parse shop page URL context', () => {
  const ctx = parseShopPageContext(
    'https://shopee.sg/beautyofjoseonsg?page=0&sortBy=pop&tab=0',
  )
  assert.equal(ctx.shop_username, 'beautyofjoseonsg')
  assert.equal(ctx.page, 0)
  assert.equal(ctx.sort_by, 'pop')
})

test('product name from href slug', () => {
  const name = productNameFromHref(
    'https://shopee.sg/Beauty-Of-Joseon-Glow-Serum-Propolis-Niacinamide-(30ml)-i.1111230332.25800411138',
  )
  assert.match(name, /Glow Serum/i)
  assert.match(name, /Niacinamide/i)
})

test('extract products from saved BOJ shop HTML', () => {
  if (!existsSync(sampleDir)) {
    console.log('skip: sample folder missing')
    return
  }
  const htmlFile = readdirSync(sampleDir).find((f) => f.endsWith('.html'))
  assert.ok(htmlFile)
  const html = readFileSync(join(sampleDir, htmlFile), 'utf8')
  const harvest = extractShopProductsFromHtml(html, {
    page_url: 'https://shopee.sg/beautyofjoseonsg?page=0&sortBy=pop&tab=0',
  })

  assert.equal(harvest.shop_username, 'beautyofjoseonsg')
  // Saved HTML snapshot is a partial page (~13 unique cards with sold); live pages paginate further.
  assert.ok(harvest.product_count >= 10, `expected products from sample, got ${harvest.product_count}`)
  assert.equal(harvest.shop_id, '1111230332')

  const withSold = harvest.products.filter((p) => p.sold_label)
  assert.ok(withSold.length >= 10, `expected sold labels, got ${withSold.length}`)
  assert.ok(withSold.every((p) => p.name && p.sold_label && p.category))

  const sample = harvest.products.find((p) => /Relief Sun|Glow Serum|Eye Serum/i.test(p.name || ''))
  assert.ok(sample, 'expected known BOJ product name')
  assert.ok(sample.category)

  const cards = harvestToObservationCards(harvest, { brand_key: 'beauty-of-joseon' })
  assert.equal(cards.length, harvest.product_count)
  assert.equal(cards[0].seller_type, 'mall')
  assert.equal(cards[0].signals.brand_key, 'beauty-of-joseon')
  assert.equal(cards[0].signals.category, sample.category)
})

test('shop-harvest API route exists', () => {
  const route = readFileSync(
    new URL('../server/api/v1/marketplace/shop-harvest.post.ts', import.meta.url),
    'utf8',
  )
  assert.match(route, /intel:write/)
  assert.match(route, /harvestToObservationCards/)
})

test('extension harvest message type', () => {
  const content = readFileSync(
    new URL('../extensions/skums-shopee-shop-resolve/content.js', import.meta.url),
    'utf8',
  )
  assert.match(content, /SKUMS_HARVEST_SHOP/)
  assert.match(content, /sold_label/)
  assert.match(content, /shop-collection-view__item/)
})
