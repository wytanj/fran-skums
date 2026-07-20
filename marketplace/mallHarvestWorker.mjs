/**
 * MH-2 — All Products Mall harvest (name + sold + shop shelf category).
 *
 * Opens official storefront product lists:
 *   https://shopee.sg/{username}?page=N&sortBy=pop#product_list
 *
 * Uses Puppeteer + warm Chrome userDataDir (same Track G pattern).
 * Writes via harvestToObservationCards → upsertObservationCards.
 */

import { PILOT_BRAND_KEYS } from './brandKey.mjs'
import { shopCollectionListUrl } from './shopCollections.mjs'
import {
  harvestToObservationCards,
  parseShopPageContext,
} from './shopProductExtract.mjs'
import { stampBrandSignalsOnCards } from './stampBrandSignals.mjs'
import { upsertObservationCards } from './writers/upsertObservations.mjs'
import { detectSessionHealth } from './shopee/parseSearch.mjs'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function humanDelay(min = 800, max = 1800) {
  return sleep(Math.floor(Math.random() * (max - min + 1)) + min)
}

/**
 * In-page extract (must stay pure browser JS — no imports).
 * Mirrors extension content.js harvestShopProducts for All Products / collection grids.
 */
export function browserHarvestEvaluate() {
  const shop_username = (() => {
    try {
      const seg = location.pathname.replace(/^\//, '').split('/')[0]
      if (!seg || /search|product|buyer|shop/i.test(seg) || /-i\.\d+\.\d+/.test(seg)) return null
      if (!/^[a-zA-Z0-9._-]{2,64}$/.test(seg)) return null
      return seg.toLowerCase()
    } catch {
      return null
    }
  })()

  const params = new URLSearchParams(location.search)
  const category = (() => {
    const coll = params.get('shopCollection')
    if (!coll) return 'All Products'
    const active =
      document.querySelector('[class*="navbar"] a[href*="shopCollection"].navbar-with-more-menu__item--active span') ||
      document.querySelector('a[href*="shopCollection"][class*="active"] span') ||
      document.querySelector('[aria-selected="true"]')
    const t = active?.textContent?.replace(/\s+/g, ' ').trim()
    return t && t.length < 60 ? t : 'All Products'
  })()

  function parseItemIds(href) {
    const m = String(href).match(/-i\.(\d+)\.(\d+)/) || String(href).match(/\/product\/(\d+)\/(\d+)/)
    return m ? { shop_id: m[1], item_id: m[2] } : null
  }

  function nameFromHref(href) {
    try {
      const path = new URL(href, location.origin).pathname
      const slug = path.split('/').filter(Boolean).pop() || ''
      const base = slug.replace(/-i\.\d+\.\d+$/i, '')
      if (!base) return null
      return decodeURIComponent(base.replace(/-/g, ' ')).replace(/\s+/g, ' ').trim()
    } catch {
      return null
    }
  }

  function soldLower(label) {
    if (!label) return null
    const s = String(label).toLowerCase().replace(/,/g, '')
    const m = s.match(/([\d.]+)\s*([km])?\+?\s*sold/)
    if (!m) return null
    let n = parseFloat(m[1])
    if (!Number.isFinite(n)) return null
    if (m[2] === 'k') n *= 1000
    if (m[2] === 'm') n *= 1e6
    return Math.floor(n)
  }

  const byItem = new Map()
  for (const a of document.querySelectorAll('a[href*="-i."]')) {
    const href = a.href || a.getAttribute('href') || ''
    const ids = parseItemIds(href)
    if (!ids) continue
    const card =
      a.closest('.shop-collection-view__item') ||
      a.closest('[class*="shop-collection"]') ||
      a.closest('[data-sqe="item"]') ||
      a.parentElement
    const text = (card?.innerText || a.innerText || '').replace(/\s+/g, ' ').trim()
    const soldMatch = text.match(/([0-9.,]+\s*[kKmM]?\+?\s*sold)/i)
    const sold_label = soldMatch ? soldMatch[1].replace(/\s+/g, ' ').trim() : null
    let name =
      (a.getAttribute('title') || '').trim() ||
      card?.querySelector('[data-sqe="name"]')?.textContent?.trim() ||
      nameFromHref(href)
    if (name) name = name.replace(/\s+/g, ' ').trim()
    const key = `${ids.shop_id}:${ids.item_id}`
    const row = {
      name,
      sold_label,
      sold_count_lower_bound: soldLower(sold_label),
      category: category,
      shop_id: ids.shop_id,
      item_id: ids.item_id,
      listing_url: href.split('#')[0],
      rank_position: byItem.size + 1,
    }
    const prev = byItem.get(key)
    if (!prev || (!prev.sold_label && row.sold_label)) byItem.set(key, row)
  }

  const products = [...byItem.values()]
  return {
    shop_username,
    shop_id: products[0]?.shop_id || null,
    page_url: location.href,
    page: Number(params.get('page') || 0) || 0,
    sort_by: params.get('sortBy') || 'pop',
    active_category: category,
    product_count: products.length,
    products,
    session_probe: {
      title: document.title,
      bodySnippet: (document.body?.innerText || '').slice(0, 400),
    },
    harvested_at: new Date().toISOString(),
  }
}

/**
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @param {{ interactive?: boolean, captchaWaitMs?: number }} [opts]
 */
export async function openAndHarvestPage(page, url, opts = {}) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 })
  } catch {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
  }
  await humanDelay(1500, 2800)
  await page.evaluate(() => window.scrollBy(0, 900))
  await humanDelay(600, 1200)
  await page.evaluate(() => window.scrollBy(0, 1200))
  await humanDelay(800, 1400)

  let harvest = await page.evaluate(browserHarvestEvaluate)
  const health = detectSessionHealth({
    title: harvest.session_probe?.title,
    bodyText: harvest.session_probe?.bodySnippet,
    url: harvest.page_url || url,
  })

  if (health !== 'ok' && opts.interactive) {
    const waitMs = opts.captchaWaitMs || 180000
    console.error(`[mall-harvest] session_health=${health} — solve captcha in Chrome (max ${Math.round(waitMs / 1000)}s)…`)
    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
      await sleep(3000)
      harvest = await page.evaluate(browserHarvestEvaluate)
      const h2 = detectSessionHealth({
        title: harvest.session_probe?.title,
        bodyText: harvest.session_probe?.bodySnippet,
        url: harvest.page_url || page.url(),
      })
      if (h2 === 'ok' && harvest.product_count > 0) {
        return { harvest, session_health: 'ok' }
      }
      if (h2 === 'ok' && harvest.product_count === 0) {
        // page ok but empty — still return
        return { harvest, session_health: 'ok' }
      }
    }
  }

  return { harvest, session_health: health }
}

