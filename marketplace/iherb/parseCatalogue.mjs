/**
 * Parse an iHerb brand catalogue page (`sg.iherb.com/c/<brand>`).
 *
 * Written against extensions/sample-iherb-anua.html, captured from the warm
 * profile by the probe. Every selector here was read off real markup rather than
 * guessed — see docs/IHERB_COLLECT_DESIGN.md for why that mattered.
 *
 * Reads the `data-ga-*` analytics attributes in preference to visible text.
 * They carry the values already typed — a numeric price with no currency glyph,
 * the brand, the grid position, the stock flag — and an analytics contract tends
 * to outlive the class names around it, which is the usual thing that breaks a
 * scraper after a redesign. Visible text is the fallback, not the source.
 *
 * The find worth knowing: iHerb publishes **"N+ sold in 30 days"** — a rate,
 * explicitly labelled. Shopee's sold_count_lower_bound is a cumulative lifetime
 * bucket. They are not the same measurement and must never be compared as one
 * number; see SOLD_FIELD_CAVEAT in marketplace/metrics/definitions.mjs.
 *
 * @see marketplace/iherb/probeSpec.mjs
 * @see tests/iherb-parse-catalogue.test.mjs
 */
import { parseSoldLabel } from '../soldLabel.mjs'

/** One product per `.product-cell-container`; 48 on a full page. */
const TILE_SPLIT = /<div[^>]*class="[^"]*\bproduct-cell-container\b[^"]*"/g

function attr(html, name) {
  const m = html.match(new RegExp(`${name}="([^"]*)"`))
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

function num(v) {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** iHerb writes booleans as "True"/"False" in GA attributes and "true"/"false" in DOM ones. */
function bool(v) {
  if (v == null) return null
  const s = String(v).toLowerCase()
  if (s === 'true') return true
  if (s === 'false') return false
  return null
}

/**
 * Rating and review count share one attribute: title="4.7/5 - 7,354 Reviews".
 * Parsing both from it is why the probe reported them missing — nothing was in
 * the element text.
 */
export function parseRatingTitle(title) {
  const s = String(title || '')
  const m = s.match(/([\d.]+)\s*\/\s*5\s*-\s*([\d,]+)\s*Review/i)
  if (!m) return { rating: null, review_count: null }
  return { rating: num(m[1]), review_count: num(m[2]) }
}

/** "SG$17.31" → SGD. Read per tile, never from a page-level banner. */
export function currencyFromPriceText(text) {
  const s = String(text || '').toUpperCase()
  if (/SG\$|\bSGD\b/.test(s)) return 'SGD'
  if (/\bUSD\b|US\$/.test(s)) return 'USD'
  if (/\bMYR\b|\bRM\b/.test(s)) return 'MYR'
  return null
}

/**
 * The add-to-cart button carries a JSON blob with the pre-discount price, which
 * is the only place list price appears when there is no visible strikethrough.
 */
function cartInfo(tile) {
  const raw = attr(tile, 'data-cart-info')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed?.lineItems?.[0] || null
  } catch {
    return null // a malformed blob costs list price, not the whole row
  }
}

function parseTile(tile) {
  const productId = attr(tile, 'data-ga-product-id') || (tile.match(/itemid="pid_(\d+)"/) || [])[1] || null
  const partNumber = attr(tile, 'data-part-number')
  if (!productId && !partNumber) return null

  const hrefMatch = tile.match(/class="[^"]*\babsolute-link\b[^"]*"[^>]*href="([^"]+)"/)
    || tile.match(/href="(https:\/\/[a-z.]*iherb\.com\/pr\/[^"]+)"/)
  const url = hrefMatch ? decodeEntities(hrefMatch[1]) : null

  const name = attr(tile, 'title')
    || (tile.match(/class="product-title"[^>]*content="([^"]*)"/) || [])[1]
    || null

  const cart = cartInfo(tile)
  const priceText = cart?.discountPrice || (tile.match(/class="price"[^>]*>\s*<bdi>([^<]+)</) || [])[1] || null

  // Numeric and glyph-free, so no currency parsing is needed to get the number.
  const price = num(attr(tile, 'data-ga-discount-price')) ?? num(priceText)
  const listPrice = num(cart?.listPrice)
  const discountPct = num(cart?.discountPercentage)

  const ratingTitle = (tile.match(/class="stars[^"]*"[^>]*title="([^"]+)"/) || [])[1] || null
  const { rating, review_count } = parseRatingTitle(ratingTitle)

  // "4,000+ sold in 30 days" — present on ~2 in 3 tiles. Absence means the
  // product is below whatever floor iHerb shows it at, NOT that it sold nothing.
  const soldRaw = (tile.match(/recent-activity-message-wrapper"[^>]*>\s*([^<]*sold[^<]*)</i) || [])[1]
    || (tile.match(/([\d,]+\+?\s*sold\s*in\s*30\s*days)/i) || [])[1]
    || null
  const sold = soldRaw ? parseSoldLabel(soldRaw.trim()) : null

  // Two sources agree in the fixture; prefer the GA one and fall back.
  const outOfStock = bool(attr(tile, 'data-ga-is-out-of-stock'))
    ?? bool(attr(tile, 'data-is-out-of-stock'))

  return {
    product_id: productId ? String(productId) : null,
    part_number: partNumber,
    name: name ? decodeEntities(name) : null,
    brand_name: attr(tile, 'data-ga-brand-name'),
    brand_id: attr(tile, 'data-ga-brand-id'),
    url,
    price,
    list_price: listPrice,
    discount_pct: discountPct,
    currency: currencyFromPriceText(priceText),
    rating,
    review_count,
    // Never flattened into a bare number: the period is the whole point.
    sold_label: sold?.label ?? null,
    sold_lower_bound: sold?.lower_bound ?? null,
    sold_is_bucket: sold?.is_bucket ?? null,
    sold_period: sold?.period ?? null,
    in_stock: outOfStock == null ? null : !outOfStock,
    is_discontinued: bool(attr(tile, 'data-ga-is-discontinued')),
    // Sponsored rows are paid placement — they must not be read as organic rank.
    is_sponsored: bool(attr(tile, 'data-sponsored')) ?? false,
    position: num(attr(tile, 'data-ga-product-position')),
  }
}

/**
 * Page-level breadcrumb from the ld+json BreadcrumbList.
 *
 * Note this is brand *navigation* ("Brands A-Z → Anua"), not a product category
 * taxonomy. iHerb does not publish per-product categories on the catalogue page,
 * so treating this as the equivalent of Shopee's MH-4 platform breadcrumb would
 * be wrong — that would need a PDP visit each, at the same cost MH-4 pays.
 */
export function parseBreadcrumb(html) {
  const blocks = [...String(html).matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )]
  for (const b of blocks) {
    let parsed
    try {
      parsed = JSON.parse(b[1].trim())
    } catch {
      continue
    }
    if (!/BreadcrumbList/i.test(String(parsed?.['@type'] || ''))) continue
    const items = (parsed.itemListElement || [])
      .map((el) => el?.item?.name)
      .filter(Boolean)
    if (items.length) return { path: items, path_text: items.join(' > '), scope: 'brand_navigation' }
  }
  return null
}

export function parsePagination(html) {
  const next = String(html).match(/<link[^>]*rel="next"[^>]*href="([^"]+)"/i)
    || String(html).match(/<a[^>]*rel="next"[^>]*href="([^"]+)"/i)
  const pageNums = [...String(html).matchAll(/[?&]p=(\d+)/g)].map((m) => Number(m[1]))
  return {
    next_url: next ? decodeEntities(next[1]) : null,
    max_page_seen: pageNums.length ? Math.max(...pageNums) : 1,
  }
}

