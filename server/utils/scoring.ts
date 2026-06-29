import type { MarketplaceScrapeResult } from './scrapers/base'

export type CompetitivePosition = 'market_leader' | 'competitive' | 'at_risk' | 'lagging' | 'niche'
export type PricePosition = 'cheapest' | 'competitive' | 'premium' | 'overpriced' | 'unknown'

/**
 * Price score (0–100): Compare our retail price to marketplace prices.
 * 100 = our price ≤ cheapest, scales down as our price exceeds cheapest.
 */
export function computePriceScore(ourPrice: number | null, marketplacePrices: number[]): number {
  const validPrices = marketplacePrices.filter(p => p > 0)
  if (validPrices.length === 0) return 0

  const cheapest = Math.min(...validPrices)

  if (ourPrice === null || ourPrice <= 0) {
    // No our-price set — score based on marketplace price spread (midpoint = 50)
    const avg = validPrices.reduce((a, b) => a + b, 0) / validPrices.length
    const spread = cheapest / avg
    return Math.round(spread * 50)
  }

  const pctAbove = (ourPrice - cheapest) / cheapest

  if (pctAbove <= 0) return 100       // Our price ≤ cheapest
  if (pctAbove <= 0.10) return 80     // Within 10%
  if (pctAbove <= 0.20) return 60     // Within 20%
  if (pctAbove <= 0.40) return 40     // 20–40% above
  if (pctAbove <= 0.60) return 20     // 40–60% above
  return 0                             // >60% above
}

/**
 * Review score (0–100): Rating quality × volume signal.
 * Rating weight: (avg_rating / 5.0) × 60
 * Volume weight: min(log10(total_reviews + 1) / log10(10000) × 40, 40)
 */
export function computeReviewScore(snapshots: MarketplaceScrapeResult[]): number {
  const withRatings = snapshots.filter(s => s.found && s.rating !== null && s.rating > 0)
  if (withRatings.length === 0) return 0

  // Use highest rating across platforms
  const bestRating = Math.max(...withRatings.map(s => s.rating!))
  const ratingWeight = (bestRating / 5.0) * 60

  // Sum all review counts across platforms
  const totalReviews = snapshots
    .filter(s => s.found && s.review_count !== null)
    .reduce((sum, s) => sum + (s.review_count ?? 0), 0)

  const volumeWeight = Math.min(
    (Math.log10(totalReviews + 1) / Math.log10(10000)) * 40,
    40
  )

  return Math.round(ratingWeight + volumeWeight)
}

/**
 * Availability score (0–100): Platform reach.
 * +25 per in-stock platform, +10 per out-of-stock, 0 per not-found.
 */
export function computeAvailabilityScore(snapshots: MarketplaceScrapeResult[]): number {
  let score = 0
  for (const s of snapshots) {
    if (!s.found) continue
    if (s.availability === 'in_stock') score += 25
    else if (s.availability === 'out_of_stock') score += 10
  }
  return Math.min(score, 100)
}

/**
 * Overall score: weighted average.
 * (price × 0.30) + (reviews × 0.40) + (availability × 0.30)
 */
export function computeOverallScore(priceScore: number, reviewScore: number, availabilityScore: number): number {
  return Math.round(
    (priceScore * 0.30) + (reviewScore * 0.40) + (availabilityScore * 0.30)
  )
}

/**
 * Classify competitive position from overall score.
 */
export function classifyPosition(
  overallScore: number,
  platformCount: number,
  totalReviewCount: number
): CompetitivePosition {
  // Niche: found on ≤1 platform with <50 reviews
  if (platformCount <= 1 && totalReviewCount < 50) return 'niche'

  if (overallScore >= 80) return 'market_leader'
  if (overallScore >= 60) return 'competitive'
  if (overallScore >= 40) return 'at_risk'
  return 'lagging'
}

/**
 * Classify price position relative to marketplace prices.
 */
export function classifyPricePosition(ourPrice: number | null, marketplacePrices: number[]): PricePosition {
  if (ourPrice === null || ourPrice <= 0) return 'unknown'

  const validPrices = marketplacePrices.filter(p => p > 0)
  if (validPrices.length === 0) return 'unknown'

  const cheapest = Math.min(...validPrices)
  const avg = validPrices.reduce((a, b) => a + b, 0) / validPrices.length

  if (ourPrice <= cheapest) return 'cheapest'

  const pctAboveCheapest = (ourPrice - cheapest) / cheapest
  if (pctAboveCheapest <= 0.15) return 'competitive'

  const pctAboveAvg = (ourPrice - avg) / avg
  if (pctAboveAvg <= 0.40) return 'premium'

  return 'overpriced'
}

/**
 * Compute all scores from scraped snapshots.
 */
export function computeAllScores(
  snapshots: MarketplaceScrapeResult[],
  ourPrice: number | null
) {
  const marketplacePrices = snapshots
    .filter(s => s.found && s.price !== null && s.price > 0)
    .map(s => s.price!)

  const platformCount = snapshots.filter(s => s.found).length
  const totalReviewCount = snapshots
    .filter(s => s.found)
    .reduce((sum, s) => sum + (s.review_count ?? 0), 0)

  const priceScore = computePriceScore(ourPrice, marketplacePrices)
  const reviewScore = computeReviewScore(snapshots)
  const availabilityScore = computeAvailabilityScore(snapshots)
  const overallScore = computeOverallScore(priceScore, reviewScore, availabilityScore)
  const competitivePosition = classifyPosition(overallScore, platformCount, totalReviewCount)
  const pricePosition = classifyPricePosition(ourPrice, marketplacePrices)

  return {
    overall_score: overallScore,
    price_score: priceScore,
    review_score: reviewScore,
    availability_score: availabilityScore,
    competitive_position: competitivePosition,
    price_position: pricePosition,
  }
}
