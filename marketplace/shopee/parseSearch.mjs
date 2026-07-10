/**
 * Normalize Shopee search API items and DOM-ish card payloads
 * into ObservedListingCard rows.
 */

import { parseSoldLabel } from '../soldLabel.mjs'
import { deriveDropshipSignals, normalizeSellerType, sellerTypeFromBadges } from '../sellerTaxonomy.mjs'
import { parseShopeeItemIds, shopeeListingUrl } from './urls.mjs'

/**
 * Shopee often stores price as integer * 100_000 (e.g. 2490000 → 24.90).
 * @param {unknown} raw
 * @returns {number | undefined}
 */
export function normalizeShopeePrice(raw) {
  if (raw == null || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) return undefined
  if (n >= 1000) {
    // Heuristic: values that look like micro-units
    const asMoney = n / 100_000
    if (asMoney > 0 && asMoney < 1_000_000) return Math.round(asMoney * 100) / 100
  }
  return Math.round(n * 100) / 100
}

/**
 * Map one API item (item_basic or flat) to a card.
 * @param {Record<string, unknown>} item
 * @param {{ rank: number, query?: string, country?: string }} ctx
 */
export function mapApiItemToCard(item, ctx) {
  const basic =
    item && typeof item === 'object' && item.item_basic && typeof item.item_basic === 'object'
      ? /** @type {Record<string, unknown>} */ (item.item_basic)
      : item

  if (!basic || typeof basic !== 'object') return null

  const shopId = String(basic.shopid ?? basic.shop_id ?? item.shopid ?? '')
  const itemId = String(basic.itemid ?? basic.item_id ?? item.itemid ?? '')
  if (!shopId || !itemId) return null

  const title = String(basic.name ?? basic.title ?? '').trim()
  if (!title) return null

  const price =
    normalizeShopeePrice(basic.price) ??
    normalizeShopeePrice(basic.price_min) ??
    normalizeShopeePrice(item.price)

  const original =
    normalizeShopeePrice(basic.price_before_discount) ??
    normalizeShopeePrice(basic.price_max_before_discount)

  const soldRaw =
    basic.historical_sold ??
    basic.sold ??
    basic.global_sold_count ??
    basic.item_card_display_sold_count
  let sold_label
  let sold_count_lower_bound
  if (soldRaw != null && soldRaw !== '') {
    if (typeof soldRaw === 'number') {
      sold_count_lower_bound = Math.round(soldRaw)
      sold_label = soldRaw >= 1000 ? `${(soldRaw / 1000).toFixed(1)}k sold` : `${soldRaw} sold`
    } else {
      const parsed = parseSoldLabel(String(soldRaw))
      sold_label = parsed.label ?? String(soldRaw)
      sold_count_lower_bound = parsed.lower_bound ?? undefined
    }
  }

  const ratingObj = basic.item_rating && typeof basic.item_rating === 'object'
    ? /** @type {Record<string, unknown>} */ (basic.item_rating)
    : null
  const rating = ratingObj?.rating_star != null
    ? Number(ratingObj.rating_star)
    : basic.rating != null
      ? Number(basic.rating)
      : undefined
  const review_count = ratingObj?.rating_count
    ? Array.isArray(ratingObj.rating_count)
      ? Number(ratingObj.rating_count[0] ?? ratingObj.rating_count[ratingObj.rating_count.length - 1])
      : Number(ratingObj.rating_count)
    : basic.ctime
      ? undefined
      : undefined

  const badges = []
  if (basic.show_official_shop_label || basic.is_official_shop || basic.official_shop) {
    badges.push('official')
  }
  if (basic.shopee_verified || basic.is_preferred_plus_seller) {
    badges.push(basic.is_preferred_plus_seller ? 'preferred+' : 'preferred')
  }
  if (basic.is_mart || basic.show_shopee_verified_label === false && basic.shop_location) {
    /* ignore */
  }
  // Mall often via transparent_background_image / label_ids — use flags we have
  if (basic.is_mart || String(basic.shop_name || '').toLowerCase().includes('mall')) {
    badges.push('mall')
  }
  // Common field on SG cards
  if (basic.show_free_shipping) {
    /* not a seller tier */
  }

  let seller_type = sellerTypeFromBadges(badges, {
    is_official_shop: Boolean(basic.is_official_shop || basic.show_official_shop_label),
  })
  // Stronger mall detection: many mall items have is_official_shop + verified
  if (basic.can_use_wholesale == null && basic.show_official_shop_label && basic.shopee_verified) {
    // keep official_brand or preferred — Mall label often separate
  }
  if (basic.item_type === 0 && basic.reference_item_id) {
    /* bundle skip */
  }

  // Explicit mall-ish labels in raw
  const labelIds = basic.label_ids
  if (Array.isArray(labelIds) && labelIds.some((id) => String(id).includes('mall'))) {
    seller_type = 'mall'
  }
  // Shopee Mall shop flag
  if (basic.is_on_flash_sale != null && basic.shop_vouchers) {
    /* no-op */
  }
  if (basic.shop_data && typeof basic.shop_data === 'object') {
    const sd = /** @type {Record<string, unknown>} */ (basic.shop_data)
    if (sd.is_official_shop || sd.shop_text_status) {
      seller_type = normalizeSellerType(
        sd.is_official_shop ? 'official_brand' : seller_type,
      )
    }
  }

  // Heuristic: "Shopee Mall" in shop name or brand
  const shopName = String(basic.shop_name ?? basic.shopname ?? item.shop_name ?? '')
  if (/mall/i.test(shopName) || basic.show_official_shop_label) {
    if (basic.is_official_shop || basic.show_official_shop_label) {
      seller_type = seller_type === 'unknown' || seller_type === 'normal' ? 'mall' : seller_type
      if (basic.show_official_shop_label) seller_type = 'mall'
    }
  }

  const location = String(basic.shop_location ?? basic.shop_location_text ?? '')
  const signals = deriveDropshipSignals({
    location,
    preorder: Boolean(basic.is_pre_order),
    preorder_days: basic.estimated_days != null ? Number(basic.estimated_days) : undefined,
  })

  const country = ctx.country || 'sg'
  const image = basic.image ? String(basic.image) : undefined
  const image_url = image
    ? image.startsWith('http')
      ? image
      : `https://cf.shopee.sg/file/${image}`
    : undefined

  return {
    shop_id: shopId,
    item_id: itemId,
    title: title.slice(0, 500),
    listing_url: shopeeListingUrl(shopId, itemId, country, title.slice(0, 80)),
    shop_name: shopName || undefined,
    seller_type,
    price,
    original_price: original,
    currency: country === 'sg' ? 'SGD' : country === 'my' ? 'MYR' : country === 'ph' ? 'PHP' : 'SGD',
    rating: Number.isFinite(rating) ? Math.round(/** @type {number} */ (rating) * 100) / 100 : undefined,
    review_count: Number.isFinite(review_count) ? review_count : undefined,
    sold_label,
    sold_count_lower_bound,
    rank_position: ctx.rank,
    search_query: ctx.query,
    image_url,
    signals,
    raw: basic,
  }
}

