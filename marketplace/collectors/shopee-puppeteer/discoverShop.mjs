/**
 * Live Shopee Mall shop_username discovery via Puppeteer.
 * Requires warm session cookies (same as SERP collect).
 */

import {
  cardsFromSearchPayload,
  detectSessionHealth,
} from '../../shopee/parseSearch.mjs'
import {
  parseShopeeShopUsername,
  shopeeSearchUrl,
  shopeeShopByIdUrl,
  shopeeShopUrl,
  sanitizeShopUsername,
} from '../../shopee/urls.mjs'
import {
  discoverySearchQueries,
  pickMallShopDiscovery,
} from '../../discoverMallShop.mjs'
import { heuristicShopUsernameCandidates } from '../../resolveShopUsername.mjs'
import { loadShopeeSessionCookies } from './adapter.mjs'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function humanDelay(min = 600, max = 1400) {
  return sleep(Math.floor(Math.random() * (max - min + 1)) + min)
}

/**
 * Extract shop profile hrefs from current page DOM.
 * @param {any} page
 */
async function extractShopLinksFromDom(page) {
  return page.evaluate(() => {
    const out = []
    const anchors = Array.from(document.querySelectorAll('a[href]'))
    for (const a of anchors) {
      const href = a.getAttribute('href') || ''
      if (!href || href.includes('-i.') || href.includes('/product/')) continue
      // shop/{id} or bare /username
      if (/\/shop\/\d+/.test(href) || /^\/[a-zA-Z0-9._-]{2,64}(\?|$)/.test(href)) {
        out.push({
          href,
          text: (a.textContent || '').trim().slice(0, 120),
        })
      }
    }
    return out
  })
}

/**
 * Resolve numeric shop_id → username via /shop/{id} redirect.
 * @param {any} page
 * @param {string} shopId
 * @param {string} country
 */
async function resolveUsernameFromShopId(page, shopId, country) {
  const url = shopeeShopByIdUrl(shopId, country)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await humanDelay(800, 1600)
    const finalUrl = page.url()
    let username = parseShopeeShopUsername(finalUrl)
    if (username && username !== 'shop') return { username, finalUrl, method: 'shop_id_redirect' }

    // Path may stay /shop/123 — try meta / JSON in page
    const fromDom = await page.evaluate(() => {
      const m = document.body?.innerText?.match(/shopee\.[a-z.]+\/([a-zA-Z0-9._-]{3,64})/)
      return m ? m[1] : null
    })
    username = sanitizeShopUsername(fromDom || '')
    if (username) return { username, finalUrl, method: 'shop_id_dom' }
    return { username: null, finalUrl, method: 'shop_id_failed' }
  } catch (e) {
    return { username: null, finalUrl: null, method: 'shop_id_error', error: e?.message }
  }
}

/**
 * Probe heuristic username: load storefront, require non-captcha + brand-ish content.
 * @param {any} page
 * @param {string} username
 * @param {string} displayName
 * @param {string} country
 */
async function probeHeuristicUsername(page, username, displayName, country) {
  const url = shopeeShopUrl(username, country)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 })
    await humanDelay(700, 1400)
    const title = await page.title()
    const pageUrl = page.url()
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || '')
    const health = detectSessionHealth({ title, bodyText, url: pageUrl })
    if (health !== 'ok') return { ok: false, health, username }

    // Soft signals of a real shop (not 404)
    const dead =
      /page not found|shop is not available|doesn't exist|找不到/i.test(bodyText) ||
      /page not found/i.test(title)
    if (dead) return { ok: false, reason: 'not_found', username }

    const tokens = String(displayName || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
    const blob = `${title} ${bodyText}`.toLowerCase()
    const hits = tokens.filter((t) => blob.includes(t)).length
    const nameScore = tokens.length ? hits / tokens.length : 0
    const parsed = parseShopeeShopUsername(pageUrl) || username

    return {
      ok: nameScore >= 0.35 || /official|mall|brand/i.test(blob),
      username: parsed,
      nameScore,
      pageUrl,
      method: 'heuristic_probe',
    }
  } catch (e) {
    return { ok: false, reason: e?.message, username }
  }
}

/**
 * Discover Mall shop_username for one brand.
 *
 * @param {{
 *   display_name: string
 *   brand_key?: string
 *   country?: string
 *   max_pages?: number
 *   probe_heuristics?: boolean
 *   auto_confirm?: boolean
 * }} brand
 * @param {{ getBrowser: Function, createStealthPage: Function }} browserApi
 */
