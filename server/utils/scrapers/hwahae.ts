import type { Page } from 'puppeteer'
import { humanDelay } from './base'

// ── Hwahae Category IDs (skincare + makeup) ─────────────────

export const HWAHAE_SKINCARE_CATEGORIES = [
  { id: 'toner',       label: 'Toner',       rankingUrl: '/en/rankings?english_name=toner&theme_id=2' },
  { id: 'emulsion',    label: 'Emulsion',     rankingUrl: '/en/rankings?english_name=emulsion&theme_id=2' },
  { id: 'serum',       label: 'Serum/Ampoule',rankingUrl: '/en/rankings?english_name=serum&theme_id=2' },
  { id: 'cream',       label: 'Cream',        rankingUrl: '/en/rankings?english_name=cream&theme_id=2' },
  { id: 'eye_cream',   label: 'Eye Cream',    rankingUrl: '/en/rankings?english_name=eye-cream&theme_id=2' },
  { id: 'cleanser',    label: 'Cleanser',     rankingUrl: '/en/rankings?english_name=cleanser&theme_id=2' },
  { id: 'cleansing_oil',label: 'Cleansing Oil',rankingUrl: '/en/rankings?english_name=cleansing-oil&theme_id=2' },
  { id: 'mask',        label: 'Mask/Pack',    rankingUrl: '/en/rankings?english_name=mask-pack&theme_id=2' },
  { id: 'suncare',     label: 'Sun Care',     rankingUrl: '/en/rankings?english_name=suncare&theme_id=2' },
  { id: 'mist',        label: 'Mist',         rankingUrl: '/en/rankings?english_name=mist&theme_id=2' },
  { id: 'lip_care',    label: 'Lip Care',     rankingUrl: '/en/rankings?english_name=lip-care&theme_id=2' },
  { id: 'peeling',     label: 'Peeling/Scrub',rankingUrl: '/en/rankings?english_name=peeling&theme_id=2' },
]

export const HWAHAE_MAKEUP_CATEGORIES = [
  { id: 'foundation',  label: 'Foundation',   rankingUrl: '/en/rankings?english_name=foundation&theme_id=2' },
  { id: 'primer',      label: 'Primer',       rankingUrl: '/en/rankings?english_name=primer&theme_id=2' },
  { id: 'concealer',   label: 'Concealer',    rankingUrl: '/en/rankings?english_name=concealer&theme_id=2' },
  { id: 'powder',      label: 'Powder',       rankingUrl: '/en/rankings?english_name=powder&theme_id=2' },
  { id: 'blush',       label: 'Blush',        rankingUrl: '/en/rankings?english_name=blush&theme_id=2' },
  { id: 'mascara',     label: 'Mascara',      rankingUrl: '/en/rankings?english_name=mascara&theme_id=2' },
  { id: 'eyeliner',    label: 'Eyeliner',     rankingUrl: '/en/rankings?english_name=eyeliner&theme_id=2' },
  { id: 'lipstick',    label: 'Lipstick',     rankingUrl: '/en/rankings?english_name=lipstick&theme_id=2' },
  { id: 'lip_tint',    label: 'Lip Tint',     rankingUrl: '/en/rankings?english_name=lip-tint&theme_id=2' },
]

const HWAHAE_BASE = 'https://www.hwahae.com'

// ── Types ───────────────────────────────────────────────────

export interface HwahaeRankingProduct {
  rank: number
  productName: string
  brandName: string
  rating: number | null
  reviewCount: number | null
  price: string | null
  productUrl: string
  sourceProductId: string
  imageUrl: string | null
}

export interface HwahaeProductDetail {
  productName: string
  brandName: string
  rating: number | null
  reviewCount: number | null
  price: string | null
  volume: string | null
  ingredients: string[]
  ingredientsRaw: string
  skinTypeRatings: Record<string, number> | null
  concerns: string[]
  awards: string[]
  imageUrl: string | null
  sourceUrl: string
  sourceProductId: string
}

// ── Ranking Page Scraper ────────────────────────────────────

