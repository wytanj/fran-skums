import type { Page } from 'puppeteer'
import { humanDelay, parsePrice, convertToSGD } from './base'

// ── Olive Young Category Configuration ──────────────────────

export const OLIVEYOUNG_SKINCARE_CATEGORIES = [
  { id: 'moisturizers', label: 'Moisturizers', ctgrNo: '1000000009' },
  { id: 'cleansers',    label: 'Cleansers',    ctgrNo: '1000000010' },
  { id: 'serums',       label: 'Serums',       ctgrNo: '1000000011' },
  { id: 'toners',       label: 'Toners',       ctgrNo: '1000000012' },
  { id: 'eye_care',     label: 'Eye Care',     ctgrNo: '1000000013' },
  { id: 'lip_care',     label: 'Lip Care',     ctgrNo: '1000000014' },
]

export const OLIVEYOUNG_MAKEUP_CATEGORIES = [
  { id: 'face_makeup', label: 'Face Makeup',  ctgrNo: '1000000015' },
  { id: 'eye_makeup',  label: 'Eye Makeup',   ctgrNo: '1000000016' },
  { id: 'lip_makeup',  label: 'Lip Makeup',   ctgrNo: '1000000017' },
]

export const OLIVEYOUNG_EXTRA_CATEGORIES = [
  { id: 'masks',       label: 'Face Masks',   ctgrNo: '1000000018' },
  { id: 'suncare',     label: 'Sun Care',     ctgrNo: '1000000019' },
]

const OY_BASE = 'https://global.oliveyoung.com'

// ── Types ───────────────────────────────────────────────────

export interface OliveYoungListProduct {
  productName: string
  brandName: string
  price: number | null
  currency: string
  originalPrice: number | null
  rating: number | null
  reviewCount: number | null
  productUrl: string
  sourceProductId: string
  imageUrl: string | null
}

export interface OliveYoungProductDetail {
  productName: string
  brandName: string
  price: number | null
  currency: string
  originalPrice: number | null
  rating: number | null
  reviewCount: number | null
  volume: string | null
  ingredients: string[]
  ingredientsRaw: string
  concerns: string[]
  imageUrl: string | null
  sourceUrl: string
  sourceProductId: string
}

// ── Category Page Scraper ───────────────────────────────────