/**
 * Merge product lists by shop_id:item_id (prefer rows with sold_label).
 * @param {Array} pages  harvest.products arrays
 */
export function mergeHarvestProducts(pages) {
  const byKey = new Map()
  for (const list of pages) {
    for (const p of list || []) {
      const key = `${p.shop_id}:${p.item_id}`
      const prev = byKey.get(key)
      if (!prev || (!prev.sold_label && p.sold_label)) byKey.set(key, p)
    }
  }
  return [...byKey.values()].map((p, i) => ({ ...p, rank_position: i + 1 }))
}

/**
 * Load pilot / filter brands that have shop_username for harvest.
 * @param {any} db supabase client
 * @param {string} workspaceId
 * @param {{ brand_keys?: string[], pilot_only?: boolean, require_shop?: boolean }} [filter]
 */
export async function loadHarvestTargets(db, workspaceId, filter = {}) {
  let q = db
    .from('marketplace_brand_universe')
    .select('id, brand_key, display_name, shop_username, shop_url, pilot_tier, metadata, enabled')
    .eq('workspace_id', workspaceId)
    .eq('enabled', true)

  if (filter.pilot_only) q = q.eq('pilot_tier', 'pilot')
  if (filter.brand_keys?.length) q = q.in('brand_key', filter.brand_keys)

  const { data, error } = await q.limit(200)
  if (error) throw new Error(error.message)

  let rows = data || []
  if (filter.pilot_only || !filter.brand_keys?.length) {
    // Prefer appendix pilot order when pilot_only
    if (filter.pilot_only) {
      const order = new Map(PILOT_BRAND_KEYS.map((k, i) => [k, i]))
      rows = rows
        .filter((r) => order.has(r.brand_key) || r.pilot_tier === 'pilot')
        .sort((a, b) => (order.get(a.brand_key) ?? 99) - (order.get(b.brand_key) ?? 99))
    }
  }

  if (filter.require_shop !== false) {
    rows = rows.filter((r) => r.shop_username && String(r.shop_username).trim())
  }

  return rows
}

