/**
 * Discover / resolve Shopee Mall shop_username *before* weekly shop scrape.
 *
 * Order of preference (do not invent official shops from LLM knowledge):
 *  1. manual — ops pastes storefront URL (confirmed)
 *  2. serp   — one-shot keyword SERP, pick Mall/official card, extract shop from listing/shop link
 *  3. heuristic — slug candidates from display_name (candidate only, never auto-confirmed)
 *
 * Confirmed shop_username is required before mode=shop is the primary seed.
 */

import { brandKeyFromDisplayName } from './brandKey.mjs'
import {
  parseShopeeItemIds,
  parseShopeeShopUsername,
  sanitizeShopUsername,
  shopeeShopUrl,
} from './shopee/urls.mjs'

/**
 * Apply a known Mall URL (manual or import). Status → confirmed.
 * @param {string} urlOrUsername
 * @param {{ country?: string, brand_key?: string }} [opts]
 */
export function resolveShopFromManualUrl(urlOrUsername, opts = {}) {
  const country = opts.country || 'sg'
  const raw = String(urlOrUsername || '').trim()
  if (!raw) {
    return { ok: false, status: 'failed', error: 'empty_input' }
  }

  let username = null
  if (raw.includes('shopee.') || raw.includes('/') || raw.includes('?')) {
    username = parseShopeeShopUsername(raw)
  } else {
    username = sanitizeShopUsername(raw)
  }

  if (!username) {
    return { ok: false, status: 'failed', error: 'unparseable_shop_url', input: raw }
  }

  return {
    ok: true,
    status: 'confirmed',
    source: 'manual',
    shop_username: username,
    shop_url: shopeeShopUrl(username, country),
    shop_id: null,
    evidence: {
      input: raw,
      brand_key: opts.brand_key || null,
      resolved_at: new Date().toISOString(),
    },
  }
}

/**
 * Heuristic slug candidates — never auto-confirm.
 * e.g. "Beauty of Joseon" → beautyofjoseon, beautyofjoseonsg, beauty-of-joseon-sg
 * @param {string} displayName
 * @param {{ country?: string }} [opts]
 * @returns {string[]}
 */
export function heuristicShopUsernameCandidates(displayName, opts = {}) {
  const country = String(opts.country || 'sg').toLowerCase()
  const base = brandKeyFromDisplayName(displayName).replace(/-/g, '')
  const hyphen = brandKeyFromDisplayName(displayName)
  if (!base) return []

  const out = new Set()
  out.add(base)
  out.add(`${base}${country}`)
  out.add(`${base}official`)
  out.add(`${base}official${country}`)
  out.add(hyphen.replace(/-/g, ''))
  if (hyphen.includes('-')) {
    out.add(`${hyphen.replace(/-/g, '')}${country}`)
  }
  // Keep hyphenated form only if valid username charset (hyphens ok)
  if (/^[a-z0-9._-]+$/.test(hyphen)) out.add(hyphen)

  return [...out].filter((u) => u.length >= 3 && u.length <= 64)
}

/**
 * Pick best Mall/official shop candidate from SERP observation cards.
 * Prefers seller_type mall / official_brand, then preferred.
 *
 * Cards may include:
 *   listing_url, shop_name, seller_type, signals, raw.shop_username, raw.href
 *
 * @param {Array<Record<string, any>>} cards
 * @param {{ display_name?: string, country?: string }} [opts]
 */