export async function scrapeOliveYoungCategory(
  page: Page,
  ctgrNo: string,
  maxPages: number = 5
): Promise<OliveYoungListProduct[]> {
  const allProducts: OliveYoungListProduct[] = []
  const seenIds = new Set<string>()

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const url = `${OY_BASE}/display/category?ctgrNo=${ctgrNo}&pageNo=${pageNum}&rowsPerPage=48`

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await humanDelay(2000, 4000)

    // Wait for products to render (SPA)
    await page.waitForSelector('a[href*="/product/detail"], [class*="product"], [class*="prd"]', { timeout: 15000 }).catch(() => null)

    // Scroll to load lazy content
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 800))
      await humanDelay(500, 1000)
    }

    const products = await page.evaluate(() => {
      const items: any[] = []

      // Badge words to strip from product names
      const BADGE_WORDS = /^(BEST|NEW|HOT|SALE|SOLD\s*OUT|#\d+|RANK\s*\d+|\d+)\s*/i

      // Clean product name: strip badge prefixes and excessive whitespace
      function cleanName(raw: string): string {
        let name = raw.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
        // Strip leading badge words (may appear multiple times)
        for (let i = 0; i < 3; i++) {
          const before = name
          name = name.replace(BADGE_WORDS, '').trim()
          if (name === before) break
        }
        return name
      }

      // Find product cards — Olive Young uses various selectors
      const productEls = document.querySelectorAll(
        'a[href*="/product/detail"], [class*="prd-item"], [class*="product-item"], li[class*="item"]'
      )

      productEls.forEach(el => {
        // Find the link
        const link = el.tagName === 'A' ? el : el.querySelector('a[href*="/product/detail"]')
        if (!link) return

        const href = link.getAttribute('href') || ''
        // Extract product ID: prdtNo=GA260237807
        const idMatch = href.match(/prdtNo=([A-Z0-9]+)/i)
        if (!idMatch) return

        const card = link.closest('li, div[class*="item"], article') || link

        // Brand — OY uses .brandName or [class*="brandName"]
        const brandEl = card.querySelector('.brandName, [class*="brandName"], [class*="brand-name"], [class*="brand"]')
        const brandName = brandEl?.textContent?.trim() || ''

        // Product name — OY uses .prdtName or [class*="prdtName"]
        // Try OY-specific selectors first, then generic fallbacks
        const nameEl = card.querySelector('.prdtName, [class*="prdtName"], [class*="prd-name"]')
          || card.querySelector('[class*="product-name"], [class*="productName"]')
        let productName = ''

        if (nameEl) {
          productName = cleanName(nameEl.textContent || '')
        }

        // Fallback: find the longest meaningful text node that isn't a badge/brand/price
        if (!productName || productName.length < 3) {
          const allTextEls = card.querySelectorAll('span, p, div, a')
          let longestText = ''
          allTextEls.forEach(te => {
            const text = (te.textContent || '').trim()
            // Skip short badge text, prices, brand duplicates
            if (text.length < 5) return
            if (/^[S$₩\d.,\s]+$/.test(text)) return // price-like
            if (text === brandName) return
            if (/^(BEST|NEW|HOT|SALE)$/i.test(text)) return
            if (text.length > longestText.length) longestText = text
          })
          productName = cleanName(longestText)
        }

        // Price — OY uses calcSaleAmtFmt / calcNrmlAmtFmt
        const priceEl = card.querySelector('[class*="SaleAmt"], [class*="saleAmt"], [class*="price"], [class*="Price"]')
        const priceText = priceEl?.textContent?.trim() || ''

        // Original price (strikethrough)
        const origPriceEl = card.querySelector('[class*="NrmlAmt"], [class*="nrmlAmt"], [class*="origin"], del, s')
        const origPriceText = origPriceEl?.textContent?.trim() || ''

        // Rating
        const ratingEl = card.querySelector('[class*="rating"], [class*="star"], [class*="score"]')
        const ratingText = ratingEl?.textContent?.trim() || ''

        // Review count
        const reviewEl = card.querySelector('[class*="review"], [class*="count"]')
        const reviewText = reviewEl?.textContent?.trim() || ''

        // Image
        const img = card.querySelector('img')
        const imageUrl = img?.getAttribute('src') || img?.getAttribute('data-src') || null

        items.push({
          productName: productName.slice(0, 500),
          brandName,
          priceText,
          origPriceText,
          ratingText,
          reviewText,
          productUrl: href.startsWith('http') ? href : `https://global.oliveyoung.com${href}`,
          sourceProductId: idMatch[1],
          imageUrl,
        })
      })

      return items
    })

    for (const p of products) {
      if (seenIds.has(p.sourceProductId)) continue
      seenIds.add(p.sourceProductId)

      const priceInfo = parsePrice(p.priceText)
      const origInfo = parsePrice(p.origPriceText)

      // Parse rating: "4.8" or "(4.8)"
      let rating: number | null = null
      const ratingMatch = p.ratingText.match(/(\d\.\d)/)
      if (ratingMatch) rating = parseFloat(ratingMatch[1])

      // Parse review count
      let reviewCount: number | null = null
      const revMatch = p.reviewText.match(/([\d,]+)/)
      if (revMatch) reviewCount = parseInt(revMatch[1].replace(/,/g, ''))

      allProducts.push({
        productName: p.productName,
        brandName: p.brandName,
        price: priceInfo ? convertToSGD(priceInfo.amount, priceInfo.currency) : null,
        currency: 'SGD',
        originalPrice: origInfo ? convertToSGD(origInfo.amount, origInfo.currency) : null,
        rating,
        reviewCount,
        productUrl: p.productUrl,
        sourceProductId: p.sourceProductId,
        imageUrl: p.imageUrl,
      })
    }

    // If no new products found, stop pagination
    if (products.length === 0) break

    await humanDelay(2000, 4000)
  }

  return allProducts
}