/**
 * Harvest All Products pages for one brand universe row.
 * @param {import('puppeteer').Page} page
 * @param {object} brand  universe row
 * @param {any} db
 * @param {{ max_pages?: number, delay_ms?: number, interactive?: boolean, captchaWaitMs?: number, dry_run?: boolean, workspace_id: string }} opts
 */
export async function harvestBrandAllProducts(page, brand, db, opts) {
  const username = String(brand.shop_username).trim()
  const maxPages = Math.min(Math.max(opts.max_pages ?? 3, 1), 15)
  const delayMs = opts.delay_ms ?? 4000
  const pageHarvests = []
  let stop_batch = false
  let stop_reason = null

  for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
    const url = shopCollectionListUrl(username, {
      shop_collection_id: null,
      page: pageIdx,
      sort_by: 'pop',
      country: 'sg',
    })
    // page=0: shopCollectionListUrl omits page=0 — ensure page param for >0 only (already)
    console.error(`[mall-harvest] ${brand.brand_key} page=${pageIdx} ${url}`)

    const { harvest, session_health } = await openAndHarvestPage(page, url, {
      interactive: opts.interactive,
      captchaWaitMs: opts.captchaWaitMs,
    })

    if (session_health === 'blocked' || session_health === 'login_required') {
      stop_batch = true
      stop_reason = `session_health=${session_health}`
      console.error(`[mall-harvest] stop_batch ${stop_reason}`)
      break
    }

    pageHarvests.push(harvest)
    if (!harvest.product_count) {
      console.error(`[mall-harvest] empty page ${pageIdx} — stop paging`)
      break
    }

    if (pageIdx + 1 < maxPages && delayMs > 0) await sleep(delayMs)
  }

  const products = mergeHarvestProducts(pageHarvests.map((h) => h.products))
  const merged = {
    shop_username: username,
    shop_id: products[0]?.shop_id || null,
    page_url: shopCollectionListUrl(username, { sort_by: 'pop' }),
    page: 0,
    sort_by: 'pop',
    active_category: 'All Products',
    product_count: products.length,
    products,
    harvested_at: new Date().toISOString(),
    brand_key: brand.brand_key,
    pages_fetched: pageHarvests.length,
  }

  let write = null
  if (!opts.dry_run && products.length) {
    let cards = harvestToObservationCards(merged, { brand_key: brand.brand_key })
    cards = stampBrandSignalsOnCards(cards, {
      target: username,
      mode: 'shop',
      metadata: {
        brand_key: brand.brand_key,
        shop_username: username,
        universe_id: brand.id,
      },
    })
    write = await upsertObservationCards(db, {
      workspace_id: opts.workspace_id,
      marketplace: 'shopee',
      country: 'sg',
      crawl_job_id: null,
      cards,
    })
  }

  return {
    brand_key: brand.brand_key,
    shop_username: username,
    product_count: products.length,
    with_sold: products.filter((p) => p.sold_label).length,
    pages_fetched: pageHarvests.length,
    stop_batch,
    stop_reason,
    write,
    sample: products.slice(0, 3).map((p) => ({
      name: p.name,
      sold_label: p.sold_label,
      category: p.category,
    })),
  }
}

export { parseShopPageContext, sleep }
