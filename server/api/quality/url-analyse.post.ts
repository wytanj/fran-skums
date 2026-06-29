import { serverSupabaseUser } from '#supabase/server'
import { computeSkincareScores } from '../../utils/skincare-scoring'

// ── Platform detection ────────────────────────────────────────

interface PlatformConfig {
  key: string
  label: string
  region: string
  color: string
  extractionHints: string
}

function detectPlatform(url: string): PlatformConfig | null {
  const u = url.toLowerCase()
  if (u.includes('hwahae.com'))           return { key: 'hwahae',       label: 'Hwahae',        region: 'KR', color: 'pink',   extractionHints: 'Korean beauty review platform. Extract: product name, brand, overall rating, review count, skin type ratings (dry/combo/oily/sensitive), ingredient list, product concerns/benefits, price (KRW), rank in category.' }
  if (u.includes('oliveyoung.com'))       return { key: 'oliveyoung',   label: 'Olive Young',   region: 'KR', color: 'green',  extractionHints: 'Korean beauty retailer. Extract: product name, brand, price (KRW/USD), rating, review count, discount %, best-seller rank, ingredient list, product claims, skin concerns.' }
  if (u.includes('sephora.sg') || u.includes('sephora.com.sg'))
                                          return { key: 'sephora_sg',   label: 'Sephora SG',    region: 'SG', color: 'black',  extractionHints: 'Sephora Singapore. Extract: product name, brand, price (SGD), rating, review count, ingredients, "loves" count, Sephora Collection vs brand product, shade options, new/bestseller badge.' }
  if (u.includes('sephora.com') && !u.includes('.sg'))
                                          return { key: 'sephora_us',   label: 'Sephora US',    region: 'US', color: 'black',  extractionHints: 'Sephora US. Extract: product name, brand, price (USD), rating, review count, loves count, new/bestseller badge, ingredients.' }
  if (u.includes('shopee.sg') || u.includes('shopee.com/sg'))
                                          return { key: 'shopee_sg',    label: 'Shopee SG',     region: 'SG', color: 'orange', extractionHints: 'Shopee Singapore listing. Extract: product title, price (SGD), seller name, rating, review count, units sold label, stock availability, shipping info.' }
  if (u.includes('shopee.com'))           return { key: 'shopee',       label: 'Shopee',        region: 'SEA', color: 'orange', extractionHints: 'Shopee listing. Extract: product title, price, seller, rating, review count, units sold, stock.' }
  if (u.includes('lazada.sg'))            return { key: 'lazada_sg',    label: 'Lazada SG',     region: 'SG', color: 'blue',   extractionHints: 'Lazada Singapore. Extract: product title, price (SGD), seller, rating, review count, units sold, flash sale price if any, official store badge.' }
  if (u.includes('lazada.com'))           return { key: 'lazada',       label: 'Lazada',        region: 'SEA', color: 'blue',  extractionHints: 'Lazada listing. Extract: product title, price, seller, rating, review count, units sold, stock status.' }
  if (u.includes('amazon.sg') || (u.includes('amazon.com') && u.includes('/dp/')))
                                          return { key: 'amazon',       label: 'Amazon',        region: 'GLOBAL', color: 'yellow', extractionHints: 'Amazon listing. Extract: product title, brand, price, rating, review count, BSR rank, Prime availability, listing quality (A+ content, bullet count).' }
  if (u.includes('iherb.com'))            return { key: 'iherb',        label: 'iHerb',         region: 'GLOBAL', color: 'green',  extractionHints: 'iHerb supplement/beauty product. IMPORTANT iHerb-specific fields to extract: (1) product name + brand, (2) price USD, (3) rating + review count, (4) "X sold in 30 days" velocity label — this is a KEY metric, (5) Package Quantity / volume size (e.g. "1.01 fl oz (30 ml)"), (6) UPC barcode from product specs table, (7) FULL ingredient list — iHerb has TWO sections: "Ingredients" (actives) AND "Other Ingredients" (INCI list) — extract BOTH and merge them, (8) certifications/badges (Top Rated, Best Seller, iHerb Brands, Cruelty Free, Vegan, etc.), (9) product category/subcategory.' }
  return null
}

