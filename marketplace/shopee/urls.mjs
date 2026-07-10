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
