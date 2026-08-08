/**
 * K-Beauty hub harvest via brand facet `bids=` codes.
 *
 * The Brands filter on https://sg.iherb.com/c/k-beauty lists every brand with:
 *   li.filter-item[data-id="CRX"][data-keyword="CosRx"]
 *   label[data-url="/c/k-beauty?bids=CRX"]
 *   .filter-name[data-count="74"]
 *
 * Multi-select uses comma-joined codes (URI-encoded):
 *   ?bids=CRX%2CVCT  →  CosRx + VT Cosmetics
 *
 * IMPORTANT: iHerb's rel=next drops `bids`. Always rebuild:
 *   /c/k-beauty?p=N&bids=CODE
 *
 * @see marketplace/iherb/harvestWorker.mjs
 * @see docs/IHERB_HANDOFF.md
 */

import { brandKeyFromDisplayName } from '../brandKey.mjs'

export const KBEAUTY_HUB_PATH = '/c/k-beauty'
export const KBEAUTY_DEFAULT_HOST = 'sg.iherb.com'

/**
 * @param {string | string[]} codes  e.g. 'CRX' or ['CRX','VCT']
 * @param {{ page?: number, host?: string, path?: string }} [opts]
 */
export function kBeautyBidsUrl(codes, opts = {}) {
  const list = (Array.isArray(codes) ? codes : String(codes || '').split(/[,|]/))
    .map((c) => String(c || '').trim())
    .filter(Boolean)
  if (!list.length) throw new Error('kBeautyBidsUrl: at least one brand code required')

  const host = opts.host || KBEAUTY_DEFAULT_HOST
  const path = opts.path || KBEAUTY_HUB_PATH
  const page = opts.page != null ? Number(opts.page) : 1

  const u = new URL(`https://${host}${path}`)
  // Single encode: CRX or CRX%2CVCT — browsers accept this; double-encoding also works.
  u.searchParams.set('bids', list.join(','))
  if (page > 1) u.searchParams.set('p', String(page))
  return u.toString()
}

/**
 * Rebuild a next-page URL while preserving bids (rel=next often drops them).
 * @param {string} currentUrl
 * @param {number} page  1-based
 * @param {string | string[] | null} [bidsCodes]
 */
