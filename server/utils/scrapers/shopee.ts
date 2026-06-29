import type { Page } from 'puppeteer'
import type { MarketplaceScraper, ScraperOptions, MarketplaceScrapeResult } from './base'
import { buildSearchQuery, parsePrice, parseRating, parseReviewCount, convertToSGD, emptyResult, humanDelay } from './base'

export const shopeeScraper: MarketplaceScraper = {
  marketplace: 'shopee',

  async scrape(page: Page, options: ScraperOptions): Promise<MarketplaceScrapeResult> {
    try {
      const query = buildSearchQuery(options)
      const searchUrl = `https://shopee.sg/search?keyword=${encodeURIComponent(query)}`

      await page.goto(searchUrl, { waitUntil: 'networkidle2' })
      await humanDelay(2000, 4000)

      // Scroll to trigger lazy loading
      await page.evaluate(() => window.scrollBy(0, 600))
      await humanDelay(1500, 2500)

      // Wait for search results — Shopee uses different selectors across versions
      const resultSelector = await Promise.race([
        page.waitForSelector('[data-sqe="item"]', { timeout: 10000 }).then(() => '[data-sqe="item"]'),
        page.waitForSelector('.shopee-search-item-result__item', { timeout: 10000 }).then(() => '.shopee-search-item-result__item'),
        page.waitForSelector('.shop-search-result-view__item', { timeout: 10000 }).then(() => '.shop-search-result-view__item'),
      ]).catch(() => null)

      if (!resultSelector) {
        return emptyResult('shopee', 'No search results found — selectors may have changed')
      }

      // Extract first result
      const data = await page.evaluate((sel) => {
        const item = document.querySelector(sel)
        if (!item) return null

        const link = item.querySelector('a')
        const href = link?.getAttribute('href') ?? ''

        // Price — look for common price containers
        const priceEl = item.querySelector('[class*="price"], [class*="Price"]')
        const priceText = priceEl?.textContent?.trim() ?? ''

        // Title
        const titleEl = item.querySelector('[class*="name"], [class*="Name"], [data-sqe="name"]')
          ?? item.querySelector('div > div > div > div:nth-child(2)')
        const title = titleEl?.textContent?.trim() ?? ''

        // Rating
        const ratingEl = item.querySelector('[class*="rating"], [class*="star"]')
        const ratingText = ratingEl?.textContent?.trim() ?? ''

        // Sold count
        const soldEl = item.querySelector('[class*="sold"], [class*="Sold"]')
        const soldText = soldEl?.textContent?.trim() ?? ''

        // Seller
        const sellerEl = item.querySelector('[class*="shop"], [class*="Shop"], [class*="seller"]')
        const sellerText = sellerEl?.textContent?.trim() ?? ''

        return { href, priceText, title, ratingText, soldText, sellerText }
      }, resultSelector)

      if (!data || !data.title) {
        return emptyResult('shopee', 'Could not extract listing data')
      }

      const priceInfo = parsePrice(data.priceText)
      const priceSGD = priceInfo
        ? (priceInfo.currency === 'SGD' ? priceInfo.amount : convertToSGD(priceInfo.amount, priceInfo.currency))
        : null

      const fullUrl = data.href.startsWith('http')
        ? data.href
        : `https://shopee.sg${data.href}`

      return {
        marketplace: 'shopee',
        found: true,
        listing_title: data.title.slice(0, 500),
        external_url: fullUrl,
        external_product_id: null,
        price: priceSGD,
        currency: 'SGD',
        rating: parseRating(data.ratingText),
        review_count: parseReviewCount(data.ratingText) ?? parseReviewCount(data.soldText),
        units_sold_label: data.soldText || null,
        seller_name: data.sellerText || null,
        availability: priceSGD ? 'in_stock' : 'unknown',
        scrape_error: null,
      }
    } catch (err: any) {
      return emptyResult('shopee', err.message?.slice(0, 200))
    }
  },
}