export async function scrapeHwahaeRankingPage(
  page: Page,
  categoryUrl: string
): Promise<HwahaeRankingProduct[]> {
  const url = `${HWAHAE_BASE}${categoryUrl}`

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  await humanDelay(2000, 4000)

  // Scroll to load more products
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 800))
    await humanDelay(800, 1500)
  }

  const products = await page.evaluate(() => {
    const items: any[] = []

    // Hwahae ranking pages have product cards with links
    const productLinks = document.querySelectorAll('a[href*="/en/products/"]')

    productLinks.forEach((link, index) => {
      const href = link.getAttribute('href') || ''
      if (!href.includes('/en/products/')) return

      const card = link.closest('[class*="rank"], [class*="product"], li, article') || link

      // Extract product ID from URL: /en/products/Brand-Product/12345
      const idMatch = href.match(/\/(\d+)$/)
      if (!idMatch) return

      // Try to find text content within the card
      const allText = card.textContent || ''

      // Brand is usually the first distinct text element
      const textEls = card.querySelectorAll('span, p, div, h3, h4')
      let brandName = ''
      let productName = ''
      let ratingText = ''
      let reviewText = ''
      let priceText = ''

      textEls.forEach(el => {
        const text = (el.textContent || '').trim()
        if (!text) return

        // Rating pattern: "4.62" or similar decimal
        if (/^\d\.\d{1,2}$/.test(text) && !ratingText) {
          ratingText = text
        }
        // Review count pattern: numbers with commas
        else if (/^[\d,]+$/.test(text) && parseInt(text.replace(/,/g, '')) > 10 && !reviewText) {
          reviewText = text
        }
        // Price pattern
        else if (/\$|USD|₩/.test(text) && !priceText) {
          priceText = text
        }
      })

      // Get image
      const img = card.querySelector('img')
      const imageUrl = img?.getAttribute('src') || img?.getAttribute('data-src') || null

      // Product name and brand from the link text or aria-label
      const linkText = link.textContent?.trim() || ''

      items.push({
        rank: index + 1,
        productName: linkText || productName,
        brandName,
        rating: ratingText ? parseFloat(ratingText) : null,
        reviewCount: reviewText ? parseInt(reviewText.replace(/,/g, '')) : null,
        price: priceText || null,
        productUrl: href.startsWith('http') ? href : `https://www.hwahae.com${href}`,
        sourceProductId: idMatch[1],
        imageUrl,
      })
    })

    return items
  })

  // Deduplicate by sourceProductId
  const seen = new Set<string>()
  return products.filter(p => {
    if (seen.has(p.sourceProductId)) return false
    seen.add(p.sourceProductId)
    return true
  })
}

// ── Product Detail Page Scraper ─────────────────────────────

