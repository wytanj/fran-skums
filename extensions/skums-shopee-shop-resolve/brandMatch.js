/**
 * Fuzzy match Mall @username / page title → brand universe row.
 * Keep logic in sync with marketplace/guessBrandFromShop.mjs (tested there).
 */
;(function (global) {
  function compact(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
  }

  /** Strip common storefront suffixes: official, sg, store, … */
  function stripShopNoise(usernameCompact) {
    let u = usernameCompact
    // repeat a few times for officialsg etc.
    for (let i = 0; i < 3; i++) {
      const next = u
        .replace(/(official|mall|store|shop|beauty|skincare|singapore)$/i, '')
        .replace(/(sg|my|ph|th|vn|id|tw|br)$/i, '')
      if (next === u || next.length < 3) break
      u = next
    }
    return u
  }

  function needsShop(b) {
    return !b.shop_username || b.shop_resolve_status !== 'confirmed'
  }

  /**
   * @param {object} brand
   * @param {string} shopUsername
   * @param {string} [pageTitle]
   * @returns {number}
   */
  function scoreBrandAgainstShop(brand, shopUsername, pageTitle) {
    const rawUser = String(shopUsername || '').toLowerCase().trim()
    if (!rawUser || !brand) return 0

    const u = compact(rawUser)
    const uBare = stripShopNoise(u)
    const key = compact(brand.brand_key)
    const name = compact(brand.display_name)
    let score = 0

    // Already linked to this username
    if (String(brand.shop_username || '').toLowerCase() === rawUser) {
      return 1000
    }

    if (u === key || u === name) score = 100
    else if (uBare && (uBare === key || uBare === name)) score = 95
    else if (key.length >= 4 && (u.startsWith(key) || uBare.startsWith(key))) score = 90
    else if (key.length >= 4 && (u.includes(key) || uBare.includes(key))) score = 85
    else if (name.length >= 5 && (u.includes(name) || uBare.includes(name))) score = 80
    else if (uBare.length >= 5 && key.includes(uBare)) score = 70
    else {
      // token overlap: beauty-of-joseon vs beautyofjoseonsg
      const tokens = String(brand.brand_key || '')
        .toLowerCase()
        .split(/[-_\s]+/)
        .filter((t) => t.length >= 3)
      if (tokens.length) {
        const hit = tokens.filter((t) => u.includes(t) || uBare.includes(t)).length
        if (hit === tokens.length) score = 78
        else if (hit >= Math.ceil(tokens.length * 0.6)) score = 55
      }
    }

    const title = String(pageTitle || '').toLowerCase()
    const display = String(brand.display_name || '').toLowerCase()
    if (display.length >= 3 && title.includes(display)) {
      score = Math.max(score, 75)
    }

    // Prefer unconfirmed when scores are close (caller may boost)
    if (needsShop(brand) && score > 0) score += 3

    if (brand.pilot_tier === 'pilot' && score > 0) score += 1

    return score
  }

  /**
   * @param {object[]} brands
   * @param {{ shop_username?: string, page_title?: string, min_score?: number, prefer_unconfirmed?: boolean }} [opts]
   * @returns {{ brand: object, score: number } | null}
   */
  function guessBrandForShop(brands, opts = {}) {
    const list = Array.isArray(brands) ? brands : []
    const min = opts.min_score ?? 55
    const username = opts.shop_username || ''
    const title = opts.page_title || ''
    if (!username && !title) return null

    let best = null
    for (const b of list) {
      let s = scoreBrandAgainstShop(b, username, title)
      if (opts.prefer_unconfirmed !== false && needsShop(b) && s >= min) {
        // small extra so unconfirmed wins ties vs already-confirmed namesakes
        s += 2
      }
      if (s < min) continue
      if (!best || s > best.score) best = { brand: b, score: s }
    }
    return best
  }

  /**
   * Parse Mall username from shopee.sg URL path.
   * @param {string} url
   * @returns {string | null}
   */
  function usernameFromShopUrl(url) {
    try {
      const u = new URL(url)
      if (!/shopee\.sg$/i.test(u.hostname) && !/\.shopee\.sg$/i.test(u.hostname)) return null
      const seg = u.pathname.replace(/^\//, '').split('/')[0] || ''
      if (!seg || /^(search|product|buyer|shop|cart|mall|collection|flash_sale)/i.test(seg)) return null
      if (/-i\.\d+\.\d+/i.test(seg)) return null
      if (!/^[a-zA-Z0-9._-]{2,64}$/.test(seg)) return null
      return seg.toLowerCase()
    } catch {
      return null
    }
  }

  global.SkumsBrandMatch = {
    compact,
    stripShopNoise,
    scoreBrandAgainstShop,
    guessBrandForShop,
    usernameFromShopUrl,
    needsShop,
  }
})(typeof globalThis !== 'undefined' ? globalThis : window)
