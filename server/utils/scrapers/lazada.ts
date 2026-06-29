import type { Page } from 'puppeteer'
import type { MarketplaceScraper, ScraperOptions, MarketplaceScrapeResult } from './base'
import { buildSearchQuery, parsePrice, parseRating, parseReviewCount, convertToSGD, emptyResult, humanDelay } from './base'

export const lazadaScraper: MarketplaceScraper = {
  marketplace: 'lazada',

  async scrape(page: Page, options: ScraperOptions): Promise<MarketplaceScrapeResult> {
    try {
      const query = buildSearchQuery(options)
      const searchUrl = `https://www.lazada.sg/catalog/?q=${encodeURIComponent(query)}`

      await page.goto(searchUrl, { waitUntil: 'networkidle2' })
      await humanDelay(2000, 4000)

      // Lazada renders search results server-side initially
      const resultSelector = await Promise.race([
        page.waitForSelector('[data-qa-locator="product-item"]', { timeout: 10000 }).then(() => '[data-qa-locator="product-item"]'),
        page.waitForSelector('.Bm3ON', { timeout: 10000 }).then(() => '.Bm3ON'),
        page.waitForSelector('[class*="product-card"]', { timeout: 10000 }).then(() => '[class*="product-card"]'),
      ]).catch(() => null)

      if (!resultSelector) {
        return emptyResult('lazada', 'No search results found — selectors may have changed')
      }

      const data = await page.evaluate((sel) => {
        const item = document.querySelector(sel)
        if (!item) return null

        const link = item.querySelector('a')
        const href = link?.getAttribute('href') ?? ''

        // Title
        const titleEl = item.querySelector('[class*="title"], [class*="Title"], a > div > div')
        const title = titleEl?.textContent?.trim() ?? link?.getAttribute('title') ?? ''

        // Price
        const priceEl = item.querySelector('[class*="price"], [class*="Price"], span[class*="currency"]')
        const priceText = priceEl?.textContent?.trim() ?? ''

        // Rating
        const ratingEl = item.querySelector('[class*="rating"], [class*="star"]')
        const ratingText = ratingEl?.textContent?.trim() ?? ratingEl?.getAttribute('style') ?? ''

        // Review count
        const reviewEl = item.querySelector('[class*="review"], [class*="Review"]')
        const reviewText = reviewEl?.textContent?.trim() ?? ''

        // Sold
        const soldEl = item.querySelector('[class*="sold"], [class*="Sold"]')
        const soldText = soldEl?.textContent?.trim() ?? ''

        // Seller / shop
        const sellerEl = item.querySelector('[class*="shop"], [class*="seller"], [class*="store"]')
        const sellerText = sellerEl?.textContent?.trim() ?? ''

        return { href, title, priceText, ratingText, reviewText, soldText, sellerText }
      }, resultSelector)

      if (!data || !data.title) {
        return emptyResult('lazada', 'Could not extract listing data')
      }

      const priceInfo = parsePrice(data.priceText)
      const priceSGD = priceInfo
        ? (priceInfo.currency === 'SGD' ? priceInfo.amount : convertToSGD(priceInfo.amount, priceInfo.currency))
        : null

      const fullUrl = data.href.startsWith('http')
        ? data.href
        : `https://www.lazada.sg${data.href}`

      // Try to extract rating from style (Lazada sometimes uses width-based stars)
      let rating = parseRating(data.ratingText)
      if (!rating && data.ratingText.includes('width')) {
        const widthMatch = data.ratingText.match(/width:\s*([0-9.]+)%/)
        if (widthMatch) {
          rating = Math.round((parseFloat(widthMatch[1]) / 100) * 5 * 10) / 10
        }
      }

      return {
        marketplace: 'lazada',
        found: true,
        listing_title: data.title.slice(0, 500),
        external_url: fullUrl,
        external_product_id: null,
        price: priceSGD,
        currency: 'SGD',
        rating,
        review_count: parseReviewCount(data.reviewText),
        units_sold_label: data.soldText || null,
        seller_name: data.sellerText || null,
        availability: priceSGD ? 'in_stock' : 'unknown',
        scrape_error: null,
      }
    } catch (err: any) {
      return emptyResult('lazada', err.message?.slice(0, 200))
    }
  },
}
