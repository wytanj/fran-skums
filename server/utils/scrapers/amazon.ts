import type { Page } from 'puppeteer'
import type { MarketplaceScraper, ScraperOptions, MarketplaceScrapeResult } from './base'
import { buildSearchQuery, parsePrice, parseRating, parseReviewCount, convertToSGD, emptyResult, humanDelay } from './base'

export const amazonScraper: MarketplaceScraper = {
  marketplace: 'amazon',

  async scrape(page: Page, options: ScraperOptions): Promise<MarketplaceScrapeResult> {
    try {
      // If ASIN is available, go directly to product page
      if (options.asin) {
        return await scrapeProductPage(page, options.asin)
      }

      // Otherwise, search
      const query = buildSearchQuery(options)
      const searchUrl = `https://www.amazon.sg/s?k=${encodeURIComponent(query)}`

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' })
      await humanDelay(1500, 3000)

      // Wait for search results
      const hasResults = await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 10000 }).catch(() => null)

      if (!hasResults) {
        return emptyResult('amazon', 'No search results found')
      }

      const data = await page.evaluate(() => {
        const item = document.querySelector('[data-component-type="s-search-result"]')
        if (!item) return null

        const asin = item.getAttribute('data-asin') ?? ''

        // Title
        const titleEl = item.querySelector('h2 a span, .a-size-medium, .a-size-base-plus')
        const title = titleEl?.textContent?.trim() ?? ''
        const titleLink = item.querySelector('h2 a')
        const href = titleLink?.getAttribute('href') ?? ''

        // Price — whole + fraction
        const wholeEl = item.querySelector('.a-price-whole')
        const fractionEl = item.querySelector('.a-price-fraction')
        const symbolEl = item.querySelector('.a-price-symbol')
        let priceText = ''
        if (wholeEl) {
          const symbol = symbolEl?.textContent?.trim() ?? 'S$'
          const whole = wholeEl.textContent?.replace(/[.,]/g, '').trim() ?? ''
          const fraction = fractionEl?.textContent?.trim() ?? '00'
          priceText = `${symbol}${whole}.${fraction}`
        }

        // Rating
        const ratingEl = item.querySelector('.a-icon-alt, [class*="a-star"]')
        const ratingText = ratingEl?.textContent?.trim() ?? ''

        // Review count
        const reviewEl = item.querySelector('[class*="a-size-small"] .a-link-normal .a-size-base, .a-size-base[dir="auto"]')
        const reviewText = reviewEl?.textContent?.trim() ?? ''

        // Seller / fulfilled by
        const sellerEl = item.querySelector('[class*="a-row a-size-base"] .a-size-base')
        const sellerText = sellerEl?.textContent?.trim() ?? ''

        return { asin, href, title, priceText, ratingText, reviewText, sellerText }
      })

      if (!data || !data.title) {
        return emptyResult('amazon', 'Could not extract listing data')
      }

      const priceInfo = parsePrice(data.priceText)
      const priceSGD = priceInfo
        ? (priceInfo.currency === 'SGD' ? priceInfo.amount : convertToSGD(priceInfo.amount, priceInfo.currency))
        : null

      const fullUrl = data.href.startsWith('http')
        ? data.href
        : `https://www.amazon.sg${data.href}`

      return {
        marketplace: 'amazon',
        found: true,
        listing_title: data.title.slice(0, 500),
        external_url: fullUrl,
        external_product_id: data.asin || null,
        price: priceSGD,
        currency: 'SGD',
        rating: parseRating(data.ratingText),
        review_count: parseReviewCount(data.reviewText),
        units_sold_label: null,
        seller_name: data.sellerText || null,
        availability: priceSGD ? 'in_stock' : 'unknown',
        scrape_error: null,
      }
    } catch (err: any) {
      return emptyResult('amazon', err.message?.slice(0, 200))
    }
  },
}

async function scrapeProductPage(page: Page, asin: string): Promise<MarketplaceScrapeResult> {
  try {
    const url = `https://www.amazon.sg/dp/${asin}`
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await humanDelay(1500, 2500)

    const data = await page.evaluate(() => {
      const title = document.querySelector('#productTitle')?.textContent?.trim() ?? ''

      // Price
      const priceEl = document.querySelector('.a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice, .a-price-whole')
      const priceText = priceEl?.textContent?.trim() ?? ''

      // Rating
      const ratingEl = document.querySelector('#acrPopover .a-icon-alt, [data-asin-rating]')
      const ratingText = ratingEl?.textContent?.trim() ?? ratingEl?.getAttribute('data-asin-rating') ?? ''

      // Review count
      const reviewEl = document.querySelector('#acrCustomerReviewText')
      const reviewText = reviewEl?.textContent?.trim() ?? ''

      // Availability
      const availEl = document.querySelector('#availability span, #outOfStock')
      const availText = availEl?.textContent?.trim().toLowerCase() ?? ''
      const inStock = availText.includes('in stock') || availText.includes('available')
      const outOfStock = availText.includes('unavailable') || availText.includes('out of stock')

      // Seller
      const sellerEl = document.querySelector('#merchant-info, #sellerProfileTriggerId')
      const sellerText = sellerEl?.textContent?.trim() ?? ''

      return {
        title,
        priceText,
        ratingText,
        reviewText,
        sellerText,
        inStock,
        outOfStock,
      }
    })

    if (!data || !data.title) {
      return emptyResult('amazon', 'Product page could not be parsed')
    }

    const priceInfo = parsePrice(data.priceText)
    const priceSGD = priceInfo
      ? (priceInfo.currency === 'SGD' ? priceInfo.amount : convertToSGD(priceInfo.amount, priceInfo.currency))
      : null

    let availability: 'in_stock' | 'out_of_stock' | 'unknown' = 'unknown'
    if (data.inStock) availability = 'in_stock'
    else if (data.outOfStock) availability = 'out_of_stock'
    else if (priceSGD) availability = 'in_stock'

    return {
      marketplace: 'amazon',
      found: true,
      listing_title: data.title.slice(0, 500),
      external_url: `https://www.amazon.sg/dp/${asin}`,
      external_product_id: asin,
      price: priceSGD,
      currency: 'SGD',
      rating: parseRating(data.ratingText),
      review_count: parseReviewCount(data.reviewText),
      units_sold_label: null,
      seller_name: data.sellerText || null,
      availability,
      scrape_error: null,
    }
  } catch (err: any) {
    return emptyResult('amazon', err.message?.slice(0, 200))
  }
}
