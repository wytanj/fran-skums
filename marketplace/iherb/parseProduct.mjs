/**
 * Parse an iHerb product detail page (`sg.iherb.com/pr/<slug>/<id>`).
 *
 * Written against extensions/skin1004-product-page.html and
 * extensions/sample-iherb-pdp-rankings.html (Merrymonde rankings).
 *
 * Unlike the catalogue page — which has no usable structured payload and has to
 * be read out of `data-ga-*` attributes — the PDP ships a complete schema.org
 * Product block. Parse that and ignore the DOM for identity/price: it is typed,
 * it is a published contract, and it survives redesigns that move class names.
 *
 * What the PDP adds over the catalogue row (same economics as Shopee MH-4 —
 * list is cheap, per-product is not; run top-N only):
 *
 *   gtin12      real barcode — non-fuzzy join key (catalogue has none)
 *   breadcrumb  platform category path (Beauty > Cleansers > Face Washes)
 *   weight      shipping weight for pack-size normalisation
 *   rankings    best-seller ranks per category tree (DOM `.best-selling-rank`)
 *   description marketing copy
 *
 * Rankings are time-varying; store on snapshot.signals + product metadata.
 *
 * @see marketplace/iherb/parseCatalogue.mjs
 * @see marketplace/iherb/pdpEnrich.mjs
 * @see tests/iherb-parse-product.test.mjs
 */
import { parseSoldLabel } from '../soldLabel.mjs'
import { parseVolumeMl, pricePerMl } from './query.mjs'

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
 * "Product rankings" on the PDP — not in schema.org Product.
 *
 * Markup (stable enough class names + GA contract):
 *   <div class="best-selling-rank">
 *     <h2>Product rankings:</h2>
 *     <div>
 *       <strong class="rank">#5 in</strong>
 *       <a class="crumbs" href="/c/k-beauty-eyeliner?sr=2"
 *          data-ga-event-name="product_ranking"
 *          data-ga-event-label="5"
 *          data-ga-event-action="107537">K-Beauty Eyeliner</a>
 *     </div>
 *     …
 *   </div>
 *
 * Important: the page also repeats ranks inside the colour-variant comparison
 * table (`.attribute-row.rank` / `.rank-list-N`). Those belong to *other*
 * variants, not this SKU. Always prefer `.best-selling-rank` first.
 *
 * @param {string} html
 * @returns {Array<{
 *   rank: number
 *   category: string
 *   category_slug: string | null
 *   category_url: string | null
 *   category_id: string | null
 * }>}
 */
