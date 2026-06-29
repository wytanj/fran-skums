import type { Page } from 'puppeteer'
import type { MarketplaceScraper, ScraperOptions, MarketplaceScrapeResult } from './base'
import { buildSearchQuery, parsePrice, parseRating, parseReviewCount, convertToSGD, emptyResult, humanDelay } from './base'

export const iherbScraper: MarketplaceScraper = {
  marketplace: 'iherb',

  async scrape(page: Page, options: ScraperOptions): Promise<MarketplaceScrapeResult> {
    try {
      const query = buildSearchQuery(options)
      const searchUrl = `https://www.iherb.com/search?kw=${encodeURIComponent(query)}`

      // Set iHerb to show SGD prices
      await page.setCookie({
        name: 'iherb.cookie',
        value: 'cn=SG&ln=en-US&cur=SGD',
        domain: '.iherb.com',
      })

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' })
      await humanDelay(2000, 3500)

      // iHerb search results are mostly server-rendered
      const resultSelector = await Promise.race([
        page.waitForSelector('.product-cell-container', { timeout: 10000 }).then(() => '.product-cell-container'),
        page.waitForSelector('[class*="product-card"]', { timeout: 10000 }).then(() => '[class*="product-card"]'),
        page.waitForSelector('.product-inner', { timeout: 10000 }).then(() => '.product-inner'),
      ]).catch(() => null)

      if (!resultSelector) {
        return emptyResult('iherb', 'No search results found')
      }

      const data = await page.evaluate((sel) => {
        const item = document.querySelector(sel)
        if (!item) return null

        // Title + URL
        const titleLink = item.querySelector('a[href*="/pr/"], a.product-title, [class*="product-title"] a')
          ?? item.querySelector('a')
        const title = titleLink?.textContent?.trim() ?? titleLink?.getAttribute('title') ?? ''
        const href = titleLink?.getAttribute('href') ?? ''

        // Product ID from URL (e.g., /pr/Product-Name/12345)
        const idMatch = href.match(/\/(\d+)(?:\?|$)/)
        const productId = idMatch?.[1] ?? ''

        // Price
        const priceEl = item.querySelector('[class*="price"], .product-price bdi, s[class*="price"]')
          ?? item.querySelector('span[class*="our-price"]')
        const priceText = priceEl?.textContent?.trim() ?? ''

        // Rating
        const ratingEl = item.querySelector('[class*="stars"], [class*="rating"], [itemprop="ratingValue"]')
        const ratingText = ratingEl?.textContent?.trim()
          ?? ratingEl?.getAttribute('content')
          ?? ratingEl?.getAttribute('title')
          ?? ''

        // Review count
        const reviewEl = item.querySelector('[class*="review-count"], [itemprop="reviewCount"], [class*="count"]')
        const reviewText = reviewEl?.textContent?.trim() ?? reviewEl?.getAttribute('content') ?? ''

        // Stock
        const stockEl = item.querySelector('[class*="out-of-stock"], [class*="stock"]')
        const stockText = stockEl?.textContent?.trim().toLowerCase() ?? ''
        const outOfStock = stockText.includes('out of stock') || stockText.includes('unavailable')

        return { href, title, productId, priceText, ratingText, reviewText, outOfStock }
      }, resultSelector)

      if (!data || !data.title) {
        return emptyResult('iherb', 'Could not extract listing data')
      }

      const priceInfo = parsePrice(data.priceText)
      // iHerb prices can be in USD by default
      const priceSGD = priceInfo
        ? convertToSGD(priceInfo.amount, priceInfo.currency)
        : null

      const fullUrl = data.href.startsWith('http')
        ? data.href
        : `https://www.iherb.com${data.href}`

      return {
        marketplace: 'iherb',
        found: true,
        listing_title: data.title.slice(0, 500),
        external_url: fullUrl,
        external_product_id: data.productId || null,
        price: priceSGD,
        currency: 'SGD',
        rating: parseRating(data.ratingText),
        review_count: parseReviewCount(data.reviewText),
        units_sold_label: null,
        seller_name: 'iHerb',
        availability: data.outOfStock ? 'out_of_stock' : (priceSGD ? 'in_stock' : 'unknown'),
        scrape_error: null,
      }
    } catch (err: any) {
      return emptyResult('iherb', err.message?.slice(0, 200))
    }
  },
}