export async function discoverMallShopWithPuppeteer(brand, browserApi) {
  if (!browserApi?.getBrowser || !browserApi?.createStealthPage) {
    throw new Error('discoverMallShopWithPuppeteer requires browser API')
  }

  const country = brand.country || 'sg'
  const display = brand.display_name
  const maxPages = Math.min(Math.max(brand.max_pages ?? 1, 1), 2)
  const browser = await browserApi.getBrowser()
  const page = await browserApi.createStealthPage(browser)

  /** @type {any[]} */
  const apiPayloads = []
  /** @type {any[]} */
  const allCards = []
  /** @type {Record<string, string>} */
  const usernameByShopId = {}

  const onResponse = async (response) => {
    try {
      const url = response.url()
      if (!/search|item/i.test(url)) return
      if (!/search_items|v4\/search|v2\/search|item/i.test(url)) return
      const ct = (response.headers()['content-type'] || '').toLowerCase()
      if (ct && !ct.includes('json')) return
      const json = await response.json().catch(() => null)
      if (json) apiPayloads.push(json)
    } catch {
      /* ignore */
    }
  }

  page.on('response', onResponse)

  try {
    const cookies = loadShopeeSessionCookies(country)
    if (cookies.length) await page.setCookie(...cookies)

    const interactiveOn =
      process.env.SHOPEE_INTERACTIVE === '1' || Number(process.env.SHOPEE_CAPTCHA_WAIT_MS || 0) > 0

    const queries = discoverySearchQueries(display)
    for (const q of queries) {
      for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
        const url = shopeeSearchUrl(q, country, pageIdx)
        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
        } catch {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
        }
        await humanDelay(1200, 2200)
        await page.evaluate(() => window.scrollBy(0, 1000))
        await humanDelay(600, 1200)

        const title = await page.title()
        const pageUrl = page.url()
        const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 1200) || '')
        const health = detectSessionHealth({ title, bodyText, url: pageUrl })
        if (health !== 'ok') {
          if (interactiveOn) {
            console.error(`[discover] health=${health} — fix captcha in browser window…`)
            await sleep(Number(process.env.SHOPEE_CAPTCHA_WAIT_MS || 120000))
          } else {
            return {
              ok: false,
              status: 'failed',
              error: `session_health=${health}`,
              session_health: health,
              evidence: { query: q },
            }
          }
        }

        const payloads = apiPayloads.splice(0, apiPayloads.length)
        for (const payload of payloads) {
          const mapped = cardsFromSearchPayload(payload, {
            query: q,
            country,
            rankOffset: allCards.length,
          })
          for (const c of mapped) {
            if (allCards.some((x) => x.shop_id === c.shop_id && x.item_id === c.item_id)) continue
            allCards.push(c)
          }
        }

        // DOM shop links
        const links = await extractShopLinksFromDom(page)
        for (const link of links) {
          const href = link.href.startsWith('http')
            ? link.href
            : `https://shopee.${country === 'sg' ? 'sg' : country}${link.href.startsWith('/') ? '' : '/'}${link.href}`
          const shopIdMatch = href.match(/\/shop\/(\d+)/)
          if (shopIdMatch) {
            // resolve later
            continue
          }
          const u = parseShopeeShopUsername(href)
          if (u && link.text) {
            // attach to matching card by text if possible
            const card = allCards.find(
              (c) =>
                c.shop_name &&
                link.text.toLowerCase().includes(String(c.shop_name).toLowerCase().slice(0, 8)),
            )
            if (card) {
              card.shop_url = shopeeShopUrl(u, country)
              card.signals = { ...(card.signals || {}), shop_username: u }
              card.raw = { ...(card.raw || {}), shop_username: u }
            }
          }
        }
      }

      // Early exit if we already have a strong pick with username
      const early = pickMallShopDiscovery(allCards, {
        display_name: display,
        brand_key: brand.brand_key,
        country,
        username_by_shop_id: usernameByShopId,
        auto_confirm: brand.auto_confirm !== false,
      })
      if (early.ok) {
        return { ...early, cards_seen: allCards.length, queries_tried: queries }
      }
    }

    // Resolve top mall shop_ids via /shop/{id}
    const rankedIds = [
      ...new Set(
        allCards
          .filter((c) => {
            const t = String(c.seller_type || '')
            return (
              t === 'mall' ||
              t === 'official_brand' ||
              c.signals?.is_official_shop ||
              c.raw?.is_official_shop
            )
          })
          .map((c) => String(c.shop_id))
          .filter(Boolean),
      ),
    ].slice(0, 5)

    for (const shopId of rankedIds) {
      if (usernameByShopId[shopId]) continue
      const res = await resolveUsernameFromShopId(page, shopId, country)
      if (res.username) {
        usernameByShopId[shopId] = res.username
        // stamp onto cards
        for (const c of allCards) {
          if (String(c.shop_id) === shopId) {
            c.shop_url = shopeeShopUrl(res.username, country)
            c.signals = { ...(c.signals || {}), shop_username: res.username }
            c.raw = { ...(c.raw || {}), shop_username: res.username }
          }
        }
      }
      await humanDelay(1000, 2000)
    }

    let picked = pickMallShopDiscovery(allCards, {
      display_name: display,
      brand_key: brand.brand_key,
      country,
      username_by_shop_id: usernameByShopId,
      auto_confirm: brand.auto_confirm !== false,
    })

    if (picked.ok) {
      return { ...picked, cards_seen: allCards.length, username_by_shop_id: usernameByShopId }
    }

    // Heuristic probe as last resort → candidate only
    if (brand.probe_heuristics !== false) {
      const candidates = heuristicShopUsernameCandidates(display, { country }).slice(0, 6)
      for (const cand of candidates) {
        const probe = await probeHeuristicUsername(page, cand, display, country)
        if (probe.ok && probe.username) {
          return {
            ok: true,
            status: 'candidate', // never auto-confirm heuristics
            source: 'heuristic',
            shop_username: probe.username,
            shop_url: shopeeShopUrl(probe.username, country),
            shop_id: null,
            evidence: {
              method: probe.method,
              nameScore: probe.nameScore,
              pageUrl: probe.pageUrl,
              display_name: display,
              brand_key: brand.brand_key,
              resolved_at: new Date().toISOString(),
            },
            cards_seen: allCards.length,
          }
        }
        await humanDelay(800, 1500)
      }
    }

    return {
      ...picked,
      cards_seen: allCards.length,
      username_by_shop_id: usernameByShopId,
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

export default discoverMallShopWithPuppeteer
