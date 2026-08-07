/**
 * iHerb structure probe — what to look for, and how to read the answer.
 *
 * This is deliberately not an extractor. iHerb 403s every non-browser request,
 * so the markup cannot be inspected without the warm profile, and any selector
 * written before that is a guess. Guesses in an extractor fail *silently*: an
 * empty grid reads as "this brand delisted everything", not "the selector moved".
 *
 * So the first pass reports what exists and extracts nothing. Absence is a
 * result: "sold per month: not found" is worth knowing before a comparison is
 * designed around a field iHerb may simply not publish.
 *
 * Pure on purpose — the in-page half feeds raw observations in, and everything
 * here is unit-testable with no browser.
 *
 * @see docs/IHERB_COLLECT_DESIGN.md
 * @see extensions/skums-iherb-probe/content.js
 */

/**
 * Fields the probe hunts for, with why each matters. `jsonldKeys` are checked
 * against a schema.org Product object; `selectors` and `textPatterns` are tried
 * against a product tile only if no structured payload is present.
 *
 * Confidence tiers: a structured payload beats an attribute, which beats a
 * selector, which beats a text regex. The verdict below uses that ordering.
 */
export const IHERB_PROBE_FIELDS = [
  {
    key: 'name',
    label: 'Product name',
    why: 'Join key for brand-level comparison and the only human-readable label.',
    jsonldKeys: ['name'],
    selectors: ['[data-testid*="product-title"]', '.product-title', 'a[href*="/pr/"]'],
    textPatterns: [],
  },
  {
    key: 'brand',
    label: 'Brand name',
    why: 'Confirms the catalogue really is one brand — cheap guard against a mixed page.',
    jsonldKeys: ['brand', 'brand.name'],
    selectors: ['[data-testid*="brand"]', '[itemprop="brand"]'],
    textPatterns: [],
  },
  {
    key: 'price',
    label: 'Current price',
    why: 'iHerb is first-party, so its price is authoritative in a way a Shopee seller price is not.',
    jsonldKeys: ['offers.price', 'offers.0.price'],
    selectors: ['[data-testid*="price"]', '.product-price', 'bdi'],
    textPatterns: ['\\$\\s?\\d'],
  },
  {
    key: 'list_price',
    label: 'List / was price',
    why: 'Discount depth. Without it a promo price looks like the real one.',
    jsonldKeys: ['offers.priceSpecification.price'],
    selectors: ['[class*="list-price"]', 's', 'del'],
    textPatterns: [],
  },
  {
    key: 'currency',
    label: 'Currency',
    why: 'A run that silently collects USD into an SGD column is worse than one that fails.',
    jsonldKeys: ['offers.priceCurrency', 'offers.0.priceCurrency'],
    selectors: ['[data-testid*="currency"]'],
    textPatterns: ['SGD', 'S\\$', 'USD'],
  },
  {
    key: 'rating',
    label: 'Rating value',
    why: 'iHerb has no sold count; rating and reviews are the only demand proxy it offers.',
    jsonldKeys: ['aggregateRating.ratingValue'],
    selectors: ['[itemprop="ratingValue"]', '[data-testid*="rating"]', '[class*="stars"]'],
    textPatterns: [],
  },
  {
    key: 'review_count',
    label: 'Review count',
    why: 'The closest thing to a volume signal on this channel. Not comparable to Shopee sold.',
    jsonldKeys: ['aggregateRating.reviewCount', 'aggregateRating.ratingCount'],
    selectors: ['[itemprop="reviewCount"]', '[data-testid*="review"]', '[class*="review-count"]'],
    textPatterns: ['\\d[\\d,]*\\s*(reviews?|ratings?)'],
  },
  {
    key: 'sold_per_month',
    label: 'Sold / recently bought',
    why:
      'Asked for explicitly. iHerb may not publish it at all — if absent, brand comparison '
      + 'has no volume axis on this side and must say so rather than imply one.',
    jsonldKeys: [],
    selectors: ['[data-testid*="sold"]', '[class*="sold"]', '[class*="bought"]'],
    textPatterns: [
      '\\d[\\d,]*\\+?\\s*(sold|bought)',
      'bought\\s+in\\s+past\\s+month',
      'sold\\s*/\\s*month',
    ],
  },
  {
    key: 'category_breadcrumb',
    label: 'Category breadcrumb',
    why:
      'The platform taxonomy, equivalent to Shopee MH-4 platform_category_path_text. '
      + 'Never map it 1:1 to a shop shelf — they are different taxonomies.',
    jsonldKeys: ['itemListElement'],
    selectors: [
      'nav[aria-label*="readcrumb"]',
      '[data-testid*="breadcrumb"]',
      '.breadcrumb',
      'ol[itemtype*="BreadcrumbList"]',
    ],
    textPatterns: [],
  },
  {
    key: 'product_code',
    label: 'Product code / part number',
    why: 'Stable identity. The only field here that could ever support a SKU-level join.',
    jsonldKeys: ['sku', 'mpn', 'productID'],
    selectors: ['[data-part-number]', '[data-product-id]', '[itemprop="sku"]'],
    textPatterns: ['\\bIHB-?\\d+', '#\\d{4,}'],
  },
  {
    key: 'pack_size',
    label: 'Pack size / format',
    why: 'Normalises price comparison. 30ml vs 150ml is most of a price gap.',
    jsonldKeys: ['size', 'weight'],
    selectors: ['[data-testid*="size"]', '[class*="pack-size"]'],
    textPatterns: ['\\d+(\\.\\d+)?\\s?(ml|g|oz|fl\\.?\\s?oz|count|ct)\\b'],
  },
  {
    key: 'in_stock',
    label: 'Stock state',
    why: 'Out-of-stock rows must not be read as delisted, or coverage gaps look worse than they are.',
    jsonldKeys: ['offers.availability', 'offers.0.availability'],
    selectors: ['[class*="out-of-stock"]', '[class*="stock"]', '[data-testid*="stock"]'],
    textPatterns: ['out of stock', 'in stock', 'back in stock'],
  },
  {
    key: 'product_url',
    label: 'Product URL',
    why: 'Per-row deep link, and the fallback source for a product code.',
    jsonldKeys: ['url', 'offers.url'],
    selectors: ['a[href*="/pr/"]'],
    textPatterns: [],
  },
]