/**
 * @param {string} html full page source
 * @param {{ url?: string, captured_at?: string }} [meta]
 */
export function parseIherbCatalogue(html, meta = {}) {
  const src = String(html || '')
  const parts = src.split(TILE_SPLIT).slice(1)

  const products = []
  for (const part of parts) {
    const tile = parseTile(part)
    if (tile) products.push(tile)
  }

  const withSold = products.filter((p) => p.sold_lower_bound != null)
  const currencies = [...new Set(products.map((p) => p.currency).filter(Boolean))]

  return {
    url: meta.url || null,
    captured_at: meta.captured_at || null,
    breadcrumb: parseBreadcrumb(src),
    pagination: parsePagination(src),
    products,
    coverage: {
      products: products.length,
      // Stated rather than inferred, so a reader cannot mistake a partial signal
      // for a complete one — the same contract the Shopee read path settled on.
      with_sold: withSold.length,
      with_rating: products.filter((p) => p.rating != null).length,
      with_price: products.filter((p) => p.price != null).length,
      out_of_stock: products.filter((p) => p.in_stock === false).length,
      sponsored: products.filter((p) => p.is_sponsored).length,
      sold_period: withSold.length ? (withSold[0].sold_period || null) : null,
      currencies,
      // A page mixing currencies means the session flipped locale mid-scroll.
      currency_consistent: currencies.length <= 1,
    },
  }
}