// ── Fetch page HTML (server-side, with stealth headers) ───────

async function fetchPageHtml(url: string): Promise<{ html: string; status: number; error?: string }> {
  // First try: Node fetch
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      },
    })
    clearTimeout(timeout)

    const html = await res.text()

    // If we got a good response with actual content, use it
    if (res.status >= 200 && res.status < 400 && html.length > 5000) {
      return { html, status: res.status }
    }

    // fetch got blocked (403, anti-bot, etc.) — fall back to curl
    return await fetchWithCurl(url)
  } catch (err: any) {
    if (err.name === 'AbortError') {
      // Timeout on fetch — try curl
      return await fetchWithCurl(url)
    }
    return await fetchWithCurl(url)
  }
}

// Fallback: curl has a different TLS fingerprint and bypasses many anti-bot checks
async function fetchWithCurl(url: string): Promise<{ html: string; status: number; error?: string }> {
  try {
    const { execSync } = await import('child_process')
    const safeUrl = url.replace(/"/g, '\\"')
    const html = execSync(
      `curl -s -L --max-time 15 -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" "${safeUrl}"`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 20000 }
    ).toString()

    if (html.length > 2000) {
      return { html, status: 200 }
    }
    return { html, status: 0, error: 'curl returned insufficient content' }
  } catch (err: any) {
    return { html: '', status: 0, error: `curl fallback failed: ${err.message?.slice(0, 100) ?? 'unknown'}` }
  }
}

// ── Extract JSON-LD structured data ──────────────────────────

interface JsonLdProduct {
  name?: string
  brand?: { name?: string } | string
  aggregateRating?: { ratingValue?: number; reviewCount?: number }
  offers?: { price?: number | string; priceCurrency?: string; availability?: string } | Array<{ price?: number | string; priceCurrency?: string }>
  sku?: string
  mpn?: string
  gtin13?: string
  gtin12?: string
  description?: string
  [key: string]: any
}

function extractJsonLd(html: string): { blocks: string[]; product: JsonLdProduct | null } {
  const blocks: string[] = []
  let product: JsonLdProduct | null = null

  const matches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)
  for (const m of matches) {
    const raw = m[1].trim()
    blocks.push(raw)
    try {
      const parsed = JSON.parse(raw)
      // Find Product type (could be nested in @graph)
      if (parsed['@type'] === 'Product') {
        product = parsed
      } else if (Array.isArray(parsed['@graph'])) {
        const p = parsed['@graph'].find((item: any) => item['@type'] === 'Product')
        if (p) product = p
      }
    } catch { /* ignore parse errors */ }
  }

  return { blocks, product }
}

// ── Extract meaningful text from HTML ────────────────────────

function extractTextContent(html: string): string {
  // Remove heavy non-content blocks first
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')

  // Strip HTML tags
  text = text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x2B;/g, '+').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return text
}

function buildContextForAI(html: string, jsonLdBlocks: string[], jsonLdProduct: JsonLdProduct | null): string {
  const parts: string[] = []

  // JSON-LD first — most structured and reliable
  if (jsonLdBlocks.length) {
    parts.push(`[STRUCTURED DATA (JSON-LD)]\n${jsonLdBlocks.join('\n')}`)
  }

  // Pre-extracted product data summary from JSON-LD
  if (jsonLdProduct) {
    const summary: string[] = ['[PRE-EXTRACTED FROM JSON-LD]']
    if (jsonLdProduct.name) summary.push(`Name: ${jsonLdProduct.name}`)
    const brand = typeof jsonLdProduct.brand === 'string' ? jsonLdProduct.brand : jsonLdProduct.brand?.name
    if (brand) summary.push(`Brand: ${brand}`)
    if (jsonLdProduct.aggregateRating) {
      summary.push(`Rating: ${jsonLdProduct.aggregateRating.ratingValue}`)
      summary.push(`Review count: ${jsonLdProduct.aggregateRating.reviewCount}`)
    }
    if (jsonLdProduct.offers) {
      const offer = Array.isArray(jsonLdProduct.offers) ? jsonLdProduct.offers[0] : jsonLdProduct.offers
      if (offer?.price) summary.push(`Price: ${offer.price} ${offer.priceCurrency ?? ''}`)
    }
    if (jsonLdProduct.gtin13) summary.push(`GTIN13/EAN: ${jsonLdProduct.gtin13}`)
    if (jsonLdProduct.gtin12) summary.push(`UPC: ${jsonLdProduct.gtin12}`)
    if (jsonLdProduct.mpn) summary.push(`MPN: ${jsonLdProduct.mpn}`)
    parts.push(summary.join('\n'))
  }

  // Page text — truncated intelligently
  const pageText = extractTextContent(html)
  // Give 14k to page text if we have JSON-LD, otherwise 18k
  const textBudget = jsonLdBlocks.length ? 14000 : 18000
  parts.push(`[PAGE TEXT]\n${pageText.slice(0, textBudget)}`)

  return parts.join('\n\n')
}

