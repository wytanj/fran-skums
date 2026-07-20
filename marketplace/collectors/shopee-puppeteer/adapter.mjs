/**
 * Shopee keyword SERP collector via Puppeteer (local / long-running worker).
 * Optional session cookies from SHOPEE_SG_SESSION_JSON.
 *
 * collector_id: shopee_puppeteer
 *
 * Prefer calling scrapeShopeeWithPuppeteer(seed, jobId, browserApi) from the
 * server job runner so browser-manager is resolved by Nitro/TS.
 */

import { parseSoldLabel } from '../../soldLabel.mjs'
import {
  cardsFromDomRows,
  cardsFromSearchPayload,
  detectSessionHealth,
} from '../../shopee/parseSearch.mjs'
import { shopeeSearchUrl, shopeeShopUrl } from '../../shopee/urls.mjs'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function humanDelay(min = 800, max = 1800) {
  return sleep(Math.floor(Math.random() * (max - min + 1)) + min)
}

/**
 * Pause so a human can clear Shopee captcha/traffic walls in the open browser.
 * - TTY: poll until healthy, or until Enter is pressed (whichever first, max wait).
 * - Non-TTY: timed wait only.
 * - SHOPEE_FORCE_MANUAL_WAIT=1: always wait for Enter (or deadline), even if page looks "ok".
 *   Use this for profile smoke — homepage often scores "ok" and the window races closed.
 * @param {any} page
 * @param {string} label
 */
async function waitForManualUnblock(page, label = 'page') {
  const interactiveMs = Number(process.env.SHOPEE_CAPTCHA_WAIT_MS || 0)
  const waitMs = interactiveMs > 0 ? interactiveMs : 180_000
  const canStdin = Boolean(process.stdin.isTTY)
  const forceWait = process.env.SHOPEE_FORCE_MANUAL_WAIT === '1'

  const snapshot = async () => {
    const title = await page.title()
    const url = page.url()
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 1500) || '')
    return { title, url, bodyText, health: detectSessionHealth({ title, bodyText, url }) }
  }

  let snap = await snapshot()
  console.error(
    `[shopee_puppeteer] ${label} health=${snap.health} url=${snap.url.slice(0, 140)}`,
  )

  // Default path: skip pause when page already looks healthy.
  if (!forceWait && snap.health === 'ok' && !snap.url.includes('/verify/')) return snap

  console.error(
    canStdin
      ? `[shopee_puppeteer] ${label}: fix page in Chrome, then press Enter (max ${Math.round(waitMs / 1000)}s)…`
      : `[shopee_puppeteer] ${label}: waiting up to ${Math.round(waitMs / 1000)}s for manual unblock…`,
  )

  let enterPressed = false
  const onData = (buf) => {
    if (String(buf).includes('\n') || String(buf).includes('\r')) enterPressed = true
  }
  if (canStdin) {
    try {
      process.stdin.resume()
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', onData)
    } catch {
      /* ignore */
    }
  }

  const deadline = Date.now() + waitMs
  try {
    while (Date.now() < deadline) {
      if (enterPressed) {
        snap = await snapshot()
        console.error(`[shopee_puppeteer] ${label} enter pressed → health=${snap.health}`)
        break
      }
      await humanDelay(2000, 3000)
      snap = await snapshot()
      // Only auto-continue when not force-wait (force mode requires Enter).
      if (
        !forceWait &&
        snap.health === 'ok' &&
        !snap.url.includes('/verify/')
      ) {
        console.error(`[shopee_puppeteer] ${label} unblocked`)
        break
      }
    }
  } finally {
    if (canStdin) {
      try {
        process.stdin.off('data', onData)
        process.stdin.pause()
      } catch {
        /* ignore */
      }
    }
  }
  return snap
}

/**
 * @returns {Array<{name:string,value:string,domain?:string,path?:string}>}
 */
export function loadShopeeSessionCookies(country = 'sg') {
  const envKey =
    country === 'sg'
      ? 'SHOPEE_SG_SESSION_JSON'
      : `SHOPEE_${String(country).toUpperCase()}_SESSION_JSON`
  const raw = process.env[envKey] || process.env.SHOPEE_SG_SESSION_JSON || ''
  if (!raw.trim()) return []

  try {
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.cookies)
        ? parsed.cookies
        : []
    return list
      .filter((c) => c && c.name && c.value != null)
      .map((c) => ({
        name: String(c.name),
        value: String(c.value),
        domain: c.domain || (country === 'sg' ? '.shopee.sg' : `.shopee.${country}`),
        path: c.path || '/',
      }))
  } catch {
    return []
  }
}

