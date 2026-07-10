/**
 * Optional Cloudflare Browser Rendering collector (REST /content).
 * collector_id: cloudflare_browser_run
 *
 * Env:
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_API_TOKEN   (Browser Rendering - Edit)
 *
 * Uses rendered HTML + DOM-ish regex extraction; less rich than puppeteer
 * network intercept but suitable for cloud workers without Chrome binaries.
 */

import { cardsFromDomRows, detectSessionHealth } from '../../shopee/parseSearch.mjs'
import { shopeeSearchUrl } from '../../shopee/urls.mjs'
import { parseShopeeItemIds } from '../../shopee/urls.mjs'

/**
 * @param {string} html
 * @returns {Array<Record<string, unknown>>}
 */
export function extractCardsFromHtml(html) {
  if (!html) return []
  const rows = []
  const re = /href="([^"]*-i\.\d+\.\d+[^"]*)"/g
  const seen = new Set()
  let m
  while ((m = re.exec(html)) !== null) {
    const href = m[1].replace(/&amp;/g, '&')
    const ids = parseShopeeItemIds(href)
    if (!ids) continue
    const key = `${ids.shop_id}:${ids.item_id}`
    if (seen.has(key)) continue
    seen.add(key)

    // Best-effort title near the link
    const slice = html.slice(Math.max(0, m.index - 50), m.index + 400)
    const titleMatch =
      slice.match(/data-sqe="name"[^>]*>([^<]+)/i) ||
      slice.match(/alt="([^"]{8,200})"/i)
    const title = titleMatch ? titleMatch[1].trim() : `Item ${ids.item_id}`

    const priceMatch = slice.match(/(?:S\$|\$)\s*([0-9]+(?:\.[0-9]+)?)/)
    const soldMatch = slice.match(/([0-9.]+[kKmM]?\+?)\s*sold/i)
    const isMall = /mall/i.test(slice)
    const isPreferredPlus = /preferred\+/i.test(slice)
    const isPreferred = /preferred/i.test(slice) && !isPreferredPlus

    rows.push({
      href,
      title,
      priceText: priceMatch ? priceMatch[0] : '',
      soldText: soldMatch ? `${soldMatch[1]} sold` : '',
      isMall,
      isPreferred,
      isPreferredPlus,
    })
  }
  return rows
}

/**
 * @param {import('../types.mjs').CollectSeedInput} seed
 * @param {string} jobId
 */
export async function scrapeShopeeWithCloudflare(seed, jobId) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || ''
  const token = process.env.CLOUDFLARE_API_TOKEN || ''
  if (!accountId || !token) {
    throw new Error(
      'cloudflare_browser_run requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN',
    )
  }

  const country = seed.country || 'sg'
  const maxPages = Math.min(Math.max(seed.max_pages || 1, 1), 5)
  const maxListings = Math.min(Math.max(seed.max_listings || 40, 1), 200)
  /** @type {any[]} */
  const allCards = []

  for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
    if (allCards.length >= maxListings) break
    const url = shopeeSearchUrl(seed.target, country, pageIdx)
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/content`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: 'networkidle0', timeout: 45000 },
      }),
    })

    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.success === false) {
      const msg =
        body?.errors?.[0]?.message ||
        body?.messages?.[0] ||
        `Cloudflare Browser Rendering HTTP ${res.status}`
      throw new Error(String(msg))
    }

    const html = typeof body.result === 'string' ? body.result : body.result?.html || ''
    const health = detectSessionHealth({
      bodyText: html.slice(0, 3000),
      url,
      title: '',
    })
    if (health !== 'ok') {
      return { cards: allCards, session_health: health, details: [] }
    }

    const domRows = extractCardsFromHtml(html)
    const mapped = cardsFromDomRows(domRows, {
      query: seed.target,
      country,
      rankOffset: allCards.length,
    })
    for (const c of mapped) {
      if (allCards.length >= maxListings) break
      if (allCards.some((x) => x.shop_id === c.shop_id && x.item_id === c.item_id)) continue
      allCards.push({
        ...c,
        raw: { ...(c.raw || {}), job_id: jobId, seed_id: seed.id, source: 'cloudflare_content' },
      })
    }

    if (mapped.length === 0 && pageIdx === 0) break
  }

  return {
    cards: allCards.slice(0, maxListings),
    session_health: 'ok',
    details: [],
  }
}

/** @type {import('../types.mjs').CollectAdapter} */
export const cloudflareBrowserRunAdapter = {
  id: 'cloudflare_browser_run',

  async scrapeSeed(seed, jobId) {
    return scrapeShopeeWithCloudflare(seed, jobId)
  },
}

export default cloudflareBrowserRunAdapter