export function resolveShopFromSerpCards(cards, opts = {}) {
  const list = Array.isArray(cards) ? cards : []
  const country = opts.country || 'sg'
  const display = String(opts.display_name || '').toLowerCase()

  const ranked = [...list].sort((a, b) => rankSeller(b) - rankSeller(a))

  for (const card of ranked) {
    if (rankSeller(card) < 2) continue // need mall or official-ish

    const username =
      extractUsernameFromCard(card) ||
      (card.listing_url && shopUsernameFromListingContext(card))

    if (!username) continue

    // Soft name check: shop_name or title should mention brand tokens when display known
    if (display) {
      const tokens = display.split(/\s+/).filter((t) => t.length > 2)
      const blob = `${card.shop_name || ''} ${card.title || ''}`.toLowerCase()
      const hit = tokens.some((t) => blob.includes(t))
      if (!hit && tokens.length) continue
    }

    return {
      ok: true,
      status: 'candidate', // SERP pick needs optional human confirm; can promote to confirmed in ops
      source: 'serp',
      shop_username: username,
      shop_url: shopeeShopUrl(username, country),
      shop_id: card.shop_id ? String(card.shop_id) : null,
      evidence: {
        seller_type: card.seller_type || null,
        shop_name: card.shop_name || null,
        listing_url: card.listing_url || null,
        rank_position: card.rank_position ?? null,
        display_name: opts.display_name || null,
        resolved_at: new Date().toISOString(),
      },
    }
  }

  return {
    ok: false,
    status: 'failed',
    error: 'no_mall_official_card',
    evidence: { card_count: list.length },
  }
}

/**
 * Build universe patch fields from a resolve result.
 * @param {object} resolved  return of resolveShopFrom*
 */
export function universeShopPatchFromResolve(resolved) {
  if (!resolved?.ok) {
    return {
      shop_resolve_status: resolved?.status || 'failed',
      shop_resolve_source: resolved?.source || null,
      shop_resolve_evidence: resolved?.evidence || { error: resolved?.error },
    }
  }
  return {
    shop_username: resolved.shop_username,
    shop_url: resolved.shop_url,
    shop_id: resolved.shop_id || null,
    shop_resolve_status: resolved.status,
    shop_resolve_source: resolved.source,
    shop_resolve_evidence: resolved.evidence || {},
  }
}

/**
 * Should primary crawl be mode=shop?
 * Only when username known AND status confirmed (or candidate if allow_candidate).
 * @param {object} universe
 * @param {{ allow_candidate?: boolean }} [opts]
 */
export function shouldUseShopPrimary(universe, opts = {}) {
  const u = universe || {}
  const username = u.shop_username && String(u.shop_username).trim()
  if (!username) return false
  const status = u.shop_resolve_status || 'unknown'
  if (status === 'confirmed') return true
  if (opts.allow_candidate && status === 'candidate') return true
  return false
}

function rankSeller(card) {
  const t = String(card?.seller_type || '').toLowerCase()
  if (t === 'mall' || t === 'official_brand') return 4
  if (t === 'preferred_plus') return 3
  if (t === 'preferred') return 2
  return 0
}

function extractUsernameFromCard(card) {
  if (card.raw?.shop_username) return sanitizeShopUsername(card.raw.shop_username)
  if (card.signals?.shop_username) return sanitizeShopUsername(card.signals.shop_username)
  for (const key of ['shop_url', 'listing_url', 'href']) {
    const href = card[key] || card.raw?.[key]
    const u = parseShopeeShopUsername(href)
    if (u) return u
  }
  return null
}

/**
 * Listing URLs are ...-i.shopId.itemId — they do not embed username.
 * Prefer explicit shop_url on card; otherwise null (caller may use shop_id only).
 */
function shopUsernameFromListingContext(card) {
  if (card.shop_url) return parseShopeeShopUsername(card.shop_url)
  // Some DOM rows put shop profile in raw
  if (card.raw?.shop_url) return parseShopeeShopUsername(card.raw.shop_url)
  // Cannot derive username from numeric shop_id alone
  if (parseShopeeItemIds(card.listing_url || '')) return null
  return null
}

/**
 * Discovery strategy summary for docs / runbook.
 */
export const SHOP_RESOLVE_STRATEGY = Object.freeze({
  before_scrape: [
    '1. Manual: paste official Mall URL → status=confirmed (preferred for pilot)',
    '2. SERP resolve job: keyword SERP top cards → Mall/official → shop profile link or known mapping → candidate/confirmed',
    '3. Heuristic slug candidates only for human shortlist (never primary seed alone)',
  ],
  do_not: [
    'Do not invent shop_username from LLM knowledge as confirmed',
    'Do not treat keyword SERP as official portfolio when shop URL is known',
    'Do not auto-confirm heuristic slugs without a successful shop page load',
  ],
})
