/**
 * Shopee URL helpers by country.
 */

const HOSTS = {
  sg: 'shopee.sg',
  ph: 'shopee.ph',
  my: 'shopee.com.my',
  id: 'shopee.co.id',
  th: 'shopee.co.th',
  vn: 'shopee.vn',
  tw: 'shopee.tw',
}

/**
 * @param {string} [country]
 * @returns {string}
 */
export function shopeeHost(country = 'sg') {
  const c = String(country || 'sg').toLowerCase()
  return HOSTS[c] || `shopee.${c}`
}

/**
 * @param {string} keyword
 * @param {string} [country]
 * @param {number} [page] zero-based page index
 */
export function shopeeSearchUrl(keyword, country = 'sg', page = 0) {
  const host = shopeeHost(country)
  const q = encodeURIComponent(String(keyword || '').trim())
  const p = Math.max(0, Number(page) || 0)
  const pageQs = p > 0 ? `&page=${p}` : ''
  return `https://${host}/search?keyword=${q}${pageQs}`
}

/**
 * @param {string} shopId
 * @param {string} itemId
 * @param {string} [country]
 * @param {string} [slug]
 */
export function shopeeListingUrl(shopId, itemId, country = 'sg', slug = '') {
  const host = shopeeHost(country)
  const safeSlug = slug
    ? encodeURIComponent(slug).replace(/%20/g, '-')
    : 'product'
  return `https://${host}/${safeSlug}-i.${shopId}.${itemId}`
}

/**
 * Parse shop_id + item_id from common Shopee URL shapes.
 * @param {string} href
 * @returns {{ shop_id: string, item_id: string } | null}
 */
export function parseShopeeItemIds(href) {
  if (!href) return null
  const s = String(href)

  let m = s.match(/-i\.(\d+)\.(\d+)/)
  if (m) return { shop_id: m[1], item_id: m[2] }

  m = s.match(/\/product\/(\d+)\/(\d+)/)
  if (m) return { shop_id: m[1], item_id: m[2] }

  m = s.match(/[?&]shopid=(\d+).*[?&]itemid=(\d+)/i)
  if (m) return { shop_id: m[1], item_id: m[2] }

  return null
}

/**
 * Numeric shop id URL (often redirects to /{username} storefront).
 * @param {string|number} shopId
 * @param {string} [country]
 */
export function shopeeShopByIdUrl(shopId, country = 'sg') {
  const host = shopeeHost(country)
  const id = String(shopId || '').trim()
  if (!id) throw new Error('shop id required')
  return `https://${host}/shop/${encodeURIComponent(id)}`
}

/**
 * Official Mall / shop storefront URL from username slug.
 * e.g. beautyofjoseonsg → https://shopee.sg/beautyofjoseonsg
 * @param {string} username
 * @param {string} [country]
 * @param {{ categoryId?: string|number, itemId?: string|number }} [opts]
 */
export function shopeeShopUrl(username, country = 'sg', opts = {}) {
  const host = shopeeHost(country)
  const slug = String(username || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/^@/, '')
  if (!slug) throw new Error('shop username required')
  const qs = new URLSearchParams()
  if (opts.categoryId != null) qs.set('categoryId', String(opts.categoryId))
  if (opts.itemId != null) qs.set('itemId', String(opts.itemId))
  const q = qs.toString()
  return `https://${host}/${encodeURIComponent(slug).replace(/%40/g, '@')}${q ? `?${q}` : ''}`
}

/**
 * Extract shop username from a Shopee shop/PDP URL.
 * Handles:
 *   https://shopee.sg/beautyofjoseonsg
 *   https://shopee.sg/beautyofjoseonsg?categoryId=…&itemId=…
 * Does NOT treat listing paths (...-i.shop.item) as usernames.
 * @param {string} href
 * @returns {string | null}
 */
export function parseShopeeShopUsername(href) {
  if (!href) return null
  let s = String(href).trim()
  if (!s) return null

  // Absolute or host-relative
  try {
    if (s.startsWith('//')) s = `https:${s}`
    if (s.startsWith('/')) {
      // path only
      const path = s.split('?')[0]
      const seg = path.replace(/^\//, '').split('/')[0]
      return sanitizeShopUsername(seg)
    }
    const u = new URL(s.includes('://') ? s : `https://${s}`)
    if (!/shopee\./i.test(u.hostname)) return null
    const seg = u.pathname.replace(/^\//, '').split('/')[0]
    // Listing product paths: "Something-i.123.456" or "product"
    if (!seg || seg === 'product' || seg === 'search' || seg === 'buyer') return null
    if (/-i\.\d+\.\d+/i.test(seg)) return null
    return sanitizeShopUsername(decodeURIComponent(seg))
  } catch {
    return sanitizeShopUsername(s.split('/').filter(Boolean).pop() || '')
  }
}

/**
 * @param {string} raw
 * @returns {string | null}
 */
export function sanitizeShopUsername(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/^@/, '')
    .split('?')[0]
    .split('#')[0]
  if (!s) return null
  // Shopee usernames are typically alnum + underscore / hyphen / dot
  if (!/^[a-zA-Z0-9._-]+$/.test(s)) return null
  if (s.length < 2 || s.length > 64) return null
  return s.toLowerCase()
}
