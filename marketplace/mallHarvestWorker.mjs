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
import { openAndHarvestPageComputer } from './computerHarvest.mjs'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function humanDelay(min = 800, max = 1800) {
  return sleep(Math.floor(Math.random() * (max - min + 1)) + min)
}

export { sleep }

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
 * @param {{ interactive?: boolean, captchaWaitMs?: number, computer?: boolean, step?: boolean, label?: string }} [opts]
 */
export async function openAndHarvestPage(page, url, opts = {}) {
  // Mode B — computer-style (mouse + wheel + Enter on captcha; machine stays on)
  if (opts.computer) {
    return openAndHarvestPageComputer(page, url, {
      step: opts.step,
      label: opts.label,
      maxCaptchaRounds: 30,
      harvestEvaluate: browserHarvestEvaluate,
    })
  }

  // Mode A — pure script (faster goto + window.scrollBy; more captcha-prone)
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
 * Resolve shelves to harvest for a brand.
 * @param {object} brand
 * @param {{ mode?: 'all' | 'collections' | 'both', collection_names?: string[] }} [opts]
 * @returns {Array<{ name: string, shop_collection_id: string | null, is_all_products: boolean }>}
 */
export function resolveShelvesForBrand(brand, opts = {}) {
  const mode = opts.mode || 'all'
  const metaColl = Array.isArray(brand.metadata?.shop_collections)
    ? brand.metadata.shop_collections
    : []
  const nameFilter = Array.isArray(opts.collection_names)
    ? opts.collection_names.map((n) => String(n).toLowerCase())
    : null

  const allProducts = {
    name: 'All Products',
    shop_collection_id: null,
    is_all_products: true,
  }

  let shelves = []
  if (mode === 'all') {
    shelves = [allProducts]
  } else if (mode === 'collections') {
    shelves = metaColl.filter((c) => !c.is_all_products && c.shop_collection_id)
  } else {
    // both
    shelves = [allProducts, ...metaColl.filter((c) => !c.is_all_products && c.shop_collection_id)]
  }

  if (nameFilter?.length) {
    shelves = shelves.filter(
      (c) =>
        c.is_all_products ||
        nameFilter.some((n) => String(c.name || '').toLowerCase().includes(n)),
    )
  }

  // Dedupe by collection id
  const seen = new Set()
  return shelves.filter((c) => {
    const key = c.shop_collection_id || '__all__'
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Harvest one shelf (All Products or a shopCollection) for a brand.
 * @param {import('puppeteer').Page} page
 * @param {object} brand
 * @param {any} db
 * @param {{ name: string, shop_collection_id: string | null, is_all_products?: boolean }} shelf
 * @param {{ max_pages?: number, delay_ms?: number, interactive?: boolean, captchaWaitMs?: number, dry_run?: boolean, workspace_id: string, harvest_source?: string, computer?: boolean, step?: boolean }} opts
 */
export async function harvestBrandShelf(page, brand, db, shelf, opts) {
  const username = String(brand.shop_username).trim()
  const maxPages = Math.min(Math.max(opts.max_pages ?? 3, 1), 15)
  const delayMs = opts.delay_ms ?? 4000
  const collId = shelf.shop_collection_id || null
  const collName = shelf.name || (collId ? 'Collection' : 'All Products')
  const pageHarvests = []
  let stop_batch = false
  let stop_reason = null

  for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
    const url = shopCollectionListUrl(username, {
      shop_collection_id: collId,
      page: pageIdx,
      sort_by: 'pop',
      country: 'sg',
    })
    console.error(
      `[mall-harvest] ${brand.brand_key} shelf="${collName}" coll=${collId || 'all'} page=${pageIdx}`,
    )

    const { harvest, session_health } = await openAndHarvestPage(page, url, {
      interactive: opts.interactive,
      captchaWaitMs: opts.captchaWaitMs,
      computer: opts.computer,
      step: opts.step,
      label: `${brand.brand_key} / ${collName} p${pageIdx}`,
    })

    if (session_health === 'blocked' || session_health === 'login_required') {
      stop_batch = true
      stop_reason = `session_health=${session_health}`
      console.error(`[mall-harvest] stop_batch ${stop_reason}`)
      break
    }

    // Force shelf category on products (page may say All Products even on collection URL)
    const products = (harvest.products || []).map((p) => ({
      ...p,
      category: collName,
    }))
    pageHarvests.push({ ...harvest, products, active_category: collName })

    if (!products.length) {
      console.error(`[mall-harvest] empty page ${pageIdx} on ${collName} — stop paging`)
      break
    }

    if (pageIdx + 1 < maxPages && delayMs > 0) await sleep(delayMs)
  }

  const products = mergeHarvestProducts(pageHarvests.map((h) => h.products)).map((p) => ({
    ...p,
    category: collName,
  }))

  const merged = {
    shop_username: username,
    shop_id: products[0]?.shop_id || null,
    page_url: shopCollectionListUrl(username, {
      shop_collection_id: collId,
      sort_by: 'pop',
    }),
    page: 0,
    sort_by: 'pop',
    active_category: collName,
    shop_collection_name: collName,
    shop_collection_id: collId,
    harvest_source: opts.harvest_source || 'mall_shelf_harvest',
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
    // Ensure collection stamps survive stampBrandSignals
    cards = cards.map((c) => ({
      ...c,
      signals: {
        ...(c.signals || {}),
        shop_collection_name: collName,
        shop_collection_id: collId,
        category: collName,
      },
    }))
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
    shelf: collName,
    shop_collection_id: collId,
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
      shop_collection_id: collId,
    })),
  }
}