export function parseProductRankings(html) {
  const src = String(html || '')
  // Prefer the dedicated block; fall back to a looser scan only if missing.
  const blockMatch = src.match(
    /class="[^"]*\bbest-selling-rank\b[^"]*"[\s\S]{0,8000}?(?=<\/section>|<section\b|<\/div>\s*<\/section>)/i,
  )
  let block = blockMatch ? blockMatch[0] : ''

  // If the class match is truncated oddly, take from heading to next section
  if (!block || !/#\s*\d+/i.test(block)) {
    const h2 = src.search(/Product rankings\s*:/i)
    if (h2 >= 0) {
      block = src.slice(h2, h2 + 6000)
      const end = block.search(/<\/section>/i)
      if (end > 0) block = block.slice(0, end)
    }
  }

  const scope = block && /#\s*\d+/i.test(block) ? block : ''
  if (!scope) return []

  const rankings = []
  const seen = new Set()

  // Pair rank + category link (GA product_ranking preferred)
  const re = /class="rank"[^>]*>\s*#\s*([\d,]+)\s*in\s*<\/strong>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let m
  while ((m = re.exec(scope)) !== null) {
    const rank = num(m[1])
    const aAttrs = m[2] || ''
    const labelHtml = m[3] || ''
    const category = decodeEntities(stripTags(labelHtml).replace(/\s+/g, ' ').trim())
    if (rank == null || !category) continue

    const href = attr(aAttrs, 'href')
    const category_url = href
      ? (href.startsWith('http') ? href : `https://sg.iherb.com${href.startsWith('/') ? '' : '/'}${href}`)
      : null
    const category_slug = slugFromHref(href)
    const category_id = attr(aAttrs, 'data-ga-event-action') // numeric category id in GA
    // Prefer GA label when present (string rank)
    const gaLabel = attr(aAttrs, 'data-ga-event-label')
    const rankFinal = num(gaLabel) ?? rank

    const key = `${rankFinal}|${category_slug || category}`
    if (seen.has(key)) continue
    seen.add(key)
    rankings.push({
      rank: rankFinal,
      category,
      category_slug,
      category_url,
      category_id,
    })
  }

  // Fallback text pattern inside the block only
  if (!rankings.length) {
    for (const tm of scope.matchAll(/#\s*([\d,]+)\s+in\s+([^<#\n]+)/gi)) {
      const rank = num(tm[1])
      const category = decodeEntities(
        String(tm[2] || '').replace(/\s+/g, ' ').replace(/>\s*$/, '').trim(),
      )
      if (rank == null || !category) continue
      const key = `${rank}|${category}`
      if (seen.has(key)) continue
      seen.add(key)
      rankings.push({
        rank,
        category,
        category_slug: null,
        category_url: null,
        category_id: null,
      })
    }
  }

  return rankings
}

/**
 * Specifications block (#product-specs-list) + dimension data attrs.
 *
 * @param {string} html
 * @returns {{
 *   first_available: string | null
 *   delivery_weight: string | null
 *   product_code: string | null
 *   upc: string | null
 *   package_quantity: string | null
 *   dimensions: string | null
 *   actual_weight: string | null
 *   dimensions_cm: string | null
 *   dimensions_in: string | null
 *   shipping_weight_lb: string | null
 * }}
 */
export function parseProductSpecs(html) {
  const src = String(html || '')
  const blockMatch = src.match(
    /id="product-specs-list"[^>]*>([\s\S]{0,6000}?)<\/ul>/i,
  )
  const block = blockMatch ? blockMatch[1] : ''

  const pickLi = (labelRe) => {
    if (!block) return null
    const re = new RegExp(
      `<li[^>]*>\\s*${labelRe}\\s*:?\\s*([\\s\\S]*?)<\\/li>`,
      'i',
    )
    const m = block.match(re)
    if (!m) return null
    return decodeEntities(stripTags(m[1]).replace(/\s+/g, ' ').trim()) || null
  }

  const product_code =
    pickLi('Product\\s*Code')
    || (() => {
      const m = block.match(/Product\s*Code:\s*<span[^>]*>([^<]+)/i)
      return m ? decodeEntities(m[1].trim()) : null
    })()

  const upc =
    pickLi('UPC')
    || (() => {
      const m = block.match(/UPC:\s*<span[^>]*>([^<]+)/i)
      return m ? decodeEntities(m[1].trim()) : null
    })()
    || (src.match(/upcCd:\s*(\d+)/) || [])[1]
    || null

  let package_quantity =
    (block.match(/package-quantity"[^>]*>([^<]+)/i) || [])[1]?.trim()
    || pickLi('Package\\s*quantity')
  if (package_quantity) package_quantity = decodeEntities(package_quantity)

  const dimensions =
    (block.match(/id="dimensions"[^>]*>([^<]+)/i) || [])[1]?.trim()
    || null
  const actual_weight =
    (block.match(/id="actual-weight"[^>]*>([^<]+)/i) || [])[1]?.trim()
    || null

  const first_available =
    (block.match(/product-sale-date"[^>]*>([^<]+)/i) || [])[1]?.trim()
    || pickLi('First\\s*available')

  const delivery_weight =
    (block.match(/product-shipping-weight-label"[^>]*>([^<]+)/i) || [])[1]?.trim()
    || pickLi('Delivery\\s*weight')

  return {
    first_available: first_available ? decodeEntities(first_available.replace(/\s+/g, ' ').trim()) : null,
    delivery_weight: delivery_weight ? decodeEntities(delivery_weight.replace(/\s+/g, ' ').trim()) : null,
    product_code: product_code || null,
    upc: upc ? String(upc).replace(/\D/g, '') || upc : null,
    package_quantity: package_quantity || null,
    dimensions: dimensions ? decodeEntities(dimensions) : null,
    actual_weight: actual_weight ? decodeEntities(actual_weight) : null,
    dimensions_cm: (src.match(/data-dimensions-cm="([^"]+)"/i) || [])[1] || null,
    dimensions_in: (src.match(/data-dimensions-in="([^"]+)"/i) || [])[1] || null,
    shipping_weight_lb: (src.match(/data-actual-weight-lb="([^"]+)"/i) || [])[1] || null,
  }
}

/**
 * Overview sections: suggested use, ingredients, warnings.
 *
 * @param {string} html
 * @returns {{
 *   suggested_use: string | null
 *   ingredients_text: string | null
 *   warnings: string | null
 * }}
 */
export function parseProductIngredients(html) {
  const src = String(html || '')

  const sectionAfterH3 = (titleRe) => {
    const re = new RegExp(
      `<h3[^>]*>\\s*${titleRe}\\s*<\\/h3>\\s*<div[^>]*class="[^"]*prodOverview[^"]*"[^>]*>([\\s\\S]{0,8000}?)<\\/div>`,
      'i',
    )
    const m = src.match(re)
    if (!m) {
      // looser: any div after h3 until next h3/row
      const re2 = new RegExp(
        `<h3[^>]*>\\s*${titleRe}\\s*<\\/h3>([\\s\\S]{0,8000}?)(?=<h3\\b|<div class="row item-row"|$)`,
        'i',
      )
      const m2 = src.match(re2)
      if (!m2) return null
      return cleanOverviewText(m2[1])
    }
    return cleanOverviewText(m[1])
  }

  // Newer PDP layout (.ingredient-info / #product-supplement-facts):
  //   <h3><strong>Other ingredients</strong></h3><div><p>…INCI…</p></div>
  // The title is wrapped in an inline tag (<strong>) and the content div
  // carries no prodOverview* class, so sectionAfterH3 misses it entirely.
  // Grab the div immediately after the (inline-tag-tolerant) heading.
  const newLayoutSection = (titleRe) => {
    const re = new RegExp(
      `<h3[^>]*>(?:\\s|<[^>]+>)*${titleRe}(?:\\s|<[^>]+>)*<\\/h3>\\s*<div[^>]*>([\\s\\S]{0,8000}?)<\\/div>`,
      'i',
    )
    const m = src.match(re)
    return m ? cleanOverviewText(m[1]) : null
  }

  // Prefer "Other ingredients" then "Ingredients"
  const ingredients_text =
    sectionAfterH3('Other\\s+ingredients')
    || sectionAfterH3('Ingredients')
    || (() => {
      const m = src.match(
        /class="prodOverviewIngred"[^>]*>([\s\S]{0,8000}?)<\/div>/i,
      )
      return m ? cleanOverviewText(m[1]) : null
    })()
    || newLayoutSection('Other\\s+ingredients')
    || newLayoutSection('Ingredients')

  const suggested_use =
    sectionAfterH3('Suggested\\s+use')
    || (() => {
      // first prodOverviewDetail under overview often = description/suggested use
      const m = src.match(
        /Suggested\s+use\s*<\/h3>\s*<div[^>]*class="[^"]*prodOverviewDetail[^"]*"[^>]*>([\s\S]{0,4000}?)<\/div>/i,
      )
      return m ? cleanOverviewText(m[1]) : null
    })()
    || newLayoutSection('Suggested\\s+use')
    || newLayoutSection('Directions')

  const warnings = sectionAfterH3('Warnings') || newLayoutSection('Warnings')

  return {
    suggested_use,
    ingredients_text,
    warnings,
  }
}

function cleanOverviewText(html) {
  return decodeEntities(stripTags(html).replace(/\s+/g, ' ').trim()) || null
}

function attr(html, name) {
  const m = String(html).match(new RegExp(`${name}="([^"]*)"`, 'i'))
  return m ? decodeEntities(m[1]) : null
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, ' ')
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

function slugFromHref(href) {
  if (!href) return null
  try {
    const path = href.startsWith('http') ? new URL(href).pathname : String(href).split('?')[0]
    const m = path.match(/\/c\/([^/?#]+)/i)
    return m ? decodeURIComponent(m[1]).toLowerCase() : null
  } catch {
    return null
  }
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
  // field that measures demand. Absence = below iHerb display floor, not zero.
  const soldText = (src.match(/([\d,]+\+?\s*sold\s*in\s*30\s*days)/i) || [])[1] || null
  const sold = soldText ? parseSoldLabel(soldText.trim()) : null

  // Best-seller ranks per category tree — also DOM-only (not in ld+json).
  const rankings = parseProductRankings(src)

  const specs = parseProductSpecs(src)
  const overview = parseProductIngredients(src)

  // Package quantity: specs list preferred, then at-a-glance
  const packageQtyLabel =
    specs.package_quantity
    || (() => {
      const m = src.match(
        /product-at-a-glance__key-info-label[^>]*>\s*Package quantity\s*<\/[^>]+>\s*<strong[^>]*class="[^"]*product-at-a-glance__key-info-value[^"]*"[^>]*>([^<]+)/i,
      )
      return m ? stripTags(m[1]).replace(/\s+/g, ' ').trim() : null
    })()

  const name = product.name || null
  const volume_ml =
    parseVolumeMl(packageQtyLabel)
    || parseVolumeMl(name)
  const price = num(offers?.price)
  const dimensions_cm = specs.dimensions_cm || specs.dimensions || null
  const dimensions_in = specs.dimensions_in || null

  return {
    url: meta.url || product.url || null,
    captured_at: meta.captured_at || null,
    found: true,

    product_id: product.productID != null ? String(product.productID) : null,
    part_number: product.sku || product.mpn || specs.product_code || null,
    // A real barcode. The catalogue page has no equivalent, and this is the only
    // non-fuzzy key available for joining to another channel or to our own
    // identity spine.
    gtin: product.gtin12 || product.gtin13 || product.gtin || specs.upc || null,

    name,
    brand_name: product.brand?.name || null,
    brand_id: product.brand?.identifier || null,
    brand_url: product.brand?.url || null,

    price,
    currency: offers?.priceCurrency || null,
    in_stock: availabilityToInStock(offers?.availability),

    // Unit economics
    package_quantity_label: packageQtyLabel,
    volume_ml,
    price_per_ml: pricePerMl(price, volume_ml),

    rating: num(rating.ratingValue),
    review_count: num(rating.reviewCount ?? rating.ratingCount),

    // Coarse, one word. The breadcrumb below is the useful taxonomy.
    category_name: product.category?.name || null,
    category_id: product.category?.identifier || null,
    breadcrumb,

    weight_value: num(product.weight?.value),
    weight_unit: product.weight?.unitText || null,
    dimensions_cm,
    dimensions_in,

    // Specifications + formulation (PDP depth)
    specifications: specs,
    ingredients_text: overview.ingredients_text,
    suggested_use: overview.suggested_use,
    warnings: overview.warnings,

    sold_label: soldText ? soldText.trim() : null,
    sold_lower_bound: sold?.lower_bound ?? null,
    sold_is_bucket: sold?.is_bucket ?? null,
    sold_period: sold?.period ?? (soldText ? 'month' : null),

    // Time-varying; store on snapshot.signals when enriching. Best rank first.
    rankings,
    rank_best: rankings[0] || null,

    description: product.description || null,
    image: product.image || product.logo || null,
  }
}