/**
 * Extract listing cards from the live page DOM (fallback when API intercept misses).
 * @param {any} page Puppeteer page
 */
async function extractDomCards(page) {
  return page.evaluate(() => {
    const selectors = [
      '[data-sqe="item"]',
      '.shopee-search-item-result__item',
      '.shop-search-result-view__item',
      'li[data-sqe="item"]',
    ]
    let nodes = []
    for (const sel of selectors) {
      nodes = Array.from(document.querySelectorAll(sel))
      if (nodes.length) break
    }

    return nodes.map((item) => {
      const link =
        item.querySelector('a[href*="-i."], a[href*="/product/"]') || item.querySelector('a')
      const href = link?.getAttribute('href') || ''
      const titleEl =
        item.querySelector('[data-sqe="name"]') ||
        item.querySelector('[class*="name"], [class*="Name"]')
      const title = titleEl?.textContent?.trim() || link?.getAttribute('title') || ''
      const priceEl = item.querySelector('[class*="price"], [class*="Price"]')
      const priceText = priceEl?.textContent?.trim() || ''
      const soldEl = item.querySelector('[class*="sold"], [class*="Sold"]')
      const soldText = soldEl?.textContent?.trim() || ''
      const html = item.innerHTML || ''
      const isMall = /mall/i.test(html) || /Shopee Mall/i.test(html)
      const isPreferredPlus = /preferred\+/i.test(html) || /Preferred\+/i.test(html)
      const isPreferred = /preferred/i.test(html) && !isPreferredPlus
      const isOfficial = /official/i.test(html)
      const locEl = item.querySelector('[class*="location"], [class*="Location"]')
      return {
        href,
        title,
        priceText,
        soldText,
        isMall,
        isPreferred,
        isPreferredPlus,
        isOfficial,
        location: locEl?.textContent?.trim() || '',
      }
    })
  })
}

/**
 * @param {import('../types.mjs').CollectSeedInput} seed
 * @param {string} jobId
 * @param {{ getBrowser: Function, createStealthPage: Function }} browserApi
 * @returns {Promise<import('../types.mjs').CollectResult>}
 */