/** Ordered best → worst. A payload survives redesigns that break selectors. */
export const EVIDENCE_RANK = ['jsonld', 'attribute', 'selector', 'text', 'none']

export function rankEvidence(via) {
  const i = EVIDENCE_RANK.indexOf(String(via || 'none'))
  return i < 0 ? EVIDENCE_RANK.length - 1 : i
}

/**
 * Fold raw in-page observations into a readable report.
 *
 * @param {{
 *   url?: string,
 *   captured_at?: string,
 *   structured_payloads?: Array<{ type: string, count: number }>,
 *   tile_candidates?: Array<{ selector: string, count: number }>,
 *   pagination?: { kind?: string, pages?: number|null, next_href?: string|null },
 *   currency_text?: string|null,
 *   fields?: Record<string, { found?: boolean, via?: string, sample?: unknown }>,
 *   html_bytes?: number,
 * }} raw
 */
export function summarizeProbe(raw = {}) {
  const payloads = Array.isArray(raw.structured_payloads) ? raw.structured_payloads : []

  // Order matters more than count. The real Anua capture had
  // .product-cell-container × 48 (the grid) and .product-inner × 88 — the latter
  // matches a wrapper inside each tile *plus* a second carousel elsewhere on the
  // page. Taking the busiest would have split 48 products into 88 fragments and
  // silently doubled every aggregate. IHERB_TILE_CANDIDATES is ordered
  // specific → generic, so the first candidate that repeats is the grid.
  const present = (Array.isArray(raw.tile_candidates) ? raw.tile_candidates : [])
    .filter((t) => t && t.count > 0)
  const repeating = present.filter((t) => t.count > 1)
  const tiles = repeating.length
    ? [repeating[0], ...repeating.slice(1)]
    : [...present].sort((a, b) => b.count - a.count)

  const fieldsRaw = raw.fields && typeof raw.fields === 'object' ? raw.fields : {}
  const fields = IHERB_PROBE_FIELDS.map((spec) => {
    const obs = fieldsRaw[spec.key] || {}
    const found = Boolean(obs.found)
    return {
      key: spec.key,
      label: spec.label,
      why: spec.why,
      found,
      via: found ? String(obs.via || 'selector') : 'none',
      sample: found ? obs.sample ?? null : null,
    }
  })

  const missing = fields.filter((f) => !f.found).map((f) => f.key)
  const bestPayload = payloads.find((p) => p.count > 0) || null

  return {
    url: raw.url || null,
    captured_at: raw.captured_at || null,
    html_bytes: raw.html_bytes ?? null,
    structured_payload: bestPayload,
    structured_payloads: payloads,
    tile_selector: tiles[0]?.selector || null,
    tile_count: tiles[0]?.count ?? 0,
    tile_candidates: tiles,
    pagination: raw.pagination || { kind: 'unknown', pages: null, next_href: null },
    currency: normaliseCurrency(raw.currency_text),
    fields,
    missing,
    verdict: probeVerdict({ structured_payload: bestPayload, tiles, fields }),
  }
}