export async function scrapeHwahaeProductDetail(
  page: Page,
  productUrl: string
): Promise<HwahaeProductDetail | null> {
  try {
    await page.goto(productUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await humanDelay(2000, 3000)

    // Scroll to load ingredients section
    await page.evaluate(() => window.scrollBy(0, 1200))
    await humanDelay(1000, 2000)

    const data = await page.evaluate(() => {
      const getText = (selector: string): string => {
        const el = document.querySelector(selector)
        return el?.textContent?.trim() || ''
      }

      // Product name — usually in h1 or prominent heading
      const h1 = document.querySelector('h1')
      const productName = h1?.textContent?.trim() || ''

      // Brand — usually linked near the product name
      const brandLink = document.querySelector('a[href*="/en/brands/"]')
      const brandName = brandLink?.textContent?.trim() || ''

      // Rating
      let rating: number | null = null
      const ratingEls = document.querySelectorAll('[class*="rating"], [class*="score"], [class*="star"]')
      ratingEls.forEach(el => {
        const text = el.textContent?.trim() || ''
        const match = text.match(/(\d\.\d{1,2})/)
        if (match && !rating) {
          const val = parseFloat(match[1])
          if (val >= 0 && val <= 5) rating = val
        }
      })

      // Review count
      let reviewCount: number | null = null
      const allText = document.body.textContent || ''
      const reviewMatch = allText.match(/(\d[\d,]+)\s*(?:reviews?|ratings?)/i)
      if (reviewMatch) {
        reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''))
      }

      // Price
      let price: string | null = null
      const priceEls = document.querySelectorAll('[class*="price"], [class*="Price"]')
      priceEls.forEach(el => {
        const text = el.textContent?.trim() || ''
        if (/\$|USD|₩/.test(text) && !price) price = text
      })

      // Volume
      let volume: string | null = null
      const volMatch = allText.match(/(\d+\s*(?:ml|mL|g|oz|fl\.?\s*oz))/i)
      if (volMatch) volume = volMatch[1]

      // Ingredients — Hwahae typically shows ingredients in a list
      const ingredientsRaw: string[] = []
      const ingredientSections = document.querySelectorAll(
        '[class*="ingredient"], [class*="Ingredient"], [data-testid*="ingredient"]'
      )

      ingredientSections.forEach(section => {
        // Look for individual ingredient items
        const items = section.querySelectorAll('li, span, div')
        items.forEach(item => {
          const text = item.textContent?.trim()
          if (text && text.length > 2 && text.length < 200 && !text.includes('\n')) {
            ingredientsRaw.push(text)
          }
        })

        // Fallback: get full text and split by comma
        if (ingredientsRaw.length === 0) {
          const fullText = section.textContent?.trim() || ''
          if (fullText.includes(',')) {
            fullText.split(',').forEach(i => {
              const trimmed = i.trim()
              if (trimmed.length > 1) ingredientsRaw.push(trimmed)
            })
          }
        }
      })

      // Skin type ratings — Hwahae shows how different skin types rate the product
      const skinTypeRatings: Record<string, number> = {}
      const skinTypeLabels = ['dry', 'oily', 'combination', 'sensitive', 'acne']
      const skinSections = document.querySelectorAll('[class*="skin"], [class*="Skin"]')
      skinSections.forEach(section => {
        skinTypeLabels.forEach(type => {
          const regex = new RegExp(type + '[\\s:]*([\\d.]+)', 'i')
          const match = section.textContent?.match(regex)
          if (match) skinTypeRatings[type] = parseFloat(match[1])
        })
      })

      // Awards/badges
      const awards: string[] = []
      const awardEls = document.querySelectorAll('[class*="award"], [class*="badge"], [class*="Award"], [class*="Badge"]')
      awardEls.forEach(el => {
        const text = el.textContent?.trim()
        if (text && text.length < 100) awards.push(text)
      })

      // Concerns/tags
      const concerns: string[] = []
      const tagEls = document.querySelectorAll('[class*="tag"], [class*="concern"], [class*="category"]')
      tagEls.forEach(el => {
        const text = el.textContent?.trim()?.toLowerCase()
        if (text && ['hydration', 'soothing', 'brightening', 'anti-aging', 'pore', 'acne', 'exfoliation', 'moisturizing'].some(c => text.includes(c))) {
          concerns.push(text)
        }
      })

      // Image
      const mainImg = document.querySelector('img[class*="product"], img[class*="Product"], img[alt*="product"]')
        || document.querySelector('main img')
      const imageUrl = mainImg?.getAttribute('src') || null

      return {
        productName,
        brandName,
        rating,
        reviewCount,
        price,
        volume,
        ingredients: ingredientsRaw,
        ingredientsRaw: ingredientsRaw.join(', '),
        skinTypeRatings: Object.keys(skinTypeRatings).length > 0 ? skinTypeRatings : null,
        concerns,
        awards,
        imageUrl,
      }
    })

    if (!data || !data.productName) return null

    // Extract source product ID from URL
    const idMatch = productUrl.match(/\/(\d+)(?:\?|$)/)

    return {
      ...data,
      sourceUrl: productUrl,
      sourceProductId: idMatch?.[1] || '',
    }
  } catch (err: any) {
    console.error(`[hwahae] Failed to scrape ${productUrl}: ${err.message}`)
    return null
  }
}
