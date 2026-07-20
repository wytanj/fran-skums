/**
 * Extract product cards from a Shopee official Mall shop product list page.
 *
 * Primary source (validated against saved BOJ HTML):
 *   https://shopee.sg/{username}?page=0&sortBy=pop&tab=0
 *
 * Fields we care about:
 *   - name
 *   - sold_label / sold_count_lower_bound
 *   - category (active shop collection tab when available)
 *
 * Plus stable ids: shop_id, item_id, listing_url
 */

import { parseSoldLabel } from './soldLabel.mjs'
import { parseShopeeItemIds, parseShopeeShopUsername } from './shopee/urls.mjs'

/**
 * Parse shop page query context.
 * @param {string} pageUrl
 */
export function parseShopPageContext(pageUrl) {
  let url
  try {
    url = new URL(pageUrl)
  } catch {
    return { shop_username: null, page: 0, sort_by: null, tab: null }
  }
  const shop_username = parseShopeeShopUsername(url.href)
  const page = Number(url.searchParams.get('page') || 0) || 0
  const sort_by = url.searchParams.get('sortBy') || null
  const tab = url.searchParams.get('tab')
  return { shop_username, page, sort_by, tab }
}

/**
 * Product name from listing slug path.
 * @param {string} href
 */
export function productNameFromHref(href) {
  if (!href) return null
  try {
    const path = new URL(href, 'https://shopee.sg').pathname
    const slug = path.split('/').filter(Boolean).pop() || ''
    const base = slug.replace(/-i\.\d+\.\d+$/i, '')
    if (!base) return null
    return decodeURIComponent(base.replace(/-/g, ' ')).replace(/\s+/g, ' ').trim()
  } catch {
    return null
  }
}

/**
 * Extract products from a browser Document (content script).
 * @param {Document} doc
 * @param {{ page_url?: string }} [opts]
 */
export function extractShopProductsFromDocument(doc, opts = {}) {
  const page_url = opts.page_url || (typeof location !== 'undefined' ? location.href : '')
  const ctx = parseShopPageContext(page_url)
  const active_category = detectActiveShopCategory(doc) || 'All Products'

  /** @type {Map<string, any>} */
  const byItem = new Map()

  const anchors = Array.from(doc.querySelectorAll('a[href*="-i."]'))
  for (const a of anchors) {
    const href = a.href || a.getAttribute('href') || ''
    const ids = parseShopeeItemIds(href)
    if (!ids) continue

    const card =
      a.closest('.shop-collection-view__item') ||
      a.closest('[class*="shop-collection"]') ||
      a.closest('[data-sqe="item"]') ||
      a.closest('li') ||
      a.parentElement

    const text = (card?.innerText || a.innerText || '').replace(/\s+/g, ' ').trim()
    const soldMatch = text.match(/([0-9.,]+\s*[kKmM]?\+?\s*sold)/i)
    const sold_label = soldMatch ? soldMatch[1].replace(/\s+/g, ' ').trim() : null
    const soldParsed = sold_label ? parseSoldLabel(sold_label) : { lower_bound: null }

    let name =
      a.getAttribute('title') ||
      card?.querySelector('[data-sqe="name"]')?.textContent?.trim() ||
      productNameFromHref(href)

    // Clean name
    if (name) name = name.replace(/\s+/g, ' ').trim()

    const key = `${ids.shop_id}:${ids.item_id}`
    const row = {
      name: name || null,
      sold_label,
      sold_count_lower_bound: soldParsed.lower_bound ?? null,
      category: active_category,
      shop_id: ids.shop_id,
      item_id: ids.item_id,
      listing_url: href.startsWith('http') ? href.split('#')[0] : `https://shopee.sg${href}`,
      rank_position: byItem.size + 1,
    }

    // Prefer entry with sold label if duplicate
    const prev = byItem.get(key)
    if (!prev || (!prev.sold_label && row.sold_label)) byItem.set(key, row)
  }

  const products = [...byItem.values()]
  return {
    shop_username: ctx.shop_username,
    shop_id: products[0]?.shop_id || null,
    page_url,
    page: ctx.page,
    sort_by: ctx.sort_by || 'pop',
    active_category,
    product_count: products.length,
    products,
    harvested_at: new Date().toISOString(),
  }
}

/**
 * Offline extract from saved HTML string (for tests / samples).
 * Uses regex because jsdom is not a dependency.
 * @param {string} html
 * @param {{ page_url?: string }} [opts]
 */
