import type { Page } from 'puppeteer'

// ── Types ────────────────────────────────────────────────────

export interface ScraperOptions {
  product_title: string
  brand_name?: string | null
  ean?: string | null
  asin?: string | null
  retail_price?: number | null
  currency?: string
}

export interface MarketplaceScrapeResult {
  marketplace: 'shopee' | 'lazada' | 'amazon' | 'iherb'
  found: boolean
  listing_title: string | null
  external_url: string | null
  external_product_id: string | null
  price: number | null
  currency: string
  rating: number | null
  review_count: number | null
  units_sold_label: string | null
  seller_name: string | null
  availability: 'in_stock' | 'out_of_stock' | 'unknown'
  scrape_error: string | null
}

export interface MarketplaceScraper {
  marketplace: MarketplaceScrapeResult['marketplace']
  scrape(page: Page, options: ScraperOptions): Promise<MarketplaceScrapeResult>
}

// ── Shared Helpers ───────────────────────────────────────────

const CURRENCY_TO_SGD: Record<string, number> = {
  USD: 1.35,
  MYR: 0.30,
  THB: 0.038,
  PHP: 0.024,
  IDR: 0.000085,
  EUR: 1.45,
  GBP: 1.70,
  AUD: 0.88,
  JPY: 0.009,
  CNY: 0.19,
  SGD: 1,
}

export function convertToSGD(amount: number, fromCurrency: string): number {
  const rate = CURRENCY_TO_SGD[fromCurrency.toUpperCase()] ?? 1
  return Math.round(amount * rate * 100) / 100
}

export function parsePrice(text: string): { amount: number; currency: string } | null {
  if (!text) return null
  const cleaned = text.replace(/\s+/g, ' ').trim()

  // Match common price patterns: $29.90, S$29.90, SGD 29.90, RM29.90, US$29.90
  const match = cleaned.match(
    /(?:S\$|SGD|RM|MYR|US\$|USD|\$|€|£|¥|A\$|AUD|THB|฿|₱|PHP|Rp|IDR)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i
  ) || cleaned.match(
    /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:SGD|MYR|USD|EUR|GBP|AUD|THB|PHP|IDR)/i
  )

  if (!match) return null

  const amount = parseFloat(match[1].replace(/,/g, ''))
  if (isNaN(amount)) return null

  // Detect currency from prefix/suffix
  let currency = 'SGD'
  if (/S\$|SGD/i.test(cleaned)) currency = 'SGD'
  else if (/RM|MYR/i.test(cleaned)) currency = 'MYR'
  else if (/US\$|USD/i.test(cleaned)) currency = 'USD'
  else if (/€|EUR/i.test(cleaned)) currency = 'EUR'
  else if (/£|GBP/i.test(cleaned)) currency = 'GBP'
  else if (/A\$|AUD/i.test(cleaned)) currency = 'AUD'
  else if (/฿|THB/i.test(cleaned)) currency = 'THB'
  else if (/₱|PHP/i.test(cleaned)) currency = 'PHP'
  else if (/Rp|IDR/i.test(cleaned)) currency = 'IDR'
  else if (/¥|JPY|CNY/i.test(cleaned)) currency = 'JPY'
  else if (/\$/i.test(cleaned)) currency = 'USD' // fallback for bare $

  return { amount, currency }
}

export function parseRating(text: string): number | null {
  if (!text) return null
  const match = text.match(/([0-9.]+)\s*(?:\/\s*5|out of 5|stars?)?/i)
  if (!match) return null
  const val = parseFloat(match[1])
  return val >= 0 && val <= 5 ? Math.round(val * 10) / 10 : null
}

export function parseReviewCount(text: string): number | null {
  if (!text) return null
  const cleaned = text.replace(/[(),]/g, '').trim()

  // Handle "1.2k", "3.5K", "12K"
  const kMatch = cleaned.match(/([0-9.]+)\s*k/i)
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000)

  // Handle "1.2M"
  const mMatch = cleaned.match(/([0-9.]+)\s*m/i)
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1000000)

  // Plain number
  const numMatch = cleaned.match(/([0-9,]+)/)
  if (numMatch) return parseInt(numMatch[1].replace(/,/g, ''), 10)

  return null
}

export function buildSearchQuery(options: ScraperOptions): string {
  // Prefer EAN/ASIN for exact match, fallback to title + brand
  if (options.ean) return options.ean
  if (options.asin) return options.asin

  const parts = []
  if (options.brand_name) parts.push(options.brand_name)
  parts.push(options.product_title)
  return parts.join(' ').slice(0, 120) // Keep search query reasonable length
}

export function emptyResult(marketplace: MarketplaceScrapeResult['marketplace'], error?: string): MarketplaceScrapeResult {
  return {
    marketplace,
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
    scrape_error: error ?? null,
  }
}

/** Random delay to mimic human behavior */
export function humanDelay(minMs = 1000, maxMs = 3000): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
  return new Promise(resolve => setTimeout(resolve, ms))
}
