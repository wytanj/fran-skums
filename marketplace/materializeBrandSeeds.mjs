/**
 * Pure helpers: brand universe → crawl seed rows.
 * Prefers mode=shop when shop_username is confirmed (official Mall path).
 */

import { brandUniversePriority } from './brandKey.mjs'
import { shouldUseShopPrimary } from './resolveShopUsername.mjs'
import { computeNextRunAt } from './scheduler.mjs'
import { shopeeShopUrl } from './shopee/urls.mjs'

/** UTC preferred hour for weekly brand collect (≈ 18:00 SGT). */
export const BRAND_PORTFOLIO_PREFERRED_HOUR_UTC = 10

/** Default weekly_day: Sunday (UTC dow). */
export const BRAND_PORTFOLIO_WEEKLY_DAY = 0

/**
 * Shared seed schedule / limits from universe.
 * @param {object} universe
 * @param {object} opts
 */
function baseSeedFields(universe, opts = {}) {
  const tier = universe.pilot_tier || 'pilot'
  const max_listings = tier === 'pilot' ? 30 : 40
  const preferred_hour =
    opts.preferred_hour != null
      ? Number(opts.preferred_hour)
      : BRAND_PORTFOLIO_PREFERRED_HOUR_UTC
  const weekly_day =
    opts.weekly_day != null ? Number(opts.weekly_day) : BRAND_PORTFOLIO_WEEKLY_DAY
  const schedule_kind = opts.schedule_kind || 'weekly'
  const collector_id = opts.collector_id || 'shopee_puppeteer'
  const enabled = opts.enabled !== false

  const priority =
    universe.priority != null
      ? Number(universe.priority)
      : brandUniversePriority(universe.official_interest, universe.shopee_mall_interest)

  // Shop seeds slightly higher priority than SERP for same brand
  const priorityBoost = opts.mode === 'shop' ? 10 : 0

  const now = opts.now ? new Date(opts.now) : new Date()
  const next = computeNextRunAt(now, {
    schedule_kind,
    preferred_hour,
    weekly_day,
    schedule_cron: null,
  })

  return {
    workspace_id: universe.workspace_id,
    marketplace: universe.marketplace || 'shopee',
    country: String(universe.country || 'sg').toLowerCase(),
    enabled,
    schedule_kind,
    schedule_cron: null,
    timezone: 'Asia/Singapore',
    preferred_hour,
    weekly_day: schedule_kind === 'weekly' ? weekly_day : null,
    max_pages: 2,
    max_listings,
    detail_top_n: 0,
    priority: priority + priorityBoost,
    collector_id,
    next_run_at: next ? next.toISOString() : null,
  }
}

function brandMeta(universe, extra = {}) {
  const brand_key = String(universe.brand_key || '').trim()
  const display_name = String(universe.display_name || '').trim()
  return {
    brand_key,
    display_name,
    categories: Array.isArray(universe.categories) ? universe.categories : [],
    origin_country: universe.origin_country ?? null,
    official_interest: universe.official_interest ?? null,
    shopee_mall_interest: Boolean(universe.shopee_mall_interest),
    iherb_interest: Boolean(universe.iherb_interest),
    universe_id: universe.id || null,
    source: universe.source || 'sample-brands.csv',
    preferred_hour_note: 'UTC',
    pilot_tier: universe.pilot_tier || 'pilot',
    shop_username: universe.shop_username || null,
    shop_url: universe.shop_url || null,
    shop_id: universe.shop_id || null,
    shop_resolve_status: universe.shop_resolve_status || null,
    ...extra,
  }
}

/**
 * Keyword / brand_portfolio SERP seed (market context).
 * @param {object} universe
 * @param {object} [opts]
 */
