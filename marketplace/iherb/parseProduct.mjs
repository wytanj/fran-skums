/**
 * Parse an iHerb product detail page (`sg.iherb.com/pr/<slug>/<id>`).
 *
 * Written against extensions/skin1004-product-page.html.
 *
 * Unlike the catalogue page — which has no usable structured payload and has to
 * be read out of `data-ga-*` attributes — the PDP ships a complete schema.org
 * Product block. Parse that and ignore the DOM: it is typed, it is a published
 * contract, and it survives redesigns that move every class name.
 *
 * What the PDP adds over the catalogue row, and why a second navigation per
 * product can be worth paying for:
 *
 *   gtin12      a real barcode — a non-fuzzy identifier, which the catalogue
 *               page does not carry at all
 *   breadcrumb  the actual category path (Categories > Beauty > Cleansers >
 *               Face Washes), not the brand navigation the catalogue exposes
 *   weight      shipping weight, for normalising price across pack sizes
 *   description copy, for anyone who wants it
 *
 * This is the same economics as Shopee MH-4: the list pass is cheap and the
 * per-product pass is not, so it should be run on a top-N slice rather than
 * every row.
 *
 * @see marketplace/iherb/parseCatalogue.mjs
 * @see tests/iherb-parse-product.test.mjs
 */

function ldBlocks(html) {
  const out = []
  for (const m of String(html).matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      out.push(JSON.parse(m[1].trim()))
    } catch {
      // A malformed block is not a reason to abandon the others.
    }
  }
  return out
}

function typeOf(node) {
  return String(node?.['@type'] || '')
}

function num(v) {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** schema.org availability URL → boolean. Unknown stays null, never false. */
export function availabilityToInStock(value) {
  const s = String(value || '').toLowerCase()
  if (!s) return null
  if (s.includes('instock') || s.includes('limitedavailability')) return true
  if (s.includes('outofstock') || s.includes('soldout') || s.includes('discontinued')) return false
  return null
}

/**
 * Category path from the BreadcrumbList.
 *
 * Drops the leading "Categories" crumb — it is a site-structure label, not a
 * category, and keeping it would make every path look one level deeper than it is.
 */
export function parseProductBreadcrumb(html) {
  for (const node of ldBlocks(html)) {
    if (!/BreadcrumbList/i.test(typeOf(node))) continue
    const names = (node.itemListElement || [])
      .sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0))
      .map((el) => el?.item?.name || el?.name)
      .filter(Boolean)
    const path = names.filter((n) => !/^categor(y|ies)$/i.test(n))
    if (!path.length) continue
    return {
      path,
      path_text: path.join(' > '),
      leaf: path[path.length - 1],
      scope: 'platform_category',
    }
  }
  return null
}

/**
 * @param {string} html
 * @param {{ url?: string, captured_at?: string }} [meta]
 */
export function parseIherbProduct(html, meta = {}) {
  const src = String(html || '')
  const product = ldBlocks(src).find((n) => /Product/i.test(typeOf(n))) || null
  const breadcrumb = parseProductBreadcrumb(src)

  if (!product) {
    return {
      url: meta.url || null,
      captured_at: meta.captured_at || null,
      found: false,
      breadcrumb,
      // Say why rather than returning an empty object that reads as "no data".
      reason: 'No schema.org Product block — likely a bot wall, or not a product page.',
    }
  }

  const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers
  const rating = product.aggregateRating || {}

  // "N+ sold in 30 days" is not in the payload; it is rendered text, same as on
  // the catalogue page. Captured here so a PDP-only pass is not missing the one
  // field that measures demand.
  const soldText = (src.match(/([\d,]+\+?\s*sold\s*in\s*30\s*days)/i) || [])[1] || null

  return {
    url: meta.url || product.url || null,
    captured_at: meta.captured_at || null,
    found: true,

    product_id: product.productID != null ? String(product.productID) : null,
    part_number: product.sku || product.mpn || null,
    // A real barcode. The catalogue page has no equivalent, and this is the only
    // non-fuzzy key available for joining to another channel or to our own
    // identity spine.
    gtin: product.gtin12 || product.gtin13 || product.gtin || null,

    name: product.name || null,
    brand_name: product.brand?.name || null,
    brand_id: product.brand?.identifier || null,
    brand_url: product.brand?.url || null,

    price: num(offers?.price),
    currency: offers?.priceCurrency || null,
    in_stock: availabilityToInStock(offers?.availability),

    rating: num(rating.ratingValue),
    review_count: num(rating.reviewCount ?? rating.ratingCount),

    // Coarse, one word. The breadcrumb below is the useful taxonomy.
    category_name: product.category?.name || null,
    category_id: product.category?.identifier || null,
    breadcrumb,

    weight_value: num(product.weight?.value),
    weight_unit: product.weight?.unitText || null,

    sold_label: soldText ? soldText.trim() : null,
    description: product.description || null,
    image: product.image || product.logo || null,
  }
}
