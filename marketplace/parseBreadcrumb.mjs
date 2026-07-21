/**
 * MH-4 — Parse Shopee platform taxonomy from PDP BreadcrumbList JSON-LD.
 *
 * Validated against extensions/sample-serum-joseon.html:
 *   Shopee → Beauty & Personal Care → Skincare → Eye Care → [product]
 *   ids from *-cat.11012301.11012427.11012431
 *
 * This is NOT Mall marketing taxonomy (shopCollection).
 */

/**
 * Extract category id segments from a Shopee cat URL.
 * @param {string} href
 * @returns {string[]}
 */
export function parsePlatformCategoryIdsFromUrl(href) {
  if (!href) return []
  const m = String(href).match(/-cat\.([\d.]+)/i)
  if (!m) return []
  return m[1].split('.').filter((x) => /^\d+$/.test(x))
}

/**
 * Normalize one ListItem from BreadcrumbList.
 * @param {any} el
 * @returns {{ position: number, name: string, url: string | null, category_ids: string[] } | null}
 */
export function normalizeBreadcrumbItem(el) {
  if (!el || typeof el !== 'object') return null
  const item = el.item && typeof el.item === 'object' ? el.item : el
  const name = String(item.name || el.name || '').replace(/\s+/g, ' ').trim()
  const url = item['@id'] || item.url || el['@id'] || el.url || null
  if (!name) return null
  return {
    position: Number(el.position) || 0,
    name,
    url: url ? String(url) : null,
    category_ids: parsePlatformCategoryIdsFromUrl(url || ''),
  }
}

/**
 * Parse BreadcrumbList JSON-LD object (or raw HTML containing it).
 * @param {object | string} input  BreadcrumbList object, JSON string, or full HTML
 * @returns {{
 *   ok: boolean
 *   platform_category_path: string[]
 *   platform_category_ids: string[]
 *   platform_category_leaf: string | null
 *   platform_category_path_text: string | null
 *   crumbs: Array<{ position: number, name: string, url: string | null, category_ids: string[] }>
 *   error?: string
 * }}
 */
export function parseBreadcrumbList(input) {
  let obj = input
  if (typeof input === 'string') {
    const extracted = extractJsonLdBlocks(input).find(
      (b) => b && (b['@type'] === 'BreadcrumbList' || b['@type']?.includes?.('BreadcrumbList')),
    )
    if (!extracted) {
      // try raw JSON parse
      try {
        obj = JSON.parse(input)
      } catch {
        return emptyResult('no_breadcrumb_json_ld')
      }
    } else {
      obj = extracted
    }
  }

  if (!obj || typeof obj !== 'object') return emptyResult('invalid_input')

  // Graph form
  if (Array.isArray(obj['@graph'])) {
    const hit = obj['@graph'].find((g) => g?.['@type'] === 'BreadcrumbList')
    if (hit) obj = hit
  }

  if (obj['@type'] !== 'BreadcrumbList' && !String(obj['@type'] || '').includes('BreadcrumbList')) {
    return emptyResult('not_breadcrumb_list')
  }

  const raw = Array.isArray(obj.itemListElement) ? obj.itemListElement : []
  const crumbs = raw
    .map(normalizeBreadcrumbItem)
    .filter(Boolean)
    .sort((a, b) => a.position - b.position)

  if (!crumbs.length) return emptyResult('empty_item_list')

  // Drop trailing product crumb (last item usually is product name, not a category)
  const categoryCrumbs = crumbs.filter((c) => {
    if (c.category_ids.length) return true
    if (/^shopee$/i.test(c.name)) return true
    // product URLs look like -i.shop.item
    if (c.url && /-i\.\d+\.\d+/i.test(c.url)) return false
    return true
  })

  // Path: skip pure "Shopee" root for leaf logic but keep in full path for operators
  const path = categoryCrumbs.map((c) => c.name)
  const ids = []
  for (const c of categoryCrumbs) {
    for (const id of c.category_ids) {
      if (!ids.includes(id)) ids.push(id)
    }
  }

  // Leaf = last non-product category with ids, else last non-Shopee name
  let leaf = null
  for (let i = categoryCrumbs.length - 1; i >= 0; i--) {
    const c = categoryCrumbs[i]
    if (/^shopee$/i.test(c.name)) continue
    if (c.url && /-i\.\d+\.\d+/i.test(c.url)) continue
    leaf = c.name
    break
  }

  return {
    ok: true,
    platform_category_path: path,
    platform_category_ids: ids,
    platform_category_leaf: leaf,
    platform_category_path_text: path.join(' > '),
    crumbs,
  }
}

