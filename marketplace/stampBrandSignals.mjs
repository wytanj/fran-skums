/**
 * Stamp durable brand identity onto collect cards before warehouse write.
 * Required for brand_portfolio metrics join (signals.brand_key).
 */

import { brandKeyFromDisplayName } from './brandKey.mjs'

/**
 * Resolve brand_key / universe_id from seed metadata (materialize) or target.
 * @param {object} seed
 * @returns {{ brand_key: string, universe_id: string | null, search_query: string }}
 */
export function resolveBrandIdentityFromSeed(seed) {
  const meta = seed?.metadata && typeof seed.metadata === 'object' ? seed.metadata : {}
  const target = String(seed?.target || '').trim()
  const brand_key =
    (meta.brand_key && String(meta.brand_key).trim()) ||
    brandKeyFromDisplayName(target) ||
    'unknown'
  const universe_id =
    meta.universe_id != null && String(meta.universe_id).trim()
      ? String(meta.universe_id)
      : null
  return {
    brand_key,
    universe_id,
    search_query: target,
  }
}

/**
 * Stamp search_query + signals.brand_key (+ universe_id, shop_username) on every card.
 * keyword and brand_portfolio both get human-readable search_query = seed.target.
 * shop mode: search_query = shop:{username} if missing.
 *
 * @param {Array<Record<string, any>>} cards
 * @param {object} seed
 * @returns {Array<Record<string, any>>}
 */
export function stampBrandSignalsOnCards(cards, seed) {
  const list = Array.isArray(cards) ? cards : []
  const { brand_key, universe_id, search_query } = resolveBrandIdentityFromSeed(seed)
  const meta = seed?.metadata && typeof seed.metadata === 'object' ? seed.metadata : {}
  const shop_username =
    (meta.shop_username && String(meta.shop_username).trim()) ||
    (seed?.mode === 'shop' ? String(seed.target || '').trim() : '') ||
    null
  const defaultQuery =
    seed?.mode === 'shop' && shop_username
      ? `shop:${shop_username}`
      : search_query

  return list.map((card) => {
    const signals = {
      ...(card.signals && typeof card.signals === 'object' ? card.signals : {}),
      brand_key,
    }
    if (universe_id) signals.universe_id = universe_id
    if (shop_username) signals.shop_username = shop_username
    if (seed?.mode === 'shop') signals.official_shop = true

    const raw = {
      ...(card.raw && typeof card.raw === 'object' ? card.raw : {}),
      brand_key,
    }
    if (universe_id) raw.universe_id = universe_id
    if (shop_username) raw.shop_username = shop_username

    return {
      ...card,
      search_query: card.search_query || defaultQuery || undefined,
      signals,
      raw,
    }
  })
}

/**
 * Session health values that must stop the batch (not continue to next seed).
 * @param {string | null | undefined} health
 */
export function isSessionStopHealth(health) {
  return health === 'login_required' || health === 'blocked'
}

/**
 * Inter-seed delay for live puppeteer only (ms). Mock / CF / BB → 0.
 * @param {string} collectorId
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function interSeedSleepMs(collectorId, env = process.env) {
  if (collectorId !== 'shopee_puppeteer') return 0
  const n = Number(env.SHOPEE_INTER_SEED_MS ?? 8000)
  if (!Number.isFinite(n) || n < 0) return 8000
  return n
}
