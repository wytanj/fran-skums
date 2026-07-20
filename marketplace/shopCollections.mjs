/**
 * MH-1 — Discover Shopee Mall shop collections (seller shelves).
 *
 * From official storefront navbar, e.g. beautyofjoseonsg:
 *   All Products  → /{user}#product_list  (no shopCollection id)
 *   Sunscreens    → /{user}?shopCollection=248405946#product_list
 *   Serums        → /{user}?shopCollection=248405931#product_list
 *
 * These are NOT Shopee platform breadcrumbs (Beauty & Personal Care → Skincare → Eye Care).
 */

import { parseShopeeShopUsername } from './shopee/urls.mjs'

/**
 * @typedef {{
 *   name: string
 *   shop_collection_id: string | null
 *   url: string
 *   is_all_products: boolean
 * }} ShopCollection
 */

/**
 * Parse shopCollection id from a shop URL.
 * @param {string} href
 * @returns {string | null}
 */
export function parseShopCollectionId(href) {
  if (!href) return null
  try {
    const u = new URL(href, 'https://shopee.sg')
    const id = u.searchParams.get('shopCollection')
    return id && /^\d+$/.test(id) ? id : null
  } catch {
    const m = String(href).match(/[?&]shopCollection=(\d+)/i)
    return m ? m[1] : null
  }
}

/**
 * Build collection list URL for harvest.
 * @param {string} shopUsername
 * @param {{ shop_collection_id?: string | null, page?: number, sort_by?: string, country?: string }} [opts]
 */
export function shopCollectionListUrl(shopUsername, opts = {}) {
  const user = String(shopUsername || '').trim().replace(/^\/+/, '')
  const host = opts.country === 'sg' || !opts.country ? 'shopee.sg' : `shopee.${opts.country}`
  const params = new URLSearchParams()
  if (opts.shop_collection_id) params.set('shopCollection', String(opts.shop_collection_id))
  if (opts.page != null && Number(opts.page) > 0) params.set('page', String(opts.page))
  params.set('sortBy', opts.sort_by || 'pop')
  const q = params.toString()
  return `https://${host}/${user}${q ? `?${q}` : ''}#product_list`
}

/**
 * Extract collections from a live Document (content script).
 * @param {Document} doc
 * @param {{ page_url?: string }} [opts]
 * @returns {{ shop_username: string | null, collections: ShopCollection[], discovered_at: string }}
 */