// ── Server-side scoring ─────────────────────────────────────

function computeRatingScore(rating: number | null, reviewCount: number | null): number {
  if (!rating || rating <= 0) return 0
  // Rating component (0-60): 4.5+ is excellent
  const ratingPart = Math.min(60, Math.round((rating / 5) * 60))
  // Volume component (0-40): logarithmic scale — 10k+ reviews = max
  const count = reviewCount ?? 0
  const volumePart = count <= 0 ? 0 : Math.min(40, Math.round((Math.log10(count + 1) / 4) * 40))
  return Math.min(100, ratingPart + volumePart)
}

function computePopularityScore(reviewCount: number | null, unitsSold: string | null, rank: number | null, soldIn30Days: number | null): number {
  let score = 0
  // Review volume (0-35)
  const count = reviewCount ?? 0
  if (count > 0) score += Math.min(35, Math.round((Math.log10(count + 1) / 4.5) * 35))
  // 30-day sales velocity — strongest demand signal (0-35)
  if (soldIn30Days && soldIn30Days > 0) {
    if (soldIn30Days >= 10000) score += 35
    else if (soldIn30Days >= 3000) score += 30
    else if (soldIn30Days >= 1000) score += 25
    else if (soldIn30Days >= 500) score += 18
    else if (soldIn30Days >= 100) score += 12
    else score += 5
  } else if (unitsSold) {
    // Fallback: parse generic "units sold" label (0-25)
    const num = parseInt(unitsSold.replace(/[^0-9]/g, ''), 10)
    if (num > 10000) score += 25
    else if (num > 1000) score += 18
    else if (num > 100) score += 10
    else if (num > 0) score += 5
  }
  // Rank signal (0-30)
  if (rank && rank > 0) {
    if (rank <= 5) score += 30
    else if (rank <= 20) score += 20
    else if (rank <= 50) score += 10
    else score += 5
  }
  return Math.min(100, score)
}

function computeValueScore(priceSgd: number | null, volumeSize: string | null, rating: number | null): number {
  if (!priceSgd || priceSgd <= 0) return 0
  // Heuristic: skincare value based on price per ml and quality
  let mlAmount = 0
  if (volumeSize) {
    const mlMatch = volumeSize.match(/([\d.]+)\s*ml/i)
    const ozMatch = volumeSize.match(/([\d.]+)\s*(?:fl\.?\s*)?oz/i)
    if (mlMatch) mlAmount = parseFloat(mlMatch[1])
    else if (ozMatch) mlAmount = parseFloat(ozMatch[1]) * 29.5735
  }

  let score = 50 // baseline
  if (mlAmount > 0) {
    const pricePerMl = priceSgd / mlAmount
    // Under $0.50/ml = excellent value, over $3/ml = premium
    if (pricePerMl < 0.3) score += 30
    else if (pricePerMl < 0.5) score += 20
    else if (pricePerMl < 1.0) score += 10
    else if (pricePerMl < 2.0) score += 0
    else if (pricePerMl < 3.0) score -= 10
    else score -= 20
  }
  // Rating quality bonus
  if (rating && rating >= 4.5) score += 15
  else if (rating && rating >= 4.0) score += 10
  else if (rating && rating >= 3.5) score += 5

  return Math.max(0, Math.min(100, score))
}