/**
 * Extract items array from a Shopee search API JSON body.
 * @param {unknown} payload
 * @returns {Record<string, unknown>[]}
 */
export function extractItemsFromSearchPayload(payload) {
  if (!payload || typeof payload !== 'object') return []
  const p = /** @type {Record<string, unknown>} */ (payload)

  if (Array.isArray(p.items)) return p.items
  if (p.data && typeof p.data === 'object') {
    const d = /** @type {Record<string, unknown>} */ (p.data)
    if (Array.isArray(d.items)) return d.items
    if (Array.isArray(d.item)) return d.item
  }
  if (Array.isArray(p.item_basic_list)) return p.item_basic_list
  return []
}

/**
 * @param {unknown} payload
 * @param {{ query?: string, country?: string, rankOffset?: number }} [opts]
 */
export function cardsFromSearchPayload(payload, opts = {}) {
  const items = extractItemsFromSearchPayload(payload)
  const cards = []
  let rank = (opts.rankOffset ?? 0) + 1
  for (const item of items) {
    const card = mapApiItemToCard(/** @type {Record<string, unknown>} */ (item), {
      rank,
      query: opts.query,
      country: opts.country,
    })
    if (card) {
      cards.push(card)
      rank++
    }
  }
  return cards
}

/**
 * Map DOM-extracted lightweight cards (from page.evaluate).
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ query?: string, country?: string, rankOffset?: number }} [opts]
 */
export function cardsFromDomRows(rows, opts = {}) {
  if (!Array.isArray(rows)) return []
  const cards = []
  let rank = (opts.rankOffset ?? 0) + 1
  for (const row of rows) {
    const href = String(row.href || row.url || '')
    const ids = parseShopeeItemIds(href)
    if (!ids) continue
    const title = String(row.title || '').trim()
    if (!title) continue

    const priceText = String(row.priceText || row.price || '')
    const priceMatch = priceText.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/)
    const price = priceMatch ? parseFloat(priceMatch[1]) : undefined

    const sold = parseSoldLabel(String(row.soldText || row.sold || ''))
    const badges = Array.isArray(row.badges) ? row.badges.map(String) : []
    if (row.isMall) badges.push('mall')
    if (row.isPreferredPlus) badges.push('preferred+')
    else if (row.isPreferred) badges.push('preferred')
    if (row.isOfficial) badges.push('official')

    const seller_type = sellerTypeFromBadges(badges)
    const country = opts.country || 'sg'

    cards.push({
      shop_id: ids.shop_id,
      item_id: ids.item_id,
      title: title.slice(0, 500),
      listing_url: href.startsWith('http')
        ? href
        : `https://shopee.${country === 'sg' ? 'sg' : country}${href.startsWith('/') ? '' : '/'}${href}`,
      shop_name: row.shopName ? String(row.shopName) : undefined,
      seller_type,
      price,
      currency: country === 'sg' ? 'SGD' : 'SGD',
      rating: row.rating != null ? Number(row.rating) : undefined,
      sold_label: sold.label ?? undefined,
      sold_count_lower_bound: sold.lower_bound ?? undefined,
      rank_position: rank,
      search_query: opts.query,
      signals: deriveDropshipSignals({
        location: row.location ? String(row.location) : undefined,
      }),
      raw: row,
    })
    rank++
  }
  return cards
}

/**
 * Detect login / captcha walls from page title or body snippet.
 * @param {{ title?: string, bodyText?: string, url?: string }} page
 * @returns {'ok'|'login_required'|'blocked'|'unknown'}
 */
export function detectSessionHealth(page = {}) {
  const title = String(page.title || '').toLowerCase()
  const body = String(page.bodyText || '').slice(0, 2000).toLowerCase()
  const url = String(page.url || '').toLowerCase()

  if (url.includes('/buyer/login') || url.includes('/login') || title.includes('login')) {
    return 'login_required'
  }
  if (
    body.includes('verify you are human') ||
    body.includes('captcha') ||
    body.includes('unusual traffic') ||
    title.includes('captcha')
  ) {
    return 'blocked'
  }
  if (body.includes('no results found') || body.includes('try different keywords')) {
    return 'ok'
  }
  return 'ok'
}
