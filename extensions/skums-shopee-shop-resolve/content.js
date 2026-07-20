/**
 * Content script — scan current Shopee page for Mall / shop identity.
 * Runs in the user's real Chrome session (no Puppeteer captcha wall).
 */
(function () {
  'use strict'

  function parseShopUsername(href) {
    if (!href) return null
    try {
      const u = new URL(href, location.origin)
      if (!/shopee\./i.test(u.hostname)) return null
      const seg = u.pathname.replace(/^\//, '').split('/')[0]
      if (!seg || seg === 'search' || seg === 'product' || seg === 'buyer') return null
      if (/-i\.\d+\.\d+/i.test(seg)) return null
      if (seg === 'shop') {
        // /shop/123 — numeric only
        return null
      }
      if (!/^[a-zA-Z0-9._-]{2,64}$/.test(seg)) return null
      return seg.toLowerCase()
    } catch {
      return null
    }
  }

  function parseShopIdFromListing(href) {
    if (!href) return null
    const m = String(href).match(/-i\.(\d+)\.(\d+)/) || String(href).match(/\/product\/(\d+)\/(\d+)/)
    return m ? m[1] : null
  }

  function pageKind() {
    const path = location.pathname
    if (path.startsWith('/search')) return 'serp'
    if (/-i\.\d+\.\d+/.test(path) || path.startsWith('/product/')) return 'listing'
    if (path.startsWith('/shop/')) return 'shop_by_id'
    const user = parseShopUsername(location.href)
    if (user) return 'shop'
    return 'other'
  }

  function scanPage() {
    const kind = pageKind()
    const candidates = []
    const seen = new Set()

    function add(c) {
      const key = c.shop_username || c.shop_id || c.shop_url
      if (!key || seen.has(key)) return
      seen.add(key)
      candidates.push(c)
    }

    // Current page is a shop storefront
    if (kind === 'shop') {
      const username = parseShopUsername(location.href)
      if (username) {
        add({
          shop_username: username,
          shop_url: `${location.origin}/${username}`,
          shop_id: null,
          shop_name: document.title.replace(/\s*\|.*$/, '').trim() || username,
          seller_hint: 'page_is_shop',
          source: 'page_url',
          confidence: 0.95,
        })
      }
    }

    // Collect anchors
    const anchors = Array.from(document.querySelectorAll('a[href]'))
    for (const a of anchors) {
      const href = a.getAttribute('href') || ''
      const text = (a.textContent || '').trim().slice(0, 160)
      const abs = href.startsWith('http') ? href : new URL(href, location.origin).href

      const username = parseShopUsername(abs)
      const shopId = abs.match(/\/shop\/(\d+)/)?.[1] || parseShopIdFromListing(abs)

      // Mall / official cues near the link
      const parent = a.closest('[data-sqe], li, div, article') || a.parentElement
      const blob = `${text} ${parent?.innerText?.slice(0, 200) || ''}`.toLowerCase()
      const mallish =
        /mall|official|brand store|旗舰/.test(blob) ||
        /mall|official/.test(text.toLowerCase())

      if (username) {
        add({
          shop_username: username,
          shop_url: `${location.origin}/${username}`,
          shop_id: shopId,
          shop_name: text || username,
          seller_hint: mallish ? 'mall_or_official' : 'link',
          source: 'dom_link',
          confidence: mallish ? 0.85 : 0.55,
        })
      } else if (shopId && mallish) {
        add({
          shop_username: null,
          shop_url: `${location.origin}/shop/${shopId}`,
          shop_id: shopId,
          shop_name: text || `shop ${shopId}`,
          seller_hint: 'mall_or_official',
          source: 'shop_id_link',
          confidence: 0.5,
        })
      }
    }

    // Sort: confidence desc
    candidates.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))

    return {
      page_kind: kind,
      page_url: location.href,
      page_title: document.title,
      search_query: new URLSearchParams(location.search).get('keyword') || null,
      candidates: candidates.slice(0, 25),
      scanned_at: new Date().toISOString(),
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'SKUMS_SCAN_PAGE') {
      try {
        sendResponse({ ok: true, scan: scanPage() })
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) })
      }
      return true
    }
  })
})()
