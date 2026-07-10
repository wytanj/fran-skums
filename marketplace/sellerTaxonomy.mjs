/**
 * Normalize marketplace seller badges into Fran seller_type + signals.
 */

/** @typedef {'mall'|'preferred_plus'|'preferred'|'official_brand'|'normal'|'unknown'} SellerType */

const SELLER_TYPES = new Set([
  'mall',
  'preferred_plus',
  'preferred',
  'official_brand',
  'normal',
  'unknown',
])

/**
 * @param {unknown} value
 * @returns {SellerType}
 */
export function normalizeSellerType(value) {
  if (value == null) return 'unknown'
  const raw = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_')

  if (SELLER_TYPES.has(raw)) return /** @type {SellerType} */ (raw)

  if (
    raw.includes('preferred_plus') ||
    raw.includes('preferred+') ||
    raw === 'preferredplus' ||
    raw.includes('preferred_plus_seller')
  ) {
    return 'preferred_plus'
  }
  if (raw.includes('preferred') || raw.includes('star_seller') || raw.includes('starseller')) {
    return 'preferred'
  }
  if (
    raw.includes('mall') ||
    raw.includes('shopee_mall') ||
    raw.includes('official_mall') ||
    raw === 'sm'
  ) {
    return 'mall'
  }
  if (raw.includes('official') || raw.includes('brand_store') || raw.includes('flagship')) {
    return 'official_brand'
  }
  if (raw.includes('normal') || raw.includes('regular') || raw === 'seller') {
    return 'normal'
  }

  return 'unknown'
}

/**
 * Infer seller type from free-text badge labels (DOM / API badge arrays).
 * @param {string[] | null | undefined} badges
 * @param {{ is_official_shop?: boolean }} [opts]
 * @returns {SellerType}
 */
export function sellerTypeFromBadges(badges, opts = {}) {
  if (opts.is_official_shop) return 'official_brand'
  if (!badges || badges.length === 0) return 'unknown'

  const joined = badges.map((b) => String(b).toLowerCase())

  if (joined.some((b) => b.includes('mall') || b.includes('shopee mall'))) return 'mall'
  if (joined.some((b) => b.includes('preferred+') || b.includes('preferred plus'))) {
    return 'preferred_plus'
  }
  if (joined.some((b) => b.includes('preferred'))) return 'preferred'
  if (joined.some((b) => b.includes('official') || b.includes('flagship'))) {
    return 'official_brand'
  }

  return 'normal'
}

/**
 * Dropship-adjacent signals — never a single hard boolean from Shopee alone.
 * @param {Record<string, unknown>} [input]
 * @returns {Record<string, boolean | number | string>}
 */
export function deriveDropshipSignals(input = {}) {
  /** @type {Record<string, boolean | number | string>} */
  const signals = {}

  if (input.ships_from_overseas === true || input.ships_from === 'overseas') {
    signals.ships_from_overseas = true
  }
  if (input.preorder === true || (typeof input.preorder_days === 'number' && input.preorder_days > 0)) {
    signals.preorder = true
    if (typeof input.preorder_days === 'number') signals.preorder_days = input.preorder_days
  }
  if (typeof input.undercut_vs_official_pct === 'number') {
    signals.undercut_vs_official_pct = input.undercut_vs_official_pct
  }
  if (input.title_clone_of_official === true) {
    signals.title_clone_of_official = true
  }
  if (input.location && typeof input.location === 'string') {
    const loc = input.location.toLowerCase()
    if (
      loc.includes('china') ||
      loc.includes('overseas') ||
      loc.includes('korea') ||
      loc.includes('hong kong') ||
      loc.includes('taiwan')
    ) {
      signals.ships_from_overseas = true
      signals.ship_from_location = input.location
    }
  }

  return signals
}

/**
 * @param {SellerType} type
 * @returns {boolean}
 */
export function isTrustedSellerTier(type) {
  return type === 'mall' || type === 'preferred_plus' || type === 'preferred' || type === 'official_brand'
}