export function extractShopProductsFromHtml(html, opts = {}) {
  const page_url =
    opts.page_url ||
    'https://shopee.sg/beautyofjoseonsg?page=0&sortBy=pop&tab=0'
  const ctx = parseShopPageContext(page_url)

  /** @type {Map<string, any>} */
  const byItem = new Map()

  // Prefer collection item blocks when present
  const blocks = html.split(/shop-collection-view__item/)
  const chunks = blocks.length > 1 ? blocks.slice(1) : [html]

  for (const chunk of chunks) {
    const link = chunk.match(/href="([^"]*-i\.(\d+)\.(\d+)[^"]*)"/)
    if (!link) continue
    const href = link[1]
    const shop_id = link[2]
    const item_id = link[3]
    const soldMatch = chunk.match(/([0-9.,]+\s*[kKmM]?\+?\s*sold)/i)
    const sold_label = soldMatch ? soldMatch[1].replace(/\s+/g, ' ').trim() : null
    const soldParsed = sold_label ? parseSoldLabel(sold_label) : { lower_bound: null }
    const name = productNameFromHref(href)
    const key = `${shop_id}:${item_id}`
    const row = {
      name,
      sold_label,
      sold_count_lower_bound: soldParsed.lower_bound ?? null,
      category: 'All Products',
      shop_id,
      item_id,
      listing_url: href.startsWith('http') ? href.split('#')[0] : `https://shopee.sg${href}`,
      rank_position: byItem.size + 1,
    }
    const prev = byItem.get(key)
    if (!prev || (!prev.sold_label && row.sold_label)) byItem.set(key, row)
  }

  // Fallback: all product links globally if block split failed
  if (byItem.size === 0) {
    const links = [...html.matchAll(/href="([^"]*-i\.(\d+)\.(\d+)[^"]*)"/g)]
    for (const m of links) {
      const href = m[1]
      const key = `${m[2]}:${m[3]}`
      if (byItem.has(key)) continue
      byItem.set(key, {
        name: productNameFromHref(href),
        sold_label: null,
        sold_count_lower_bound: null,
        category: 'All Products',
        shop_id: m[2],
        item_id: m[3],
        listing_url: href.split('#')[0],
        rank_position: byItem.size + 1,
      })
    }
  }

  const products = [...byItem.values()]
  return {
    shop_username: ctx.shop_username || 'beautyofjoseonsg',
    shop_id: products[0]?.shop_id || null,
    page_url,
    page: ctx.page,
    sort_by: ctx.sort_by || 'pop',
    active_category: 'All Products',
    product_count: products.length,
    products,
    harvested_at: new Date().toISOString(),
  }
}

/**
 * Active collection tab label if present.
 * @param {Document} doc
 */
function detectActiveShopCategory(doc) {
  const active =
    doc.querySelector('[class*="collection"][class*="active"]') ||
    doc.querySelector('[class*="category"][class*="active"]') ||
    doc.querySelector('[aria-selected="true"]') ||
    doc.querySelector('.shopee-category-list__item--active')
  const t = active?.textContent?.replace(/\s+/g, ' ').trim()
  if (t && t.length < 60) return t

  // URL tab sometimes maps to collection chips — leave default
  return null
}

/**
 * Map harvest products → ObservedListingCard shape for warehouse upsert.
 * @param {object} harvest  extractShopProducts* result
 * @param {{ brand_key?: string, currency?: string }} [opts]
 */
export function harvestToObservationCards(harvest, opts = {}) {
  const brand_key = opts.brand_key || null
  const currency = opts.currency || 'SGD'
  const products = harvest?.products || []
  const collName =
    harvest.shop_collection_name || harvest.active_category || null
  const collId = harvest.shop_collection_id ?? null
  const source = harvest.harvest_source || 'mall_list_harvest'

  return products.map((p, i) => ({
    shop_id: String(p.shop_id),
    item_id: String(p.item_id),
    title: p.name,
    listing_url: p.listing_url,
    shop_name: harvest.shop_username || null,
    seller_type: 'mall',
    currency,
    sold_label: p.sold_label,
    sold_count_lower_bound: p.sold_count_lower_bound ?? undefined,
    rank_position: p.rank_position || i + 1,
    search_query: harvest.shop_username
      ? collId
        ? `shop:${harvest.shop_username}:coll:${collId}`
        : `shop:${harvest.shop_username}`
      : undefined,
    signals: {
      official_shop: true,
      shop_username: harvest.shop_username || null,
      category: p.category || collName || null,
      shop_collection_name: collName,
      shop_collection_id: collId,
      harvest_source: source,
      sort_by: harvest.sort_by || null,
      page: harvest.page ?? null,
      ...(brand_key ? { brand_key } : {}),
    },
    raw: {
      harvest: true,
      category: p.category || collName,
      shop_collection_id: collId,
      shop_collection_name: collName,
      page_url: harvest.page_url,
    },
  }))
}