// ── Main handler ──────────────────────────────────────────────

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const config = useRuntimeConfig()
  const xaiApiKey = config.xaiApiKey
  if (!xaiApiKey) throw createError({ statusCode: 500, statusMessage: 'xAI API key not configured' })

  const { url } = await readBody(event)
  if (!url?.trim()) throw createError({ statusCode: 400, statusMessage: 'url is required' })

  const platform = detectPlatform(url)
  if (!platform) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Unsupported platform. Supported: Hwahae, Olive Young, Sephora SG, Shopee, Lazada, Amazon, iHerb',
    })
  }

  // Attempt to fetch page HTML
  const { html, status, error: fetchError } = await fetchPageHtml(url)
  const hasMeaningfulHtml = html.length > 2000 && status >= 200 && status < 400

  // Extract JSON-LD structured data (most reliable source)
  const { blocks: jsonLdBlocks, product: jsonLdProduct } = hasMeaningfulHtml
    ? extractJsonLd(html)
    : { blocks: [], product: null }

  const pageContext = hasMeaningfulHtml
    ? `FETCHED PAGE CONTENT (HTTP ${status}):\n${buildContextForAI(html, jsonLdBlocks, jsonLdProduct)}`
    : `PAGE FETCH FAILED: ${fetchError ?? `HTTP ${status}`}. The page could not be fetched (anti-bot protection).

IMPORTANT: You MUST still extract product data using your training knowledge of this product and platform. The URL contains enough information to identify the product. Do NOT return null or 0 for fields you know — use your knowledge of this specific product from ${platform.label}.
For example, if you know this product's rating, price, review count, ingredients — return those real values. Only return null for fields you genuinely cannot determine.
This is critical: returning 0 for rating or review_count when you know the real values is WRONG.`

  // ── xAI extraction prompt — raw data only, no scoring ─────
  const prompt = `You are a product data extraction specialist for skincare/beauty products.
Extract ALL available product data from this page. Do NOT score or analyse — just extract raw facts.

PLATFORM: ${platform.label} (${platform.region})
URL: ${url}
PLATFORM NOTES: ${platform.extractionHints}

${pageContext}

TASK:
1. Extract every piece of product data you can find from the page content.
2. For ingredients: extract the FULL INCI ingredient list if available. This is critical — look for the complete ingredients list, not just marketing highlights. INCI lists are typically comma-separated and start with "Water" or "Aqua".
3. For price: if not SGD, include original currency AND estimated SGD conversion (KRW 1000 ≈ SGD 1.00, USD 1 ≈ SGD 1.35).
4. For notable_ingredients: list the KEY ACTIVE ingredients featured in the product (the ones marketed as hero ingredients).
5. Provide a brief 2-3 sentence market assessment and list of strengths/weaknesses.

OUTPUT ONLY this exact JSON (no markdown, no prose):
{
  "product": {
    "name": "full product name",
    "brand": "brand name",
    "platform": "${platform.key}",
    "platform_label": "${platform.label}",
    "url": "${url}",
    "price_original": null,
    "price_original_currency": null,
    "price_sgd": null,
    "rating": null,
    "review_count": null,
    "units_sold_label": null,
    "availability": "in_stock",
    "volume_size": null,
    "key_claims": [],
    "skin_types": [],
    "concerns": [],
    "ingredients_full": [],
    "notable_ingredients": [],
    "awards_badges": [],
    "rank_in_category": null,
    "certifications": [],
    "upc": null,
    "package_quantity": null,
    "sold_in_30_days": null,
    "category": null,
    "additional_metrics": {}
  },
  "scope": {
    "data_quality": "high",
    "data_extracted_from": "page_html",
    "fields_found": [],
    "fields_missing": [],
    "confidence": "high"
  },
  "ai_commentary": {
    "market_context": "2-3 sentences about this product's standing",
    "sg_market_fit": "2 sentences on SG tropical climate fit",
    "strengths": [],
    "weaknesses": [],
    "recommendations": []
  }
}

CRITICAL RULES:
- ingredients_full: Array of individual INCI ingredient names. Parse the comma-separated list into individual items. If the page shows a full INCI list, include ALL of them. For iHerb: merge BOTH the "Ingredients" section AND "Other Ingredients" section into this single array. This is the most important field.
- notable_ingredients: Only the 3-8 KEY actives (hero ingredients).
- data_quality: "high" if real data from page, "medium" if partial, "low" if estimated from knowledge only.
- price_sgd MUST be a number (not null) if any price is found — convert to SGD.
- rating MUST be a number (not null) if any rating is found.
- review_count MUST be a number (not null) if any review count is found.
- upc: The UPC/barcode number if found in product specs/details table. String or null.
- package_quantity: The volume/weight with units, e.g. "1.01 fl oz (30 ml)" or "50 ml". String or null.
- sold_in_30_days: Number extracted from "X,XXX+ sold in 30 days" or similar velocity labels. Parse to integer. e.g. "3,000+ sold in 30 days" → 3000. Null if not found.
- category: Product category/subcategory path if available, e.g. "Beauty > Serums > Hyaluronic Acid". String or null.
- Do NOT invent data. If a field is not found, use null or empty array.`

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${xaiApiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-3',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 3000,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw createError({ statusCode: 502, statusMessage: `xAI API error: ${text}` })
  }

  const json: any = await response.json()
  const raw = json.choices?.[0]?.message?.content ?? '{}'

  let parsed: any = {}
  try {
    parsed = JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      try { parsed = JSON.parse(match[0]) } catch { /* leave empty */ }
    }
  }

  const product = parsed.product ?? {}
  const scope = parsed.scope ?? {}
  const aiCommentary = parsed.ai_commentary ?? {}

  // ── JSON-LD always wins (machine-readable > AI extraction) ──
  if (jsonLdProduct) {
    // Rating & reviews — JSON-LD is authoritative
    if (jsonLdProduct.aggregateRating?.ratingValue) {
      product.rating = Number(jsonLdProduct.aggregateRating.ratingValue)
    }
    if (jsonLdProduct.aggregateRating?.reviewCount) {
      product.review_count = Number(jsonLdProduct.aggregateRating.reviewCount)
    }
    // Name & brand
    if (jsonLdProduct.name) product.name = jsonLdProduct.name
    const brand = typeof jsonLdProduct.brand === 'string' ? jsonLdProduct.brand : jsonLdProduct.brand?.name
    if (brand) product.brand = brand
    // Price from JSON-LD offers
    if (jsonLdProduct.offers) {
      const offer = Array.isArray(jsonLdProduct.offers) ? jsonLdProduct.offers[0] : jsonLdProduct.offers
      if (offer?.price) {
        product.price_original = Number(offer.price)
        product.price_original_currency = offer.priceCurrency ?? 'USD'
      }
    }
    // UPC/EAN
    if (jsonLdProduct.gtin12) product.upc = jsonLdProduct.gtin12
    else if (jsonLdProduct.gtin13) product.upc = jsonLdProduct.gtin13
    // Description for volume extraction
    if (jsonLdProduct.name && !product.volume_size) {
      const volMatch = jsonLdProduct.name.match(/([\d.]+\s*(?:fl\s*oz|ml|g|oz)[^,)]*)/i)
      if (volMatch) product.volume_size = volMatch[1].trim()
    }
  }

  // Ensure numeric types (Grok may return strings)
  if (product.rating) product.rating = Number(product.rating) || null
  if (product.review_count) product.review_count = Number(product.review_count) || null
  if (product.price_original) product.price_original = Number(product.price_original) || null
  if (product.price_sgd) product.price_sgd = Number(product.price_sgd) || null
  if (product.sold_in_30_days) product.sold_in_30_days = Number(product.sold_in_30_days) || null

  // Extract "sold in 30 days" directly from raw HTML (most reliable for iHerb)
  if (hasMeaningfulHtml) {
    const salesMatch = html.match(/([\d,]+)\s*(?:&#x2B;|\+)?\s*sold in 30 days/i)
    if (salesMatch) {
      product.sold_in_30_days = parseInt(salesMatch[1].replace(/,/g, ''), 10)
    }
  }

  // Compute price_sgd from original if missing or zero
  if (product.price_original && (!product.price_sgd || product.price_sgd <= 0)) {
    const curr = (product.price_original_currency ?? 'USD').toUpperCase()
    const rates: Record<string, number> = { USD: 1.35, KRW: 0.001, SGD: 1, EUR: 1.45, GBP: 1.70, JPY: 0.009, AUD: 0.88 }
    product.price_sgd = Math.round(product.price_original * (rates[curr] ?? 1.35) * 100) / 100
  }

  // ── Server-side scoring using our methodology ────────────
  const ingredientsFull: string[] = product.ingredients_full ?? []
  const notableIngredients: string[] = product.notable_ingredients ?? []
  // Use full INCI list for scoring, fall back to notable ingredients
  const ingredientsForScoring = ingredientsFull.length > 0 ? ingredientsFull : notableIngredients

  // Compute skincare scores using our engine
  const skincareScores = await computeSkincareScores(ingredientsForScoring)

  // Compute marketplace-based scores (ensure numbers)
  const rating = Number(product.rating) || null
  const reviewCount = Number(product.review_count) || null
  const priceSgd = Number(product.price_sgd) || null
  const soldIn30d = Number(product.sold_in_30_days) || null

  const ratingScore = computeRatingScore(rating, reviewCount)
  const popularityScore = computePopularityScore(reviewCount, product.units_sold_label, product.rank_in_category, soldIn30d)
  const valueScore = computeValueScore(priceSgd, product.volume_size ?? product.package_quantity, rating)

  // IPS from our engine (already 0-100)
  const ipsScore = skincareScores.ips_score

  // Overall score: weighted combination aligned with methodology
  // IPS × 0.25 (ingredient quality matters most for skincare)
  // Rating × 0.25 (consumer validation)
  // Popularity × 0.25 (demand signal)
  // Value × 0.25 (margin potential / Alpha proxy)
  const overallScore = Math.round(
    ipsScore * 0.25 +
    ratingScore * 0.25 +
    popularityScore * 0.25 +
    valueScore * 0.25
  )

  // Determine lifecycle stage from review data
  let lifecycleStage = 'unknown'
  const rc = reviewCount ?? 0
  const rt = rating ?? 0
  if (rc < 200) lifecycleStage = 'launch'
  else if (rc >= 5000 && rt >= 4.3) lifecycleStage = 'hall_of_fame'
  else if (rc >= 200 && rt >= 4.0) lifecycleStage = 'mature'
  else if (rt < 3.5) lifecycleStage = 'declining'
  else lifecycleStage = 'rising'

  // Determine competitive position
  let competitivePosition = 'average'
  if (overallScore >= 80) competitivePosition = 'dominant'
  else if (overallScore >= 65) competitivePosition = 'competitive'
  else if (overallScore >= 45) competitivePosition = 'average'
  else competitivePosition = 'weak'

  return {
    platform,
    url,
    html_fetched: hasMeaningfulHtml,
    product: {
      ...product,
      // Keep ingredients_full separate from display
      ingredients_count: ingredientsFull.length || product.ingredients_count || null,
    },
    scope,
    // Methodology-aligned scoring
    analysis: {
      overall_score: overallScore,
      rating_score: ratingScore,
      popularity_score: popularityScore,
      value_score: valueScore,
      ingredient_score: ipsScore,
      competitive_position: competitivePosition,
      lifecycle_stage: lifecycleStage,
      // Skincare intelligence scores
      skincare: {
        ips_score: skincareScores.ips_score,
        skin_type_fit: skincareScores.skin_type_fit,
        concern_tags: skincareScores.concern_tags,
        top_tier_ingredient: skincareScores.top_tier_ingredient,
        ingredient_trend_signal: skincareScores.ingredient_trend_signal,
        conflict_flags: skincareScores.conflict_flags,
        ingredients_matched: ingredientsForScoring.length,
      },
      // AI-generated qualitative analysis
      market_context: aiCommentary.market_context ?? null,
      sg_market_fit: aiCommentary.sg_market_fit ?? null,
      strengths: aiCommentary.strengths ?? [],
      weaknesses: aiCommentary.weaknesses ?? [],
      recommendations: aiCommentary.recommendations ?? [],
    },
    analysed_at: new Date().toISOString(),
  }
})
