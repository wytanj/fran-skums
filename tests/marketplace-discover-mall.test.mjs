import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  brandNameMatchScore,
  discoverySearchQueries,
  pickMallShopDiscovery,
  rankMallDiscoveryCards,
  universePatchFromDiscovery,
} from '../marketplace/discoverMallShop.mjs'
import { cardsFromSearchPayload } from '../marketplace/shopee/parseSearch.mjs'
import { shopeeShopByIdUrl } from '../marketplace/shopee/urls.mjs'

test('discoverySearchQueries', () => {
  const q = discoverySearchQueries('Beauty of Joseon')
  assert.equal(q[0], 'Beauty of Joseon')
  assert.ok(q.some((x) => /official/i.test(x)))
})

test('shopeeShopByIdUrl', () => {
  assert.equal(shopeeShopByIdUrl('12345', 'sg'), 'https://shopee.sg/shop/12345')
})

test('rank + pick mall shop with username on card', () => {
  const cards = [
    {
      shop_id: '1',
      item_id: '2',
      title: 'Clone toner',
      shop_name: 'Random Reseller',
      seller_type: 'normal',
      rank_position: 1,
    },
    {
      shop_id: '99',
      item_id: '3',
      title: 'Beauty of Joseon Relief Sun Official',
      shop_name: 'Beauty of Joseon Official Store',
      seller_type: 'mall',
      rank_position: 2,
      signals: { is_official_shop: true, shop_username: 'beautyofjoseonsg' },
      raw: { is_official_shop: true, shop_username: 'beautyofjoseonsg' },
    },
  ]
  const ranked = rankMallDiscoveryCards(cards, { display_name: 'Beauty of Joseon' })
  assert.ok(ranked[0].username === 'beautyofjoseonsg')
  const picked = pickMallShopDiscovery(cards, {
    display_name: 'Beauty of Joseon',
    brand_key: 'beauty-of-joseon',
    auto_confirm: true,
  })
  assert.equal(picked.ok, true)
  assert.equal(picked.shop_username, 'beautyofjoseonsg')
  assert.equal(picked.status, 'confirmed')
  assert.equal(picked.source, 'serp')
})

test('pick uses shop_id → username map', () => {
  const cards = [
    {
      shop_id: '555',
      item_id: '1',
      title: 'COSRX Snail Mucin Official',
      shop_name: 'COSRX Official',
      seller_type: 'mall',
      signals: { is_official_shop: true },
      raw: { is_official_shop: true },
    },
  ]
  const picked = pickMallShopDiscovery(cards, {
    display_name: 'COSRX',
    username_by_shop_id: { 555: 'cosrx.sg' },
    auto_confirm: true,
  })
  assert.equal(picked.ok, true)
  assert.equal(picked.shop_username, 'cosrx.sg')
  assert.equal(picked.shop_url, 'https://shopee.sg/cosrx.sg')
})

test('brandNameMatchScore', () => {
  assert.ok(
    brandNameMatchScore(
      { shop_name: 'Beauty of Joseon Official', title: 'Relief Sun' },
      'Beauty of Joseon',
    ) >= 0.5,
  )
  assert.ok(
    brandNameMatchScore({ shop_name: 'Other', title: 'xyz' }, 'Beauty of Joseon') < 0.5,
  )
})

test('universePatchFromDiscovery', () => {
  const patch = universePatchFromDiscovery({
    ok: true,
    status: 'candidate',
    source: 'serp',
    shop_username: 'anua.sg',
    shop_url: 'https://shopee.sg/anua.sg',
    shop_id: '1',
    evidence: { x: 1 },
  })
  assert.equal(patch.shop_username, 'anua.sg')
  assert.equal(patch.shop_resolve_status, 'candidate')
})

test('fixture cards carry official signal after parse', async () => {
  const raw = readFileSync(
    new URL('../marketplace/shopee/fixtures/search-items-sample.json', import.meta.url),
    'utf8',
  )
  const cards = cardsFromSearchPayload(JSON.parse(raw), { query: 'anua', country: 'sg' })
  assert.ok(cards[0].signals?.is_official_shop === true || cards[0].raw?.is_official_shop)
})

test('discover script exists', () => {
  const script = readFileSync(
    new URL('../scripts/discover-mall-shops.mjs', import.meta.url),
    'utf8',
  )
  assert.match(script, /discoverMallShopWithPuppeteer/)
  assert.match(script, /materialize/)
})
