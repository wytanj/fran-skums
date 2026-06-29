import { getBrowser, createStealthPage, closeBrowser } from './browser-manager'
import { shopeeScraper } from './scrapers/shopee'
import { lazadaScraper } from './scrapers/lazada'
import { amazonScraper } from './scrapers/amazon'
import { iherbScraper } from './scrapers/iherb'
import { computeAllScores } from './scoring'
import { humanDelay, type ScraperOptions, type MarketplaceScrapeResult } from './scrapers/base'
import { getServiceClient } from './supabase'

interface ScrapeAndScoreParams {
  product_id: string
  workspace_id: string
  product_title: string
  brand_name?: string | null
  category_name?: string | null
  ean?: string | null
  asin?: string | null
  retail_price?: number | null
  currency?: string
}

interface ScrapeAndScoreResult {
  snapshots: MarketplaceScrapeResult[]
  analysis: {
    overall_score: number
    price_score: number
    review_score: number
    availability_score: number
    competitive_position: string
    price_position: string
    ai_summary: string | null
    recommendations: string[] | null
    snapshot_ids: string[]
    sources_checked: string[]
    analysed_at: string
  }
}

/**
 * Full scrape → score → AI interpret pipeline.
 * Used by instant/bulk paid endpoints and the overnight queue processor.
 */
export async function scrapeAndScoreProduct(params: ScrapeAndScoreParams): Promise<ScrapeAndScoreResult> {
  const config = useRuntimeConfig()
  const scraperOptions: ScraperOptions = {
    product_title: params.product_title,
    brand_name: params.brand_name,
    ean: params.ean,
    asin: params.asin,
    retail_price: params.retail_price,
    currency: params.currency,
  }

  // Determine which marketplaces to scrape
  const isHealthProduct = /supplement|vitamin|serum|collagen|probiotic|omega|health/i.test(
    `${params.product_title} ${params.category_name ?? ''}`
  )

  const scrapers = [shopeeScraper, lazadaScraper, amazonScraper]
  if (isHealthProduct) scrapers.push(iherbScraper)

  // ── Phase 1: Scrape ────────────────────────────────────────
  const browser = await getBrowser()
  const snapshots: MarketplaceScrapeResult[] = []

  // Scrape sequentially to avoid anti-bot (each uses its own page)
  for (const scraper of scrapers) {
    const page = await createStealthPage(browser)
    try {
      const result = await scraper.scrape(page, scraperOptions)
      snapshots.push(result)
    } catch (err: any) {
      snapshots.push({
        marketplace: scraper.marketplace,
        found: false,
        listing_title: null,
        external_url: null,
        external_product_id: null,
        price: null,
        currency: 'SGD',
        rating: null,
        review_count: null,
        units_sold_label: null,
        seller_name: null,
        availability: 'unknown',
        scrape_error: err.message?.slice(0, 200) ?? 'Unknown error',
      })
    } finally {
      await page.close().catch(() => {})
    }
    // Anti-bot delay between marketplaces
    await humanDelay(2000, 4000)
  }

  // If iHerb wasn't included but product was found there in AI context, skip
  if (!isHealthProduct && !snapshots.find(s => s.marketplace === 'iherb')) {
    snapshots.push({
      marketplace: 'iherb',
      found: false,
      listing_title: null,
      external_url: null,
      external_product_id: null,
      price: null,
      currency: 'SGD',
      rating: null,
      review_count: null,
      units_sold_label: null,
      seller_name: null,
      availability: 'unknown',
      scrape_error: null,
    })
  }

  // ── Phase 2: Score deterministically ───────────────────────
  const scores = computeAllScores(snapshots, params.retail_price ?? null)

  // ── Phase 3: AI interpretation (summary + recommendations) ─
  let aiSummary: string | null = null
  let recommendations: string[] | null = null

  const xaiApiKey = config.xaiApiKey
  if (xaiApiKey) {
    try {
      const aiResult = await getAIInterpretation(
        params,
        snapshots,
        scores,
        xaiApiKey
      )
      aiSummary = aiResult.ai_summary
      recommendations = aiResult.recommendations
    } catch {
      // AI interpretation is optional — scores are the source of truth
    }
  }

  // ── Phase 4: Persist to database ───────────────────────────
  const analysedAt = new Date().toISOString()
  const db = getServiceClient()

  let snapshotIds: string[] = []
  if (snapshots.length > 0) {
    const { data: insertedSnaps } = await db
      .from('product_quality_snapshots')
      .insert(
        snapshots.map((s) => ({
          workspace_id: params.workspace_id,
          product_id: params.product_id,
          marketplace: s.marketplace,
          found: s.found,
          listing_title: s.listing_title,
          external_url: s.external_url,
          external_product_id: s.external_product_id,
          price: s.price,
          currency: s.currency,
          rating: s.rating,
          review_count: s.review_count,
          units_sold_label: s.units_sold_label,
          seller_name: s.seller_name,
          availability: s.availability ?? 'unknown',
          data_source: 'scraped',
          scrape_error: s.scrape_error,
          crawled_at: analysedAt,
        }))
      )
      .select('id')
    snapshotIds = (insertedSnaps ?? []).map((s: any) => s.id)
  }

  const sourcesFound = snapshots
    .filter((s) => s.found)
    .map((s) => s.marketplace)

  await db
    .from('product_quality_analyses')
    .upsert(
      {
        workspace_id: params.workspace_id,
        product_id: params.product_id,
        overall_score: scores.overall_score,
        price_score: scores.price_score,
        review_score: scores.review_score,
        availability_score: scores.availability_score,
        competitive_position: scores.competitive_position,
        price_position: scores.price_position,
        ai_summary: aiSummary,
        recommendations,
        snapshot_ids: snapshotIds,
        sources_checked: sourcesFound,
        analysed_at: analysedAt,
      },
      { onConflict: 'workspace_id,product_id' }
    )

  return {
    snapshots,
    analysis: {
      ...scores,
      ai_summary: aiSummary,
      recommendations,
      snapshot_ids: snapshotIds,
      sources_checked: sourcesFound,
      analysed_at: analysedAt,
    },
  }
}

