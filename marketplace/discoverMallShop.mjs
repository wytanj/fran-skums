/**
 * Automated Mall / official shop_username discovery (pre-scrape).
 *
 * Pipeline (no LLM as source of truth):
 *  1. Keyword SERP cards (brand / brand+official)
 *  2. Prefer mall + official_brand seller types
 *  3. Username from: card signals, shop profile href, or shop/{id} redirect
 *  4. Optional heuristic probe list (verify by page load elsewhere)
 *  5. Confirm when official/mall + brand-name match + username resolved
 */

import {
  heuristicShopUsernameCandidates,
  resolveShopFromManualUrl,
  resolveShopFromSerpCards,
} from './resolveShopUsername.mjs'
import { parseShopeeShopUsername, sanitizeShopUsername, shopeeShopUrl } from './shopee/urls.mjs'

/**
 * Score how well a card matches the brand display name.
 * @param {object} card
 * @param {string} displayName
 */
export function brandNameMatchScore(card, displayName) {
  const display = String(displayName || '').toLowerCase()
  const tokens = display.split(/[^a-z0-9]+/).filter((t) => t.length > 2)
  if (!tokens.length) return 0
  const blob = `${card.shop_name || ''} ${card.title || ''}`.toLowerCase()
  let hits = 0
  for (const t of tokens) if (blob.includes(t)) hits++
  return hits / tokens.length
}

/**
 * Rank SERP cards for official Mall discovery.
 * @param {Array<Record<string, any>>} cards
 * @param {{ display_name: string }} opts
 */
export function rankMallDiscoveryCards(cards, opts) {
  const display = opts.display_name || ''
  return [...(cards || [])]
    .map((c) => {
      const seller = String(c.seller_type || '').toLowerCase()
      const official =
        c.signals?.is_official_shop ||
        c.raw?.is_official_shop ||
        c.raw?.show_official_shop_label ||
        seller === 'mall' ||
        seller === 'official_brand'
      let tier = 0
      if (seller === 'mall' || official) tier = 4
      else if (seller === 'preferred_plus') tier = 2
      else if (seller === 'preferred') tier = 1
      const nameScore = brandNameMatchScore(c, display)
      const username =
        sanitizeShopUsername(c.signals?.shop_username || c.raw?.shop_username || '') ||
        parseShopeeShopUsername(c.shop_url || c.raw?.shop_url || '') ||
        null
      return {
        card: c,
        tier,
        nameScore,
        username,
        shop_id: c.shop_id ? String(c.shop_id) : null,
        score: tier * 10 + nameScore * 5 + (username ? 3 : 0),
      }
    })
    .filter((r) => r.tier >= 1 || r.nameScore >= 0.5)
    .sort((a, b) => b.score - a.score)
}

/**
 * Build discovery result from ranked cards + optional resolved usernames by shop_id.
 * @param {Array<Record<string, any>>} cards
 * @param {{
 *   display_name: string
 *   brand_key?: string
 *   country?: string
 *   username_by_shop_id?: Record<string, string>
 *   auto_confirm?: boolean
 * }} opts
 */
export function pickMallShopDiscovery(cards, opts) {
  const country = opts.country || 'sg'
  const ranked = rankMallDiscoveryCards(cards, { display_name: opts.display_name })
  const byId = opts.username_by_shop_id || {}

  for (const row of ranked) {
    let username = row.username
    if (!username && row.shop_id && byId[row.shop_id]) {
      username = sanitizeShopUsername(byId[row.shop_id])
    }
    if (!username) continue

    const nameOk = row.nameScore >= 0.4 || row.tier >= 4
    if (!nameOk) continue

    const officialish = row.tier >= 4
    const autoConfirm = opts.auto_confirm !== false && officialish && row.nameScore >= 0.5

    return {
      ok: true,
      status: autoConfirm ? 'confirmed' : 'candidate',
      source: 'serp',
      shop_username: username,
      shop_url: shopeeShopUrl(username, country),
      shop_id: row.shop_id,
      evidence: {
        display_name: opts.display_name,
        brand_key: opts.brand_key || null,
        seller_type: row.card.seller_type,
        shop_name: row.card.shop_name,
        name_match: row.nameScore,
        tier: row.tier,
        rank_position: row.card.rank_position,
        listing_url: row.card.listing_url,
        auto_confirm: autoConfirm,
        resolved_at: new Date().toISOString(),
      },
    }
  }

  // Fall back to existing SERP helper (needs shop_url on cards)
  const fallback = resolveShopFromSerpCards(cards, {
    display_name: opts.display_name,
    country,
  })
  if (fallback.ok) {
    return {
      ...fallback,
      status:
        opts.auto_confirm !== false && fallback.status === 'candidate'
          ? fallback.status
          : fallback.status,
    }
  }

  return {
    ok: false,
    status: 'failed',
    error: 'no_resolvable_mall_shop',
    evidence: {
      display_name: opts.display_name,
      ranked: ranked.slice(0, 5).map((r) => ({
        shop_id: r.shop_id,
        shop_name: r.card.shop_name,
        seller_type: r.card.seller_type,
        nameScore: r.nameScore,
        has_username: Boolean(r.username),
      })),
      heuristic_candidates: heuristicShopUsernameCandidates(opts.display_name, { country }),
    },
  }
}

/**
 * Merge discovery into universe patch (same shape as set-brand-shop-username).
 */
export function universePatchFromDiscovery(resolved) {
  if (!resolved?.ok) {
    return {
      shop_resolve_status: 'failed',
      shop_resolve_source: 'serp',
      shop_resolve_evidence: resolved?.evidence || { error: resolved?.error },
    }
  }
  return {
    shop_username: resolved.shop_username,
    shop_url: resolved.shop_url,
    shop_id: resolved.shop_id || null,
    shop_resolve_status: resolved.status,
    shop_resolve_source: resolved.source || 'serp',
    shop_resolve_evidence: resolved.evidence || {},
  }
}

/**
 * Queries to try for discovery SERP (ordered).
 * @param {string} displayName
 */
export function discoverySearchQueries(displayName) {
  const name = String(displayName || '').trim()
  if (!name) return []
  return [
    name,
    `${name} official`,
    `${name} shopee mall`,
  ]
}

/**
 * Apply manual URL still preferred when provided.
 */
export { resolveShopFromManualUrl }
