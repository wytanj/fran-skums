/**
 * Content script — Mall shop product harvest + light shop identity.
 *
 * Designed around official storefront product lists, e.g.:
 *   https://shopee.sg/beautyofjoseonsg?page=0&sortBy=pop&tab=0
 *
 * Captures: product name, amount sold, category (active tab), ids/url.
 */
(function () {
  'use strict'

  function parseShopUsername(href) {
    if (!href) return null
    try {
      const u = new URL(href, location.origin)
      if (!/shopee\./i.test(u.hostname)) return null
      const seg = u.pathname.replace(/^\//, '').split('/')[0]
      if (!seg || seg === 'search' || seg === 'product' || seg === 'buyer' || seg === 'shop')
        return null
      if (/-i\.\d+\.\d+/i.test(seg)) return null
      if (!/^[a-zA-Z0-9._-]{2,64}$/.test(seg)) return null
      return seg.toLowerCase()
    } catch {
      return null
    }
  }

  function parseItemIds(href) {
    if (!href) return null
    const m = String(href).match(/-i\.(\d+)\.(\d+)/) || String(href).match(/\/product\/(\d+)\/(\d+)/)
    return m ? { shop_id: m[1], item_id: m[2] } : null
  }

  function productNameFromHref(href) {
    try {
      const path = new URL(href, location.origin).pathname
      const slug = path.split('/').filter(Boolean).pop() || ''
      const base = slug.replace(/-i\.\d+\.\d+$/i, '')
      if (!base) return null
      return decodeURIComponent(base.replace(/-/g, ' ')).replace(/\s+/g, ' ').trim()
    } catch {
      return null
    }
  }

  function parseSoldLower(soldLabel) {
    if (!soldLabel) return null
    const s = String(soldLabel).toLowerCase().replace(/,/g, '').trim()
    const m = s.match(/([\d.]+)\s*([km])?\+?\s*sold/)
    if (!m) return null
    let n = parseFloat(m[1])
    if (!Number.isFinite(n)) return null
    if (m[2] === 'k') n *= 1000
    if (m[2] === 'm') n *= 1e6
    return Math.floor(n)
  }

  function activeCategory() {
    const active =
      document.querySelector('[class*="collection"][class*="active"]') ||
      document.querySelector('[class*="category"][class*="active"]') ||
      document.querySelector('[aria-selected="true"]')
    const t = active?.textContent?.replace(/\s+/g, ' ').trim()
    if (t && t.length > 0 && t.length < 60) return t
    // Fallback: often "All Products" chip visible
    const all = Array.from(document.querySelectorAll('div,button,a')).find(
      (el) => /all products/i.test(el.textContent || '') && (el.textContent || '').trim().length < 40,
    )
    return all ? 'All Products' : 'All Products'
  }

  function pageKind() {
    const path = location.pathname
    if (path.startsWith('/search')) return 'serp'
    if (/-i\.\d+\.\d+/.test(path) || path.startsWith('/product/')) return 'listing'
    if (parseShopUsername(location.href)) return 'shop'
    return 'other'
  }

  /**
   * Primary harvest: name + sold + category from Mall product grid.
   */
  function harvestShopProducts() {
    const shop_username = parseShopUsername(location.href)
    const category = activeCategory()
    const params = new URLSearchParams(location.search)
    const byItem = new Map()

    const anchors = Array.from(document.querySelectorAll('a[href*="-i."]'))
    for (const a of anchors) {
      const href = a.href || a.getAttribute('href') || ''
      const ids = parseItemIds(href)
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

      let name =
        (a.getAttribute('title') || '').trim() ||
        card?.querySelector('[data-sqe="name"]')?.textContent?.trim() ||
        productNameFromHref(href)
      if (name) name = name.replace(/\s+/g, ' ').trim()

      const key = ids.shop_id + ':' + ids.item_id
      const row = {
        name,
        sold_label,
        sold_count_lower_bound: parseSoldLower(sold_label),
        category,
        shop_id: ids.shop_id,
        item_id: ids.item_id,
        listing_url: href.split('#')[0],
        rank_position: byItem.size + 1,
      }
      const prev = byItem.get(key)
      if (!prev || (!prev.sold_label && row.sold_label)) byItem.set(key, row)
    }

    const products = Array.from(byItem.values())
    return {
      page_kind: pageKind(),
      shop_username,
      shop_id: products[0]?.shop_id || null,
      page_url: location.href,
      page: Number(params.get('page') || 0) || 0,
      sort_by: params.get('sortBy') || 'pop',
      active_category: category,
      product_count: products.length,
      products,
      harvested_at: new Date().toISOString(),
    }
  }

  /** Legacy: shop identity candidates (still useful). */
  function scanShopIdentity() {
    const harvest = harvestShopProducts()
    const candidates = []
    if (harvest.shop_username) {
      candidates.push({
        shop_username: harvest.shop_username,
        shop_url: location.origin + '/' + harvest.shop_username,
        shop_id: harvest.shop_id,
        shop_name: document.title.replace(/\s*\|.*$/, '').trim(),
        seller_hint: 'page_is_shop',
        source: 'page_url',
        confidence: 0.95,
      })
    }
    return {
      page_kind: harvest.page_kind,
      page_url: harvest.page_url,
      page_title: document.title,
      search_query: new URLSearchParams(location.search).get('keyword'),
      candidates,
      harvest,
      scanned_at: new Date().toISOString(),
    }
  }

  /**
   * MH-1 — Mall navbar shop collections (seller shelves).
   * e.g. Serums → ?shopCollection=248405931  (not Shopee platform Eye Care path)
   */
  function discoverShopCollections() {
    const shop_username = parseShopUsername(location.href)
    const byKey = new Map()

    function add(row) {
      const key = row.shop_collection_id || (row.is_all_products ? '__all__' : row.name)
      if (!byKey.has(key)) byKey.set(key, row)
    }

    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.href || a.getAttribute('href') || ''
      let abs
      try {
        abs = new URL(href, location.origin).href
      } catch {
        continue
      }
      if (!/shopee\./i.test(abs)) continue
      const user = parseShopUsername(abs)
      if (shop_username && user && user !== shop_username) continue

      const name = (a.textContent || '').replace(/\s+/g, ' ').trim()
      if (!name || name.length > 80) continue
      if (/blog|help|mall$|seller|flash|ambassador|policy|coin/i.test(name)) continue

      let collId = null
      try {
        collId = new URL(abs).searchParams.get('shopCollection')
      } catch {
        /* ignore */
      }
      if (collId && !/^\d+$/.test(collId)) collId = null

      const isAll =
        /all\s*products/i.test(name) ||
        (!collId && /#product_list/i.test(abs) && user)

      if (!collId && !isAll) continue

      // Prefer nav/menu
      const inNav =
        a.closest('[class*="navbar"]') ||
        a.closest('[class*="menu"]') ||
        a.closest('nav') ||
        /navbar|menu/i.test(a.className || '')
      if (!inNav && !isAll && !collId) continue

      add({
        name,
        shop_collection_id: collId,
        url: abs.split('#')[0] + '#product_list',
        is_all_products: Boolean(isAll),
      })
    }

    if (shop_username && ![...byKey.values()].some((c) => c.is_all_products)) {
      add({
        name: 'All Products',
        shop_collection_id: null,
        url: location.origin + '/' + shop_username + '#product_list',
        is_all_products: true,
      })
    }

    const collections = [...byKey.values()].sort((a, b) => {
      if (a.is_all_products && !b.is_all_products) return -1
      if (!a.is_all_products && b.is_all_products) return 1
      return a.name.localeCompare(b.name)
    })

    return {
      shop_username,
      collections,
      page_url: location.href,
      discovered_at: new Date().toISOString(),
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      if (msg?.type === 'SKUMS_HARVEST_SHOP') {
        sendResponse({ ok: true, harvest: harvestShopProducts() })
        return true
      }
      if (msg?.type === 'SKUMS_DISCOVER_COLLECTIONS') {
        sendResponse({ ok: true, discovery: discoverShopCollections() })
        return true
      }
      if (msg?.type === 'SKUMS_SCAN_PAGE') {
        sendResponse({ ok: true, scan: scanShopIdentity() })
        return true
      }
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) })
      return true
    }
  })
})()