export async function scrapeShopeeWithPuppeteer(seed, jobId, browserApi) {
  if (!browserApi?.getBrowser || !browserApi?.createStealthPage) {
    throw new Error('scrapeShopeeWithPuppeteer requires getBrowser and createStealthPage')
  }

  const country = seed.country || 'sg'
  const maxPages = Math.min(Math.max(seed.max_pages || 1, 1), 10)
  const maxListings = Math.min(Math.max(seed.max_listings || 40, 1), 200)
  // detail_top_n <= 0 skips product-page navigations (list cards only).
  const detailTopN = Number(seed.detail_top_n ?? 0)
  const mode = seed.mode || 'keyword'
  const isShop = mode === 'shop'
  const shopUsername = isShop
    ? String(seed.target || seed.metadata?.shop_username || '').trim()
    : String(seed.metadata?.shop_username || '').trim() || null

  const browser = await browserApi.getBrowser()
  const page = await browserApi.createStealthPage(browser)

  /** @type {any[]} */
  const apiPayloads = []
  /** @type {any[]} */
  const allCards = []

  const onResponse = async (response) => {
    try {
      const url = response.url()
      // SERP search APIs + shop item list APIs
      const interesting =
        /search_items|v4\/search|v2\/search|shop.*item|get_shop|rcmd_items|search_items/i.test(
          url,
        )
      if (!interesting) return
      const ct = (response.headers()['content-type'] || '').toLowerCase()
      if (ct && !ct.includes('json') && !url.includes('search_items')) return
      const json = await response.json().catch(() => null)
      if (json) apiPayloads.push(json)
    } catch {
      /* ignore */
    }
  }

  page.on('response', onResponse)

  try {
    const cookies = loadShopeeSessionCookies(country)
    if (cookies.length) {
      await page.setCookie(...cookies)
    }

    const interactiveOn =
      process.env.SHOPEE_INTERACTIVE === '1' || Number(process.env.SHOPEE_CAPTCHA_WAIT_MS || 0) > 0
    const skipHome = process.env.SHOPEE_SKIP_HOME === '1'
    const host = country === 'sg' ? 'shopee.sg' : `shopee.${country}`

    if (!skipHome && !isShop) {
      await page.goto(`https://${host}/`, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await humanDelay(1000, 2000)
      if (interactiveOn) {
        await waitForManualUnblock(page, 'home')
      }
    } else if (isShop) {
      console.error(`[shopee_puppeteer] mode=shop username=${shopUsername}`)
    } else {
      console.error('[shopee_puppeteer] SHOPEE_SKIP_HOME=1 — opening search first')
    }

    for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
      if (allCards.length >= maxListings) break

      let url
      if (isShop) {
        if (!shopUsername) {
          return { cards: [], session_health: 'unknown', details: [], error: 'missing_shop_username' }
        }
        // Shop storefront; page index via query when Shopee supports it
        url = shopeeShopUrl(shopUsername, country)
        if (pageIdx > 0) {
          url += (url.includes('?') ? '&' : '?') + `page=${pageIdx}`
        }
      } else {
        url = shopeeSearchUrl(seed.target, country, pageIdx)
      }

      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
      } catch {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      }
      await humanDelay(1500, 3000)

      await page.evaluate(() => window.scrollBy(0, 900))
      await humanDelay(800, 1500)
      await page.evaluate(() => window.scrollBy(0, 900))
      await humanDelay(800, 1200)

      if (interactiveOn) {
        await waitForManualUnblock(page, isShop ? 'shop' : 'serp')
      }

      const title = await page.title()
      const pageUrl = page.url()
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 1500) || '')
      const health = detectSessionHealth({ title, bodyText, url: pageUrl })

      if (health !== 'ok') {
        return {
          cards: allCards.slice(0, maxListings),
          session_health: health,
          details: [],
        }
      }

      const queryLabel = isShop ? `shop:${shopUsername}` : seed.target
      const before = allCards.length
      const payloadsThisPage = apiPayloads.splice(0, apiPayloads.length)
      for (const payload of payloadsThisPage) {
        const mapped = cardsFromSearchPayload(payload, {
          query: queryLabel,
          country,
          rankOffset: allCards.length,
        })
        for (const c of mapped) {
          if (allCards.length >= maxListings) break
          if (allCards.some((x) => x.shop_id === c.shop_id && x.item_id === c.item_id)) continue
          allCards.push(enrichCard(c, { jobId, seed, isShop, shopUsername, source: 'shopee_api' }))
        }
      }

      if (allCards.length === before) {
        const domRows = await extractDomCards(page)
        const mapped = cardsFromDomRows(domRows, {
          query: queryLabel,
          country,
          rankOffset: allCards.length,
        })
        for (const c of mapped) {
          if (allCards.length >= maxListings) break
          if (allCards.some((x) => x.shop_id === c.shop_id && x.item_id === c.item_id)) continue
          if (c.sold_label && c.sold_count_lower_bound == null) {
            const p = parseSoldLabel(c.sold_label)
            c.sold_count_lower_bound = p.lower_bound ?? undefined
          }
          allCards.push(enrichCard(c, { jobId, seed, isShop, shopUsername, source: 'shopee_dom' }))
        }
      }

      if (allCards.length === before && pageIdx === 0) {
        break
      }
    }

    return {
      cards: allCards.slice(0, maxListings),
      session_health: 'ok',
      details: detailTopN > 0 ? [] : [],
    }
  } finally {
    try {
      page.off('response', onResponse)
    } catch {
      /* ignore */
    }
    try {
      await page.close()
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {Record<string, any>} c
 * @param {{ jobId: string, seed: any, isShop: boolean, shopUsername: string | null, source: string }} ctx
 */
function enrichCard(c, ctx) {
  const signals = {
    ...(c.signals || {}),
    ...(ctx.isShop ? { official_shop: true } : {}),
    ...(ctx.shopUsername ? { shop_username: ctx.shopUsername } : {}),
  }
  // Shop storefront listings are Mall/official when mode=shop
  const seller_type = ctx.isShop
    ? c.seller_type === 'normal' || !c.seller_type
      ? 'mall'
      : c.seller_type
    : c.seller_type

  return {
    ...c,
    seller_type,
    signals,
    raw: {
      ...(c.raw || {}),
      job_id: ctx.jobId,
      seed_id: ctx.seed.id,
      source: ctx.source,
      mode: ctx.seed.mode || 'keyword',
      shop_username: ctx.shopUsername,
    },
  }
}

/** @type {import('../types.mjs').CollectAdapter} */
export const shopeePuppeteerAdapter = {
  id: 'shopee_puppeteer',

  async scrapeSeed(_seed, _jobId) {
    throw new Error(
      'shopee_puppeteer.scrapeSeed must be invoked via marketplaceCollect.runCollectJob (injects browser-manager).',
    )
  },
}

export default shopeePuppeteerAdapter