export function buildBrandPortfolioSeedRow(universe, opts = {}) {
  if (!universe?.display_name) {
    throw new Error('universe.display_name is required')
  }
  const display_name = String(universe.display_name).trim()
  const brand_key = String(universe.brand_key || '').trim()
  if (!brand_key) throw new Error('universe.brand_key is required')

  const base = baseSeedFields(universe, { ...opts, mode: 'brand_portfolio' })
  return {
    ...base,
    mode: 'brand_portfolio',
    target: display_name,
    metadata: brandMeta(universe, {
      query_variants: [display_name],
      seed_role: 'serp_market',
    }),
  }
}

/**
 * Official Mall shop storefront seed.
 * target = shop_username (e.g. beautyofjoseonsg)
 * @param {object} universe
 * @param {object} [opts]
 */
export function buildShopSeedRow(universe, opts = {}) {
  const username = String(universe.shop_username || '').trim()
  if (!username) throw new Error('universe.shop_username is required for shop seed')
  const brand_key = String(universe.brand_key || '').trim()
  if (!brand_key) throw new Error('universe.brand_key is required')

  const country = String(universe.country || 'sg').toLowerCase()
  const shop_url = universe.shop_url || shopeeShopUrl(username, country)

  const base = baseSeedFields(universe, { ...opts, mode: 'shop' })
  return {
    ...base,
    mode: 'shop',
    target: username,
    metadata: brandMeta(universe, {
      shop_username: username,
      shop_url,
      seed_role: 'official_shop',
      query_variants: [username],
    }),
  }
}

/**
 * Materialize plan for one universe row.
 * - confirmed shop → primary mode=shop (+ optional SERP secondary)
 * - else → brand_portfolio SERP only
 *
 * @param {object} universe
 * @param {{
 *   collector_id?: string
 *   enabled?: boolean
 *   include_serp_secondary?: boolean  // default true when shop primary
 *   allow_candidate_shop?: boolean
 *   now?: Date | string
 * }} [opts]
 * @returns {{ primary: object, secondary: object | null, strategy: string }}
 */
export function buildSeedsForUniverse(universe, opts = {}) {
  const useShop = shouldUseShopPrimary(universe, {
    allow_candidate: Boolean(opts.allow_candidate_shop),
  })
  const includeSerp =
    opts.include_serp_secondary !== false && useShop

  if (useShop) {
    const primary = buildShopSeedRow(universe, opts)
    // SERP secondary slightly lower priority
    const secondary = includeSerp
      ? {
          ...buildBrandPortfolioSeedRow(universe, opts),
          priority: Math.max(1, (primary.priority || 100) - 20),
          enabled: opts.serp_enabled !== false ? primary.enabled : false,
          metadata: {
            ...buildBrandPortfolioSeedRow(universe, opts).metadata,
            seed_role: 'serp_market_secondary',
          },
        }
      : null
    return {
      primary,
      secondary,
      strategy: 'shop_primary',
    }
  }

  return {
    primary: buildBrandPortfolioSeedRow(universe, opts),
    secondary: null,
    strategy: 'serp_only',
  }
}

/**
 * Upsert conflict key fields for seeds unique constraint.
 * unique (workspace_id, marketplace, country, mode, target)
 */
export function seedUpsertConflictColumns() {
  return 'workspace_id,marketplace,country,mode,target'
}

/**
 * Filter universe rows for materialize.
 * @param {object[]} rows
 * @param {{
 *   brand_keys?: string[] | null
 *   pilot_tier?: string | null
 *   require_enabled?: boolean
 * }} filter
 */
export function filterUniverseForMaterialize(rows, filter = {}) {
  const keys = Array.isArray(filter.brand_keys)
    ? filter.brand_keys.map((k) => String(k).toLowerCase().trim()).filter(Boolean)
    : null
  const tier = filter.pilot_tier ? String(filter.pilot_tier) : null
  const requireEnabled = filter.require_enabled !== false

  return (rows || []).filter((r) => {
    if (requireEnabled && r.enabled === false) return false
    if (keys && keys.length) {
      return keys.includes(String(r.brand_key).toLowerCase())
    }
    if (tier) {
      return r.pilot_tier === tier
    }
    return false
  })
}