// ── Product Detail Page Scraper ─────────────────────────────

export async function scrapeOliveYoungProductDetail(
  page: Page,
  productUrl: string
): Promise<OliveYoungProductDetail | null> {
  try {
    // Ensure URL includes the base
    const fullUrl = productUrl.startsWith('http') ? productUrl : `${OY_BASE}${productUrl}`

    await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await humanDelay(2000, 3000)

    // Scroll to load ingredients section (usually below fold)
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 600))
      await humanDelay(500, 1000)
    }

    // Click on "Ingredients" tab if it exists
    await page.evaluate(() => {
      const tabs = document.querySelectorAll('button, a, [role="tab"]')
      tabs.forEach(tab => {
        if (tab.textContent?.toLowerCase().includes('ingredient')) {
          (tab as HTMLElement).click()
        }
      })
    })
    await humanDelay(1000, 2000)

    const data = await page.evaluate(() => {
      const getText = (sel: string): string => {
        const el = document.querySelector(sel)
        return el?.textContent?.trim() || ''
      }

      // Product name — OY detail uses .prdtName or h1
      const productName = getText('.prdtName')
        || getText('[class*="prdtName"]')
        || getText('h1')
        || getText('[class*="product-name"], [class*="prd-name"]')

      // Brand — OY detail uses .brandName or brand link
      const brandEl = document.querySelector('.brandName, [class*="brandName"], a[href*="/display/brand"], [class*="brand-name"]')
      const brandName = brandEl?.textContent?.trim() || ''

      // Price — OY uses calcSaleAmtFmt
      let priceText = ''
      const priceEls = document.querySelectorAll('[class*="SaleAmt"], [class*="saleAmt"], [class*="final"], [class*="sale"], [class*="price"]')
      priceEls.forEach(el => {
        const text = el.textContent?.trim() || ''
        if (/[S$]/.test(text) && !priceText) priceText = text
      })

      // Original price
      let origPriceText = ''
      const origEl = document.querySelector('del, s, [class*="origin"], [class*="before"]')
      if (origEl) origPriceText = origEl.textContent?.trim() || ''

      // Rating
      let ratingText = ''
      const ratingEls = document.querySelectorAll('[class*="rating"], [class*="star"], [class*="score"]')
      ratingEls.forEach(el => {
        const text = el.textContent?.trim() || ''
        const match = text.match(/(\d\.\d)/)
        if (match && !ratingText) ratingText = match[1]
      })

      // Review count
      let reviewCountText = ''
      const body = document.body.textContent || ''
      const revMatch = body.match(/([\d,]+)\s*(?:reviews?|ratings?)/i)
      if (revMatch) reviewCountText = revMatch[1]

      // Volume
      let volume: string | null = null
      const volMatch = body.match(/(\d+\s*(?:ml|mL|g|oz|fl\.?\s*oz))/i)
      if (volMatch) volume = volMatch[1]

      // Ingredients — OY shows INCI list in a specific section
      const ingredientsRaw: string[] = []

      // Known INCI marker words — a real ingredient list will contain several of these
      const INCI_MARKERS = [
        'water', 'aqua', 'glycerin', 'butylene glycol', 'niacinamide', 'dimethicone',
        'phenoxyethanol', 'sodium hyaluronate', 'tocopherol', 'carbomer', 'xanthan gum',
        'disodium edta', 'cetearyl alcohol', 'stearic acid', 'panthenol', 'allantoin',
        'propanediol', 'ethylhexylglycerin', 'hydroxyethyl acrylate', 'caprylyl glycol',
        'betaine', 'squalane', 'centella asiatica', 'arginine', 'adenosine',
      ]

      // Validate that a text block looks like an INCI list, not a review or article
      function looksLikeINCI(text: string): boolean {
        const lower = text.toLowerCase()
        // Must contain commas
        const commaCount = (text.match(/,/g) || []).length
        if (commaCount < 5) return false
        // Must match at least 3 known INCI marker words
        const markerHits = INCI_MARKERS.filter(m => lower.includes(m)).length
        if (markerHits < 3) return false
        // Should NOT contain sentence patterns (reviews have periods + capital letters)
        const sentenceCount = (text.match(/\.\s+[A-Z]/g) || []).length
        if (sentenceCount > 2) return false
        // Should NOT contain common review/research phrases
        if (/\b(I love|I use|my skin|this product|study|research|clinical|percent|results showed)\b/i.test(text)) return false
        return true
      }

      function parseINCI(text: string): string[] {
        return text.split(',').map(i => {
          return i.trim()
            .replace(/^[\d.]+\s*/, '')       // Remove leading numbers
            .replace(/\s*\(.*?\)\s*$/, '')   // Remove trailing parenthetical
            .replace(/^\s*-\s*/, '')          // Remove leading dashes
        }).filter(i => i.length > 1 && i.length < 150)
      }

      // Strategy 1: Look for OY-specific ingredient section
      const ingrSections = document.querySelectorAll(
        '[class*="ingredient" i], [id*="ingredient" i], [data-tab*="ingredient" i]'
      )

      for (const section of Array.from(ingrSections)) {
        if (ingredientsRaw.length > 0) break
        const text = section.textContent?.trim() || ''
        if (looksLikeINCI(text)) {
          ingredientsRaw.push(...parseINCI(text))
        }
      }

      // Strategy 2: Find a compact text block that looks like INCI
      // Look at leaf-level elements to avoid grabbing entire page sections
      if (ingredientsRaw.length === 0) {
        const candidates = document.querySelectorAll('p, span, dd, td')
        for (const el of Array.from(candidates)) {
          const text = el.textContent?.trim() || ''
          if (text.length < 50 || text.length > 8000) continue
          // Skip if this element has many child block elements (it's a container, not a leaf)
          if (el.querySelectorAll('p, div, li, h1, h2, h3, h4').length > 2) continue
          if (looksLikeINCI(text)) {
            ingredientsRaw.push(...parseINCI(text))
            break
          }
        }
      }

      // Concerns/tags
      const concerns: string[] = []
      const tagEls = document.querySelectorAll('[class*="tag"], [class*="benefit"], [class*="concern"], [class*="category"]')
      tagEls.forEach(el => {
        const text = el.textContent?.trim()?.toLowerCase()
        if (text && text.length < 50) concerns.push(text)
      })

      // Image
      const mainImg = document.querySelector('[class*="product-img"] img, [class*="prd-img"] img, [class*="thumb"] img')
        || document.querySelector('main img, .product img')
      const imageUrl = mainImg?.getAttribute('src') || null

      return {
        productName,
        brandName,
        priceText,
        origPriceText,
        ratingText,
        reviewCountText,
        volume,
        ingredients: ingredientsRaw,
        ingredientsRaw: ingredientsRaw.join(', '),
        concerns,
        imageUrl,
      }
    })

    if (!data || !data.productName) return null

    const priceInfo = parsePrice(data.priceText)
    const origInfo = parsePrice(data.origPriceText)
    const idMatch = productUrl.match(/prdtNo=([A-Z0-9]+)/i)

    return {
      productName: data.productName,
      brandName: data.brandName,
      price: priceInfo ? convertToSGD(priceInfo.amount, priceInfo.currency) : null,
      currency: 'SGD',
      originalPrice: origInfo ? convertToSGD(origInfo.amount, origInfo.currency) : null,
      rating: data.ratingText ? parseFloat(data.ratingText) : null,
      reviewCount: data.reviewCountText ? parseInt(data.reviewCountText.replace(/,/g, '')) : null,
      volume: data.volume,
      ingredients: data.ingredients,
      ingredientsRaw: data.ingredientsRaw,
      concerns: data.concerns,
      imageUrl: data.imageUrl,
      sourceUrl: productUrl,
      sourceProductId: idMatch?.[1] || '',
    }
  } catch (err: any) {
    console.error(`[oliveyoung] Failed to scrape ${productUrl}: ${err.message}`)
    return null
  }
}
