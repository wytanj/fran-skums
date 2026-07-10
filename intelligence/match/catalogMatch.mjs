/**
 * Rule-based catalog match candidates (pre-Grok / offline).
 * Scores Fran products against a study query + marketplace listing titles.
 */

/**
 * @param {string} a
 * @param {string} b
 */
export function tokenSet(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  )
}

/**
 * Jaccard-ish token overlap 0..1
 * @param {Set<string>} a
 * @param {Set<string>} b
 */
export function tokenOverlap(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

/**
 * @param {{
 *   query?: string | null
 *   listing_titles?: string[]
 *   products: Array<{ id: string, title: string, brand_name?: string | null, sku?: string | null, retail_price?: number | null }>
 *   limit?: number
 * }} input
 */
export function matchCatalogCandidates(input) {
  const queryTokens = tokenSet([input.query, ...(input.listing_titles || []).slice(0, 5)].join(' '))
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 25)
  const products = Array.isArray(input.products) ? input.products : []

  const scored = []
  for (const p of products) {
    const titleTokens = tokenSet(`${p.title || ''} ${p.brand_name || ''} ${p.sku || ''}`)
    const score = tokenOverlap(queryTokens, titleTokens)
    if (score < 0.12) continue

    /** @type {string} */
    let match_type = 'title_similarity'
    if (p.sku && input.query && String(input.query).toLowerCase().includes(String(p.sku).toLowerCase())) {
      match_type = 'sku_in_query'
    } else if (p.brand_name && tokenSet(p.brand_name).size) {
      const brandOverlap = tokenOverlap(tokenSet(p.brand_name), queryTokens)
      if (brandOverlap >= 0.5) match_type = 'brand_title'
    }

    scored.push({
      product_id: p.id,
      title: p.title,
      brand_name: p.brand_name || null,
      sku: p.sku || null,
      retail_price: p.retail_price ?? null,
      match_type,
      confidence: Math.round(score * 1000) / 1000,
      evidence: {
        query: input.query || null,
        sample_listing_titles: (input.listing_titles || []).slice(0, 3),
      },
    })
  }

  scored.sort((a, b) => b.confidence - a.confidence)
  return scored.slice(0, limit)
}