export function extractShopCollectionsFromDocument(doc, opts = {}) {
  const page_url = opts.page_url || (typeof location !== 'undefined' ? location.href : '')
  const shop_username =
    parseShopeeShopUsername(page_url) ||
    parseShopeeShopUsername(doc.querySelector('link[rel="canonical"]')?.href || '')

  /** @type {Map<string, ShopCollection>} */
  const byKey = new Map()

  const anchors = Array.from(doc.querySelectorAll('a[href]'))
  for (const a of anchors) {
    const href = a.href || a.getAttribute('href') || ''
    if (!/shopee\./i.test(href) && !href.startsWith('/')) continue

    let abs
    try {
      abs = new URL(href, 'https://shopee.sg').href
    } catch {
      continue
    }

    const user = parseShopeeShopUsername(abs)
    if (shop_username && user && user !== shop_username) continue
    if (!user && !abs.includes('shopCollection=') && !abs.includes('#product_list')) continue

    const name = (a.textContent || '').replace(/\s+/g, ' ').trim()
    if (!name || name.length > 80) continue

    // Navbar items only — skip product cards / help links
    const collId = parseShopCollectionId(abs)
    const isAll =
      /all\s*products/i.test(name) ||
      (!collId && /#product_list/i.test(abs) && user)

    if (!collId && !isAll) continue
    // Prefer links that look like shop nav (navbar / menu)
    const inNav =
      a.closest('[class*="navbar"]') ||
      a.closest('[class*="menu"]') ||
      a.closest('nav') ||
      /navbar|menu|collection/i.test(a.className || '')

    // Accept all-products / shopCollection even outside nav if name is short shelf-like
    if (!inNav && !isAll && !collId) continue

    const key = collId || '__all__'
    const row = {
      name,
      shop_collection_id: collId,
      url: abs.split('#')[0] + (abs.includes('#product_list') || isAll ? '#product_list' : ''),
      is_all_products: Boolean(isAll),
    }
    if (!byKey.has(key) || (isAll && !byKey.get(key).is_all_products)) {
      byKey.set(key, row)
    }
  }

  // Ensure All Products exists
  if (shop_username && ![...byKey.values()].some((c) => c.is_all_products)) {
    byKey.set('__all__', {
      name: 'All Products',
      shop_collection_id: null,
      url: `https://shopee.sg/${shop_username}#product_list`,
      is_all_products: true,
    })
  }

  const collections = orderCollections([...byKey.values()])
  return {
    shop_username: shop_username || null,
    collections,
    discovered_at: new Date().toISOString(),
  }
}

/**
 * Offline extract from saved HTML (sample-beauty-of-joseon).
 * @param {string} html
 * @param {{ page_url?: string }} [opts]
 */
export function extractShopCollectionsFromHtml(html, opts = {}) {
  const page_url = opts.page_url || 'https://shopee.sg/beautyofjoseonsg'
  const shop_username = parseShopeeShopUsername(page_url) || 'beautyofjoseonsg'

  /** @type {Map<string, ShopCollection>} */
  const byKey = new Map()

  // Navbar pattern (saved BOJ HTML):
  //   <a href="...?shopCollection=ID#product_list"><span>Sunscreens</span></a>
  //   <a href="...#product_list"><span>All Products</span></a>
  const re =
    /href="((?:https:\/\/shopee\.sg)?\/[^"]*(?:shopCollection=\d+|#product_list)[^"]*)"[^>]*>\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/gi

  let m
  while ((m = re.exec(html)) !== null) {
    let href = m[1].replace(/&amp;/g, '&')
    const name = m[2].replace(/\s+/g, ' ').trim()
    if (!name || name.length < 2 || name.length > 80) continue
    if (/blog|help|mall|seller|flash|ambassador|policy|coin/i.test(name)) continue

    try {
      href = new URL(href, 'https://shopee.sg').href
    } catch {
      continue
    }

    const user = parseShopeeShopUsername(href)
    if (user && user !== shop_username) continue
    if (!user && !href.includes(shop_username)) continue

    const collId = parseShopCollectionId(href)
    const isAll = /all\s*products/i.test(name) || (!collId && /#product_list/i.test(href))

    if (!collId && !isAll) continue

    const key = collId || '__all__'
    if (byKey.has(key)) continue
    byKey.set(key, {
      name,
      shop_collection_id: collId,
      url: href.includes('#') ? href : `${href}#product_list`,
      is_all_products: Boolean(isAll),
    })
  }

  if (![...byKey.values()].some((c) => c.is_all_products)) {
    byKey.set('__all__', {
      name: 'All Products',
      shop_collection_id: null,
      url: `https://shopee.sg/${shop_username}#product_list`,
      is_all_products: true,
    })
  }

  return {
    shop_username,
    collections: orderCollections([...byKey.values()]),
    discovered_at: new Date().toISOString(),
  }
}

/**
 * @param {ShopCollection[]} list
 */
function orderCollections(list) {
  return [...list].sort((a, b) => {
    if (a.is_all_products && !b.is_all_products) return -1
    if (!a.is_all_products && b.is_all_products) return 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Merge discovered collections into universe.metadata (preserve other keys).
 * @param {Record<string, unknown>} existingMeta
 * @param {{ shop_username?: string | null, collections: ShopCollection[], discovered_at?: string }} discovery
 */
export function mergeShopCollectionsMetadata(existingMeta, discovery) {
  const meta = { ...(existingMeta && typeof existingMeta === 'object' ? existingMeta : {}) }
  meta.shop_collections = discovery.collections || []
  meta.shop_collections_discovered_at = discovery.discovered_at || new Date().toISOString()
  if (discovery.shop_username) meta.shop_username = discovery.shop_username
  return meta
}