/**
 * Extract all JSON-LD objects from HTML string.
 * @param {string} html
 * @returns {object[]}
 */
export function extractJsonLdBlocks(html) {
  const out = []
  if (!html) return out
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) out.push(...parsed)
      else out.push(parsed)
    } catch {
      /* ignore bad blocks */
    }
  }
  return out
}

/**
 * Parse Product JSON-LD for optional rich fields (price, rating).
 * @param {object | string} input
 */
export function parseProductJsonLd(input) {
  let obj = input
  if (typeof input === 'string') {
    const blocks = extractJsonLdBlocks(input)
    obj = blocks.find((b) => b?.['@type'] === 'Product') || null
  }
  if (!obj || obj['@type'] !== 'Product') {
    return { ok: false, error: 'no_product_json_ld' }
  }

  const offers = obj.offers
  const offer = Array.isArray(offers) ? offers[0] : offers
  const rating = obj.aggregateRating || {}

  let price = null
  if (offer?.price != null) price = Number(offer.price)
  else if (offer?.lowPrice != null) price = Number(offer.lowPrice)

  return {
    ok: true,
    name: obj.name || null,
    price: Number.isFinite(price) ? price : null,
    currency: offer?.priceCurrency || 'SGD',
    rating: rating.ratingValue != null ? Number(rating.ratingValue) : null,
    review_count: rating.ratingCount != null ? Number(rating.ratingCount) : null,
  }
}

/**
 * Full HTML → platform path + product rich fields.
 * @param {string} html
 */
export function parsePdpHtml(html) {
  const blocks = extractJsonLdBlocks(html)
  const bc = blocks.find((b) => b?.['@type'] === 'BreadcrumbList')
  const product = blocks.find((b) => b?.['@type'] === 'Product')
  const breadcrumb = parseBreadcrumbList(bc || html)
  const productParsed = product ? parseProductJsonLd(product) : parseProductJsonLd(html)
  return {
    breadcrumb,
    product: productParsed,
  }
}

function emptyResult(error) {
  return {
    ok: false,
    platform_category_path: [],
    platform_category_ids: [],
    platform_category_leaf: null,
    platform_category_path_text: null,
    crumbs: [],
    error,
  }
}

/**
 * In-page extract for Puppeteer page.evaluate (must be self-contained).
 */
export function browserPdpEvaluate() {
  const blocks = []
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(s.textContent || '')
      if (Array.isArray(parsed)) blocks.push(...parsed)
      else blocks.push(parsed)
    } catch {
      /* ignore */
    }
  }
  let breadcrumb = null
  let product = null
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue
    if (b['@type'] === 'BreadcrumbList') breadcrumb = b
    if (b['@type'] === 'Product') product = b
    if (Array.isArray(b['@graph'])) {
      for (const g of b['@graph']) {
        if (g?.['@type'] === 'BreadcrumbList') breadcrumb = g
        if (g?.['@type'] === 'Product') product = g
      }
    }
  }
  return {
    page_url: location.href,
    title: document.title,
    breadcrumb,
    product,
    session_probe: {
      title: document.title,
      bodySnippet: (document.body?.innerText || '').slice(0, 400),
    },
  }
}