function normaliseCurrency(text) {
  const s = String(text || '').toUpperCase()
  if (/\bSGD\b|S\$/.test(s)) return 'SGD'
  if (/\bUSD\b/.test(s)) return 'USD'
  if (/\bMYR\b|RM/.test(s)) return 'MYR'
  return null
}

/**
 * What extraction approach the evidence supports.
 *
 * Prefers a structured payload outright: it is one parse, it carries types, and
 * it survives visual redesigns. DOM selectors are the fallback, and only when a
 * tile actually repeats — a selector matching once is a page chrome element, not
 * a product grid.
 */
export function probeVerdict({ structured_payload, tiles, fields }) {
  const found = (fields || []).filter((f) => f.found)
  const viaJsonld = found.filter((f) => f.via === 'jsonld').length

  if (structured_payload && structured_payload.count > 1 && viaJsonld >= 3) {
    return {
      approach: 'structured_payload',
      confidence: 'high',
      reason:
        `${structured_payload.type} carries ${structured_payload.count} products and ${viaJsonld} of the `
        + 'probed fields. Parse that, not the DOM — it survives redesigns that break selectors.',
    }
  }

  const tile = (tiles || [])[0]
  if (tile && tile.count > 1 && found.length >= 4) {
    return {
      approach: 'dom_selectors',
      confidence: found.length >= 8 ? 'medium' : 'low',
      reason:
        `No usable structured payload. "${tile.selector}" repeats ${tile.count}× and ${found.length} `
        + 'fields resolve from the DOM. Workable, but pin it with a checked-in fixture — selectors move silently.',
    }
  }

  return {
    approach: 'insufficient',
    confidence: 'none',
    reason:
      'Neither a repeating product tile nor a structured payload was found. Likely a bot wall, a '
      + 'lazy-rendered grid that had not populated, or the wrong page — re-probe after scrolling, '
      + 'and check the capture is not an "Access Denied" body.',
  }
}

/**
 * Compare two reports. Re-probing before each cycle is one page load, and this
 * is what makes it worth doing: a vanished field or a tile count collapsing to
 * zero is the early warning that a redesign happened.
 */
export function diffProbes(before, after) {
  const b = before || {}
  const a = after || {}
  const byKey = (r) => new Map((r.fields || []).map((f) => [f.key, f]))
  const bf = byKey(b)
  const af = byKey(a)

  const lost = []
  const gained = []
  for (const [key, f] of af) {
    const prev = bf.get(key)
    if (f.found && prev && !prev.found) gained.push(key)
    if (!f.found && prev && prev.found) lost.push(key)
  }

  return {
    tile_selector_changed: (b.tile_selector || null) !== (a.tile_selector || null),
    tile_count_before: b.tile_count ?? null,
    tile_count_after: a.tile_count ?? null,
    tile_count_collapsed: Boolean(b.tile_count) && !a.tile_count,
    approach_changed: (b.verdict?.approach || null) !== (a.verdict?.approach || null),
    fields_lost: lost,
    fields_gained: gained,
    // Anything here means look before harvesting.
    regressed: lost.length > 0
      || (Boolean(b.tile_count) && !a.tile_count)
      || (b.verdict?.approach === 'structured_payload' && a.verdict?.approach !== 'structured_payload'),
  }
}