/**
 * Send real scraped data to Grok for summary + recommendations only.
 * AI no longer estimates numbers — it interprets real data.
 */
async function getAIInterpretation(
  params: ScrapeAndScoreParams,
  snapshots: MarketplaceScrapeResult[],
  scores: ReturnType<typeof computeAllScores>,
  xaiApiKey: string
): Promise<{ ai_summary: string | null; recommendations: string[] | null }> {
  const marketplaceData = snapshots
    .map((s) => {
      if (!s.found) return `- ${s.marketplace}: NOT FOUND`
      return `- ${s.marketplace}: ${s.listing_title ?? 'N/A'} | Price: SGD ${s.price ?? 'N/A'} | Rating: ${s.rating ?? 'N/A'}/5 | Reviews: ${s.review_count ?? 'N/A'} | Sold: ${s.units_sold_label ?? 'N/A'} | Stock: ${s.availability}`
    })
    .join('\n')

  const prompt = `You are a competitive intelligence analyst. Given REAL scraped marketplace data for a Singapore skincare/makeup product, write a brief assessment.

PRODUCT: ${params.product_title}
Brand: ${params.brand_name ?? 'Unknown'}
Category: ${params.category_name ?? 'Unknown'}
Our retail price: ${params.retail_price ? `SGD ${Number(params.retail_price).toFixed(2)}` : 'not set'}

REAL MARKETPLACE DATA (scraped today):
${marketplaceData}

COMPUTED SCORES:
- Overall: ${scores.overall_score}/100
- Price: ${scores.price_score}/100
- Reviews: ${scores.review_score}/100
- Availability: ${scores.availability_score}/100
- Position: ${scores.competitive_position}
- Price position: ${scores.price_position}

OUTPUT ONLY this exact JSON (no markdown fences):
{
  "ai_summary": "2-3 sentence summary interpreting the real data above. State where the product is found, its price competitiveness, and any risk or opportunity.",
  "recommendations": ["specific action 1", "specific action 2", "specific action 3"]
}`

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
      max_tokens: 800,
    }),
  })

  if (!response.ok) return { ai_summary: null, recommendations: null }

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

  return {
    ai_summary: parsed.ai_summary ?? null,
    recommendations: parsed.recommendations ?? null,
  }
}