/**
 * Harvest All Products pages for one brand universe row (MH-2).
 */
export async function harvestBrandAllProducts(page, brand, db, opts) {
  return harvestBrandShelf(
    page,
    brand,
    db,
    { name: 'All Products', shop_collection_id: null, is_all_products: true },
    { ...opts, harvest_source: 'mall_all_products_harvest' },
  )
}

/**
 * MH-3 — Harvest each shop collection (and optionally All Products).
 * @param {import('puppeteer').Page} page
 * @param {object} brand
 * @param {any} db
 * @param {{ mode?: 'collections' | 'both', max_pages?: number, delay_ms?: number, interactive?: boolean, captchaWaitMs?: number, dry_run?: boolean, workspace_id: string, collection_names?: string[], shelf_delay_ms?: number, computer?: boolean, step?: boolean }} opts
 */
export async function harvestBrandCollections(page, brand, db, opts) {
  const mode = opts.mode === 'both' ? 'both' : 'collections'
  const shelves = resolveShelvesForBrand(brand, {
    mode,
    collection_names: opts.collection_names,
  })

  if (!shelves.length) {
    return {
      brand_key: brand.brand_key,
      shop_username: brand.shop_username,
      error: 'no_shop_collections_run_mh1',
      shelves: [],
      product_count: 0,
      stop_batch: false,
    }
  }

  const shelfResults = []
  let stop_batch = false
  let stop_reason = null
  let product_count = 0
  const shelfDelay = opts.shelf_delay_ms ?? opts.delay_ms ?? 4000

  for (let i = 0; i < shelves.length; i++) {
    const shelf = shelves[i]
    const result = await harvestBrandShelf(page, brand, db, shelf, {
      ...opts,
      harvest_source: shelf.is_all_products
        ? 'mall_all_products_harvest'
        : 'mall_collection_harvest',
    })
    shelfResults.push(result)
    product_count += result.product_count || 0
    if (result.stop_batch) {
      stop_batch = true
      stop_reason = result.stop_reason
      break
    }
    if (i + 1 < shelves.length && shelfDelay > 0) await sleep(shelfDelay)
  }

  return {
    brand_key: brand.brand_key,
    shop_username: brand.shop_username,
    shelves_planned: shelves.map((s) => s.name),
    shelves_done: shelfResults.length,
    product_count,
    stop_batch,
    stop_reason,
    shelf_results: shelfResults,
  }
}

export { parseShopPageContext }
