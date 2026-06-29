import { serverSupabaseUser } from '#supabase/server'

/**
 * Free-tier quality analysis endpoint.
 *
 * 1. Runs Grok-based AI estimation immediately (same as before)
 * 2. Queues the product for overnight real scraping
 * 3. Returns AI-estimated results right away
 *
 * When the overnight scraper runs, it replaces ai_estimated data with real scraped data.
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const config = useRuntimeConfig()
  const xaiApiKey = config.xaiApiKey
  if (!xaiApiKey) throw createError({ statusCode: 500, statusMessage: 'xAI API key not configured' })

  const body = await readBody(event)
  const {
    product_id,
    workspace_id,
    product_title,
    brand_name,
    category_name,
    ean,
    asin,
    retail_price,
    currency = 'SGD',
  } = body

  if (!product_id || !workspace_id) {
    throw createError({ statusCode: 400, statusMessage: 'product_id and workspace_id are required' })
  }
  if (!product_title) {
    throw createError({ statusCode: 400, statusMessage: 'product_title is required' })
  }

  const identifiers = [
    ean ? `EAN/Barcode: ${ean}` : null,
    asin ? `ASIN: ${asin}` : null,
  ].filter(Boolean).join(', ') || 'No barcode/ASIN on record'

  const priceContext = retail_price
    ? `Our retail price: ${currency} ${Number(retail_price).toFixed(2)}`
    : 'Our price: not set'

  const isHealthProduct = /supplement|vitamin|serum|collagen|probiotic|omega|health/i.test(
    `${product_title} ${category_name ?? ''}`
  )

  const prompt = `You are a competitive intelligence analyst for a Singapore-based skincare and makeup retailer.
Using your knowledge of Shopee SG, Lazada SG, Amazon, and iHerb listings, assess this product's competitive position.
Base your analysis on your training knowledge of typical pricing, review volumes, and availability for this type of product on each platform.
If you have specific knowledge of this product's listings, use it. If not, estimate based on comparable products in the same category.

PRODUCT:
- Title: ${product_title}
- Brand: ${brand_name ?? 'Unknown'}
- Category: ${category_name ?? 'Unknown'}
- Identifiers: ${identifiers}
- ${priceContext}

SEARCH INSTRUCTIONS:
Search for this exact product on:
1. Shopee Singapore (shopee.sg) — search by product name and/or EAN/barcode
2. Lazada Singapore (lazada.sg) — search by product name and/or EAN
3. Amazon (amazon.sg or amazon.com) — use ASIN if available, otherwise product name
${isHealthProduct ? '4. iHerb (iherb.com) — search by product name (iHerb is relevant for health/wellness products)' : '4. iHerb (iherb.com) — only include if you find this exact product there'}

For each marketplace, find the top/best-selling listing for this product.
Extract:
- Exact listing title as shown on the platform
- Full product URL
- Current price in SGD (convert from other currencies using approximate rates: USD×1.35, MYR×0.30)
- Star rating (out of 5.0)
- Total review/rating count
- Sales volume label (e.g. "1.2k sold", "500+ bought last month") — use "unknown" if not shown
- Primary seller/store name
- Stock availability

SCORING RULES (apply carefully):

price_score (0–100): Compare marketplace prices to our retail price.
  - 100 = our price is equal to or lower than cheapest marketplace
  - 80 = our price within 10% of cheapest
  - 60 = our price within 20% of cheapest
  - 40 = our price 20–40% above cheapest marketplace
  - 20 = our price 40–60% above cheapest
  - 0 = our price more than 60% above cheapest or product not found anywhere
  - If our price is not set, score based on how competitive marketplace prices look vs each other (middle = 50)

review_score (0–100): Quality × volume signal.
  - Rating weight: (avg_rating / 5.0) × 60
  - Volume weight: min(log10(total_reviews + 1) / log10(10000) × 40, 40)
  - Combined = rating_weight + volume_weight
  - If not found on any platform: 0

availability_score (0–100): Platform reach.
  - Each platform where product is found in-stock: +25 points
  - Found but out of stock: +10 points
  - Not found: 0 points

overall_score = (price_score × 0.30) + (review_score × 0.40) + (availability_score × 0.30)

competitive_position:
  - "market_leader" if overall_score ≥ 80
  - "competitive" if overall_score 60–79
  - "at_risk" if overall_score 40–59
  - "lagging" if overall_score < 40
  - "niche" if found on ≤1 platform with review_count < 50 (specialist product)

price_position:
  - "cheapest" = our price ≤ lowest marketplace price found
  - "competitive" = our price within 15% above lowest marketplace price
  - "premium" = our price 15–40% above average marketplace price
  - "overpriced" = our price >40% above average OR not price-competitive on most platforms
  - "unknown" if our price not set

WRITE a 2–3 sentence ai_summary that:
- States where the product is found and its rating/review standing
- Compares our price position vs marketplace prices specifically
- Notes any risk or opportunity

WRITE 3 specific, actionable recommendations based on the findings.

OUTPUT ONLY this exact JSON (no markdown fences, no prose before or after):
{
  "snapshots": [
    {
      "marketplace": "shopee",
      "found": true,
      "listing_title": "exact title from platform",
      "external_url": "https://shopee.sg/...",
      "price": 29.90,
      "currency": "SGD",
      "rating": 4.7,
      "review_count": 1250,
      "units_sold_label": "1.2k sold",
      "seller_name": "OfficialBrandSG",
      "availability": "in_stock"
    },
    {
      "marketplace": "lazada",
      "found": false,
      "listing_title": null,
      "external_url": null,
      "price": null,
      "currency": "SGD",
      "rating": null,
      "review_count": null,
      "units_sold_label": null,
      "seller_name": null,
      "availability": "unknown"
    }
  ],
  "analysis": {
    "overall_score": 72,
    "price_score": 65,
    "review_score": 80,
    "availability_score": 67,
    "competitive_position": "competitive",
    "price_position": "competitive",
    "ai_summary": "Laneige Water Sleeping Mask is well-established on Shopee (4.7★, 1.2k sold) and Amazon SG but absent from Lazada. Our SGD 45 price is within 8% of the cheapest Shopee listing, placing us in a competitive position. Review volume is strong but a second official channel on Lazada would improve reach and availability score.",
    "recommendations": [
      "List product on Lazada SG to capture an additional 25% of the addressable SG marketplace audience",
      "Match Shopee's lowest price of SGD 41.90 or offer bundle promotions to protect price-competitiveness during 11.11 and 12.12 sales",
      "Actively drive reviews on Shopee — aim for 2k+ reviews to reinforce market leader positioning"
    ]
  }
}`

  // Call xAI for AI-estimated analysis (immediate result)
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
      max_tokens: 2500,
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

  const snapshots: any[] = parsed.snapshots ?? []
  const analysis: any = parsed.analysis ?? {}
  const analysedAt = new Date().toISOString()

  // Persist to database with data_source = 'ai_estimated'
  const db = getServiceClient()

  let snapshotIds: string[] = []
  if (snapshots.length > 0) {
    const { data: insertedSnaps } = await db
      .from('product_quality_snapshots')
      .insert(
        snapshots.map((s: any) => ({
          workspace_id,
          product_id,
          marketplace: s.marketplace ?? 'unknown',
          found: s.found ?? false,
          listing_title: s.listing_title ?? null,
          external_url: s.external_url ?? null,
          price: s.price ?? null,
          currency: s.currency ?? 'SGD',
          rating: s.rating ?? null,
          review_count: s.review_count ?? null,
          units_sold_label: s.units_sold_label ?? null,
          seller_name: s.seller_name ?? null,
          availability: s.availability ?? 'unknown',
          data_source: 'ai_estimated',
          crawled_at: analysedAt,
        }))
      )
      .select('id')
    snapshotIds = (insertedSnaps ?? []).map((s: any) => s.id)
  }

  const sourcesFound = snapshots
    .filter((s: any) => s.found)
    .map((s: any) => s.marketplace)

  await db
    .from('product_quality_analyses')
    .upsert(
      {
        workspace_id,
        product_id,
        overall_score: analysis.overall_score ?? null,
        price_score: analysis.price_score ?? null,
        review_score: analysis.review_score ?? null,
        availability_score: analysis.availability_score ?? null,
        competitive_position: analysis.competitive_position ?? null,
        price_position: analysis.price_position ?? null,
        ai_summary: analysis.ai_summary ?? null,
        recommendations: analysis.recommendations ?? null,
        snapshot_ids: snapshotIds,
        sources_checked: sourcesFound,
        analysed_at: analysedAt,
      },
      { onConflict: 'workspace_id,product_id' }
    )

  // Queue for overnight real scraping (non-blocking, ignore errors)
  db.from('scrape_queue')
    .upsert(
      {
        workspace_id,
        product_id,
        status: 'pending',
        priority: 0,
        queued_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,product_id', ignoreDuplicates: true }
    )
    .then(() => {})
    .catch(() => {})

  return {
    product_id,
    snapshots,
    analysis: {
      ...analysis,
      snapshot_ids: snapshotIds,
      sources_checked: sourcesFound,
      analysed_at: analysedAt,
    },
    data_source: 'ai_estimated',
    queued_for_scrape: true,
    generated_at: analysedAt,
  }
})