export function kBeautyPageUrl(currentUrl, page, bidsCodes = null) {
  const u = new URL(currentUrl, 'https://sg.iherb.com')
  let codes = bidsCodes
  if (codes == null) {
    const raw = u.searchParams.get('bids')
    if (raw) {
      let decoded = raw
      try {
        decoded = decodeURIComponent(decoded)
        if (/%[0-9A-F]{2}/i.test(decoded)) decoded = decodeURIComponent(decoded)
      } catch { /* keep raw */ }
      codes = decoded.split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  if (codes == null || (Array.isArray(codes) && !codes.length)) {
    // no bids — plain hub pagination
    if (page <= 1) {
      u.searchParams.delete('p')
    } else {
      u.searchParams.set('p', String(page))
    }
    return u.toString()
  }
  return kBeautyBidsUrl(codes, {
    page,
    host: u.host,
    path: u.pathname,
  })
}

/**
 * Decode bids query value (handles single or double encoding).
 * @param {string | null | undefined} raw
 * @returns {string[]}
 */
export function decodeBidsParam(raw) {
  if (raw == null || raw === '') return []
  let s = String(raw)
  try {
    s = decodeURIComponent(s)
    if (/%[0-9A-F]{2}/i.test(s)) s = decodeURIComponent(s)
  } catch { /* keep */ }
  return s.split(/[,|]/).map((x) => x.trim()).filter(Boolean)
}

/**
 * Parse brand facet from K-Beauty (or any listing) HTML.
 * Includes lazy-load stubs that only have data-id + data-url.
 *
 * @param {string} html
 * @returns {Array<{
 *   code: string
 *   name: string | null
 *   count: number | null
 *   url: string | null
 *   exclusive?: boolean
 * }>}
 */
export function parseKBeautyBrandFacet(html) {
  const src = String(html || '')
  const byCode = new Map()

  // Fully rendered: <li class="filter-item" data-keyword="CosRx" data-id="CRX">
  //   <div class="filter-name" data-count="74">
  // Lazy: <li class="lazy-load-filter-item" data-id="BOJ" data-url="/c/k-beauty?bids=BOJ">
  const liRe = /<li\b([^>]*)>([\s\S]*?)(?=<li\b|<\/ul>)/gi
  let m
  while ((m = liRe.exec(src)) !== null) {
    const attrs = m[1] || ''
    const body = m[2] || ''
    if (!/filter-item|lazy-load-filter-item/i.test(attrs)) continue

    const dataId = attr(attrs, 'data-id')
    const dataKeyword = attr(attrs, 'data-keyword')
    const dataUrl = attr(attrs, 'data-url') || attr(body, 'data-url')
    const exclusive = /exclusive-brands|FilterExclusive/i.test(attrs + body)

    // value="CRX" on checkbox
    const valueMatch = body.match(/\bvalue="([A-Za-z0-9]{2,6})"/)
    const code = (dataId || valueMatch?.[1] || '').trim()
    if (!code) continue
    // Skip non-brand exclusive flag value "7"
    if (exclusive && code === '7') continue
    if (!/^[A-Za-z0-9]{2,6}$/.test(code)) continue

    const countMatch = body.match(/data-count="(\d+)"/)
      || attrs.match(/data-count="(\d+)"/)
    const count = countMatch ? Number(countMatch[1]) : null

    const name =
      dataKeyword
      || attr(body, 'aria-label')
      || attr(body, 'title')
      || null

    let url = dataUrl
    if (url && url.startsWith('/')) url = `https://sg.iherb.com${url}`
    if (!url) url = kBeautyBidsUrl(code)

    const prev = byCode.get(code)
    if (!prev) {
      byCode.set(code, {
        code,
        name: name || null,
        count: Number.isFinite(count) ? count : null,
        url,
        exclusive: false,
      })
    } else {
      // Prefer rows with a name and count
      if (!prev.name && name) prev.name = name
      if (prev.count == null && Number.isFinite(count)) prev.count = count
      if (!prev.url && url) prev.url = url
    }
  }

  // Also catch bare lazy-load items that the li splitter might miss
  const lazyRe = /<li[^>]*class="[^"]*lazy-load-filter-item[^"]*"[^>]*>/gi
  while ((m = lazyRe.exec(src)) !== null) {
    const tag = m[0]
    const code = attr(tag, 'data-id')
    if (!code || !/^[A-Za-z0-9]{2,6}$/.test(code)) continue
    let url = attr(tag, 'data-url')
    if (url && url.startsWith('/')) url = `https://sg.iherb.com${url}`
    if (!byCode.has(code)) {
      byCode.set(code, {
        code,
        name: null,
        count: null,
        url: url || kBeautyBidsUrl(code),
        exclusive: false,
      })
    }
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))
}

function attr(html, name) {
  const re = new RegExp(`${name}="([^"]*)"`, 'i')
  const m = String(html).match(re)
  return m ? decodeEntities(m[1]) : null
}

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/**
 * In-page extractor for the Brands facet (runs via page.evaluate).
 * Prefer this over HTML parse when lazy items need expansion.
 */
export function browserExtractBrandFacetEvaluate() {
  const root =
    document.querySelector('.filter-section.brands-search')
    || document.querySelector('.brands-search')
    || document.querySelector('[class*="brands-search"]')
    || document.querySelector('.filter-column')

  const byCode = new Map()
  if (!root) {
    return {
      brands: [],
      listCount: null,
      error: 'brand_facet_not_found',
    }
  }

  const list = root.querySelector('ul.filter-list[data-filter-type="brands"], ul.filter-list')
  const listCount = list?.getAttribute('data-filter-list-count')
  const items = root.querySelectorAll('li.filter-item, li.lazy-load-filter-item')

  for (const li of items) {
    const code = li.getAttribute('data-id')
      || li.querySelector('input.checkbox-filter')?.value
      || null
    if (!code || code === '7') continue
    if (!/^[A-Za-z0-9]{2,6}$/.test(code)) continue

    const name =
      li.getAttribute('data-keyword')
      || li.querySelector('input')?.getAttribute('aria-label')
      || li.querySelector('label')?.getAttribute('title')
      || null

    const countRaw =
      li.querySelector('.filter-name')?.getAttribute('data-count')
      || null
    const count = countRaw != null ? Number(countRaw) : null

    let url =
      li.getAttribute('data-url')
      || li.querySelector('label')?.getAttribute('data-url')
      || null
    if (url && url.startsWith('/')) url = `${location.origin}${url}`
    if (!url) url = `${location.origin}/c/k-beauty?bids=${encodeURIComponent(code)}`

    if (!byCode.has(code) || (name && !byCode.get(code).name)) {
      byCode.set(code, {
        code,
        name: name || byCode.get(code)?.name || null,
        count: Number.isFinite(count) ? count : byCode.get(code)?.count ?? null,
        url,
      })
    }
  }

  return {
    brands: [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code)),
    listCount: listCount != null ? Number(listCount) : null,
    error: null,
  }
}

/**
 * Attach brand_key from brand_name for multi-brand pages.
 * @param {Array<Record<string, any>>} products
 */
export function stampBrandKeysOnProducts(products) {
  return (products || []).map((p) => {
    const name = p.brand_name || null
    const brand_key = name ? brandKeyFromDisplayName(name) : null
    return { ...p, brand_key }
  })
}

/**
 * Group products by brand_id (fallback brand_key / brand_name).
 * @param {Array<Record<string, any>>} products
 * @returns {Map<string, { brand_id: string|null, brand_name: string|null, brand_key: string, products: any[] }>}
 */
export function groupProductsByBrand(products) {
  const map = new Map()
  for (const p of products || []) {
    const brand_id = p.brand_id != null ? String(p.brand_id) : null
    const brand_name = p.brand_name || null
    const brand_key =
      p.brand_key
      || (brand_name ? brandKeyFromDisplayName(brand_name) : null)
      || (brand_id ? brand_id.toLowerCase() : null)
      || 'unknown'
    const key = brand_id || brand_key
    if (!map.has(key)) {
      map.set(key, {
        brand_id,
        brand_name,
        brand_key,
        products: [],
      })
    }
    const g = map.get(key)
    if (!g.brand_name && brand_name) g.brand_name = brand_name
    if (!g.brand_id && brand_id) g.brand_id = brand_id
    if (brand_name && g.brand_key === 'unknown') {
      g.brand_key = brandKeyFromDisplayName(brand_name)
    }
    g.products.push(p)
  }
  return map
}

/**
 * Parse "of 2,935 results" → number.
 * @param {string | null | undefined} text
 */
export function parseResultCount(text) {
  const m = String(text || '').match(/of\s+([\d,]+)\s+results?/i)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
