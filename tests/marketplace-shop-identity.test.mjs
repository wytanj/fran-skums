import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildSeedsForUniverse,
  buildShopSeedRow,
  buildBrandPortfolioSeedRow,
} from '../marketplace/materializeBrandSeeds.mjs'
import {
  heuristicShopUsernameCandidates,
  resolveShopFromManualUrl,
  resolveShopFromSerpCards,
  shouldUseShopPrimary,
  SHOP_RESOLVE_STRATEGY,
} from '../marketplace/resolveShopUsername.mjs'
import {
  parseShopeeShopUsername,
  shopeeShopUrl,
  sanitizeShopUsername,
} from '../marketplace/shopee/urls.mjs'
import { mockCollectAdapter } from '../marketplace/collectors/mock/adapter.mjs'
import { stampBrandSignalsOnCards } from '../marketplace/stampBrandSignals.mjs'

const mig069 = readFileSync(
  new URL('../core/db/069_brand_universe_shop_identity.sql', import.meta.url),
  'utf8',
)
const sb069 = readFileSync(
  new URL('../supabase/migrations/202607200069_brand_universe_shop_identity.sql', import.meta.url),
  'utf8',
)

test('069 migration mirrored', () => {
  assert.equal(mig069, sb069)
  assert.match(mig069, /shop_username/)
  assert.match(mig069, /shop_resolve_status/)
})

test('parseShopeeShopUsername from Mall URL with query', () => {
  const u = parseShopeeShopUsername(
    'https://shopee.sg/beautyofjoseonsg?categoryId=100630&entryPoint=ShopByPDP&itemId=28707244664',
  )
  assert.equal(u, 'beautyofjoseonsg')
  assert.equal(shopeeShopUrl('beautyofjoseonsg', 'sg'), 'https://shopee.sg/beautyofjoseonsg')
  assert.equal(sanitizeShopUsername('BeautyOfJoseonSG'), 'beautyofjoseonsg')
  assert.equal(parseShopeeShopUsername('https://shopee.sg/Foo-i.123.456'), null)
})

test('resolveShopFromManualUrl confirms', () => {
  const r = resolveShopFromManualUrl(
    'https://shopee.sg/beautyofjoseonsg?categoryId=100630&itemId=1',
    { brand_key: 'beauty-of-joseon' },
  )
  assert.equal(r.ok, true)
  assert.equal(r.status, 'confirmed')
  assert.equal(r.source, 'manual')
  assert.equal(r.shop_username, 'beautyofjoseonsg')
})

test('heuristic candidates never auto-confirm', () => {
  const c = heuristicShopUsernameCandidates('Beauty of Joseon', { country: 'sg' })
  assert.ok(c.includes('beautyofjoseon') || c.some((x) => x.includes('beautyofjoseon')))
  assert.ok(c.some((x) => x.endsWith('sg')))
  assert.ok(SHOP_RESOLVE_STRATEGY.do_not.length >= 2)
})

test('resolveShopFromSerpCards prefers mall', () => {
  const r = resolveShopFromSerpCards(
    [
      {
        seller_type: 'normal',
        shop_name: 'Random',
        title: 'Beauty of Joseon clone',
        listing_url: 'https://shopee.sg/x-i.1.2',
      },
      {
        seller_type: 'mall',
        shop_name: 'Beauty of Joseon Official',
        title: 'Relief Sun',
        shop_url: 'https://shopee.sg/beautyofjoseonsg',
        shop_id: '99',
        rank_position: 1,
      },
    ],
    { display_name: 'Beauty of Joseon' },
  )
  assert.equal(r.ok, true)
  assert.equal(r.shop_username, 'beautyofjoseonsg')
  assert.equal(r.status, 'candidate')
  assert.equal(r.source, 'serp')
})

test('shouldUseShopPrimary only when confirmed (or candidate if allowed)', () => {
  assert.equal(
    shouldUseShopPrimary({ shop_username: 'x', shop_resolve_status: 'unknown' }),
    false,
  )
  assert.equal(
    shouldUseShopPrimary({ shop_username: 'x', shop_resolve_status: 'candidate' }),
    false,
  )
  assert.equal(
    shouldUseShopPrimary(
      { shop_username: 'x', shop_resolve_status: 'candidate' },
      { allow_candidate: true },
    ),
    true,
  )
  assert.equal(
    shouldUseShopPrimary({ shop_username: 'beautyofjoseonsg', shop_resolve_status: 'confirmed' }),
    true,
  )
})

test('buildSeedsForUniverse shop_primary vs serp_only', () => {
  const base = {
    id: 'u1',
    workspace_id: 'ws',
    brand_key: 'beauty-of-joseon',
    display_name: 'Beauty of Joseon',
    pilot_tier: 'pilot',
    official_interest: true,
    shopee_mall_interest: true,
    country: 'sg',
  }

  const serp = buildSeedsForUniverse(base)
  assert.equal(serp.strategy, 'serp_only')
  assert.equal(serp.primary.mode, 'brand_portfolio')
  assert.equal(serp.primary.target, 'Beauty of Joseon')
  assert.equal(serp.secondary, null)

  const shop = buildSeedsForUniverse({
    ...base,
    shop_username: 'beautyofjoseonsg',
    shop_url: 'https://shopee.sg/beautyofjoseonsg',
    shop_resolve_status: 'confirmed',
  })
  assert.equal(shop.strategy, 'shop_primary')
  assert.equal(shop.primary.mode, 'shop')
  assert.equal(shop.primary.target, 'beautyofjoseonsg')
  assert.ok(shop.secondary)
  assert.equal(shop.secondary.mode, 'brand_portfolio')
})

test('mock shop mode + stamp shop_username', async () => {
  const seed = {
    id: 's1',
    target: 'beautyofjoseonsg',
    mode: 'shop',
    max_listings: 2,
    detail_top_n: 0,
    country: 'sg',
    metadata: {
      brand_key: 'beauty-of-joseon',
      shop_username: 'beautyofjoseonsg',
      universe_id: 'u1',
    },
  }
  const result = await mockCollectAdapter.scrapeSeed(seed, 'job')
  assert.equal(result.session_health, 'ok')
  assert.ok(result.cards[0].signals.shop_username === 'beautyofjoseonsg')
  assert.equal(result.cards[0].seller_type, 'mall')

  const stamped = stampBrandSignalsOnCards(result.cards, seed)
  assert.equal(stamped[0].signals.brand_key, 'beauty-of-joseon')
  assert.equal(stamped[0].signals.official_shop, true)
  assert.equal(stamped[0].search_query, 'shop:beautyofjoseonsg')
})

test('buildShopSeedRow requires username', () => {
  assert.throws(() =>
    buildShopSeedRow({ brand_key: 'x', display_name: 'X', workspace_id: 'ws' }),
  )
  const row = buildShopSeedRow({
    brand_key: 'cosrx',
    display_name: 'COSRX',
    workspace_id: 'ws',
    shop_username: 'cosrx.sg',
    shop_resolve_status: 'confirmed',
    pilot_tier: 'pilot',
  })
  assert.equal(row.mode, 'shop')
  assert.equal(row.target, 'cosrx.sg')
})
