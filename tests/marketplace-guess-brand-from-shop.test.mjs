import assert from 'node:assert/strict'
import test from 'node:test'
import {
  guessBrandForShop,
  scoreBrandAgainstShop,
  usernameFromShopUrl,
} from '../marketplace/guessBrandFromShop.mjs'

const brands = [
  {
    brand_key: 'beauty-of-joseon',
    display_name: 'Beauty of Joseon',
    shop_username: null,
    shop_resolve_status: null,
    pilot_tier: 'pilot',
  },
  {
    brand_key: 'cosrx',
    display_name: 'COSRX',
    shop_username: null,
    shop_resolve_status: null,
    pilot_tier: 'pilot',
  },
  {
    brand_key: 'anua',
    display_name: 'Anua',
    shop_username: 'anua.sg',
    shop_resolve_status: 'confirmed',
    pilot_tier: 'pilot',
  },
]

test('usernameFromShopUrl parses mall path', () => {
  assert.equal(usernameFromShopUrl('https://shopee.sg/beautyofjoseonsg?page=0'), 'beautyofjoseonsg')
  assert.equal(usernameFromShopUrl('https://shopee.sg/search?keyword=x'), null)
  assert.equal(usernameFromShopUrl('https://shopee.sg/Foo-Bar-i.1.2'), null)
})

test('guess beautyofjoseonsg → beauty-of-joseon', () => {
  const g = guessBrandForShop(brands, { shop_username: 'beautyofjoseonsg' })
  assert.ok(g)
  assert.equal(g.brand.brand_key, 'beauty-of-joseon')
  assert.ok(g.score >= 80)
})

test('guess cosrx.sg → cosrx', () => {
  const g = guessBrandForShop(brands, { shop_username: 'cosrx.sg' })
  assert.ok(g)
  assert.equal(g.brand.brand_key, 'cosrx')
})

test('exact already-linked username scores highest', () => {
  const s = scoreBrandAgainstShop(brands[2], 'anua.sg', '')
  assert.equal(s, 1000)
})
