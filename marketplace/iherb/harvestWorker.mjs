/**
 * iHerb brand catalogue harvest — warm Chrome / CDP, separate warehouse.
 *
 * Differences from Shopee mallHarvestWorker (docs/IHERB_HANDOFF.md):
 *  - No login — public catalogue
 *  - Binding constraint is 403 / rate limit; rare **press-and-hold**
 *    interstitials (not classic captcha) — human solves in Chrome, worker waits
 *  - Notify only after sustained block (backoff exhausted)
 *  - Health returns 'unknown' for unrecognised pages, never false 'ok'
 *  - Assert currency on page one of every run
 *  - Writes via upsertIherbCatalogue (not marketplace_listings)
 *
 * @see marketplace/iherb/parseCatalogue.mjs
 * @see marketplace/iherb/upsertCatalogue.mjs
 * @see marketplace/computerHarvest.mjs
 */

import {
  humanPreNavPause,
  humanScrollPage,
  humanIdleMouse,
  jitterMs,
  waitForRecovery,
} from '../computerHarvest.mjs'
import { parseIherbCatalogue } from './parseCatalogue.mjs'
import { upsertIherbCatalogue } from './upsertCatalogue.mjs'
import {
  browserExtractBrandFacetEvaluate,
  groupProductsByBrand,
  kBeautyBidsUrl,
  kBeautyPageUrl,
  parseKBeautyBrandFacet,
  parseResultCount,
  stampBrandKeysOnProducts,
} from './kBeauty.mjs'
import { brandKeyFromDisplayName } from '../brandKey.mjs'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/** Local nav counter — computerHarvest's counter only moves on Shopee openAndHarvest. */
let _iherbNavCount = 0

export function resetIherbNavCount() {
  _iherbNavCount = 0
}

/**
 * Catalogue URL for a brand slug on the SG site.
 * @param {string} slug e.g. anua, skin1004
 * @param {{ countryHost?: string }} [opts]
 */
export function iherbCatalogueUrl(slug, opts = {}) {
  const s = String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
  if (!s) throw new Error('iherbCatalogueUrl: slug required')
  const host = opts.countryHost || 'sg.iherb.com'
  return `https://${host}/c/${encodeURIComponent(s)}`
}

/**
 * Session / page health for iHerb.
 *
 * Hard rule (MH-8): unrecognised pages are `'unknown'`, never `'ok'`.
 * A false ok writes an empty harvest that reads as "brand delisted everything".
 *
 * @param {{
 *   title?: string
 *   bodyText?: string
 *   url?: string
 *   productCount?: number
 *   status?: number | null
 * }} probe
 * @returns {'ok' | 'blocked' | 'unknown'}
 */
export function detectIherbHealth(probe = {}) {
  const status = probe.status
  if (status === 403 || status === 429) return 'blocked'

  const title = String(probe.title || '')
  const body = String(probe.bodyText || '')
  const blob = `${title}\n${body}`.toLowerCase()
  const url = String(probe.url || '').toLowerCase()
  const productCount = Number(probe.productCount) || 0

  // Includes iHerb's bespoke "press and hold" interstitial (seen on long PDP runs).
  if (
    /access denied|request blocked|permission denied|unusual traffic|bot detection|cf-error|just a moment|checking your browser|rate limit|too many requests|recaptcha|captcha|verify you are human|are you a human|press and hold|press\s*&\s*hold|hold (the )?button|hold to continue|security check|bot check/.test(
      blob,
    )
  ) {
    return 'blocked'
  }

  if (productCount > 0) return 'ok'

  // Empty but clearly an iHerb catalogue shell — still unknown until we have tiles.
  if (url.includes('iherb.com') && productCount === 0) return 'unknown'

  return 'unknown'
}

/**
 * Probe the open page for health signals (title, snippet, tile count).
 * Runs in the browser via page.evaluate.
 */
export function browserIherbProbeEvaluate() {
  const title = document.title || ''
  const bodySnippet = (document.body?.innerText || '').slice(0, 1200)
  const tileCount = document.querySelectorAll('.product-cell-container').length
  return {
    title,
    bodySnippet,
    tileCount,
    page_url: location.href,
    probed_at: new Date().toISOString(),
  }
}

/**
 * Merge catalogue pages by part_number (later pages overwrite same SKU).
 * @param {Array<Record<string, any>>} productLists
 */
export function mergeIherbProducts(productLists) {
  const byKey = new Map()
  for (const list of productLists) {
    for (const p of list || []) {
      const key = p.part_number ? String(p.part_number) : null
      if (!key) continue
      byKey.set(key, p)
    }
  }
  return [...byKey.values()]
}

/**
 * Recompute coverage after a multi-page merge.
 * @param {Array<Record<string, any>>} products
 */
export function coverageFromProducts(products) {
  const list = Array.isArray(products) ? products : []
  const withSold = list.filter((p) => p.sold_lower_bound != null)
  const currencies = [...new Set(list.map((p) => p.currency).filter(Boolean))]
  return {
    products: list.length,
    with_sold: withSold.length,
    with_rating: list.filter((p) => p.rating != null).length,
    with_price: list.filter((p) => p.price != null).length,
    out_of_stock: list.filter((p) => p.in_stock === false).length,
    sponsored: list.filter((p) => p.is_sponsored).length,
    sold_period: withSold.length ? withSold[0].sold_period || null : null,
    currencies,
    currency_consistent: currencies.length <= 1,
  }
}

/**
 * Assert page-1 currency before continuing the run.
 * @param {Record<string, any>} coverage
 * @param {{ expectCurrency?: string }} [opts]
 */
export function assertRunCurrency(coverage, opts = {}) {
  const expect = (opts.expectCurrency || 'SGD').toUpperCase()
  if (coverage?.currency_consistent === false) {
    const err = new Error(
      `iHerb harvest aborted: mixed currencies (${(coverage.currencies || []).join(', ')})`,
    )
    err.code = 'IHERB_CURRENCY_INCONSISTENT'
    throw err
  }
  const seen = (coverage?.currencies || []).map((c) => String(c).toUpperCase())
  if (seen.length && !seen.includes(expect)) {
    const err = new Error(
      `iHerb harvest aborted: expected ${expect}, saw ${seen.join(', ')}. Check sg. subdomain / cookie.`,
    )
    err.code = 'IHERB_CURRENCY_MISMATCH'
    throw err
  }
}

/**
 * Navigate, scroll, capture HTML, parse catalogue, classify health.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @param {{
 *   label?: string
 *   skipPreNavPause?: boolean
 *   preNavMinMs?: number
 *   preNavMaxMs?: number
 *   recoveryDeadlineMs?: number
 *   recoveryPollMs?: number
 *   onBlocked?: (info: object) => void | Promise<void>
 *   onResolved?: (info: object) => void | Promise<void>
 *   maxBlockedAttempts?: number
 * }} [opts]
 */
export async function openAndParseIherbPage(page, url, opts = {}) {
  const label = opts.label || url
  const isFirstNav = _iherbNavCount === 0
  // iHerb public catalogue: no login/captcha — prefer fast path for bulk runs
  const fast = opts.fast === true

  if (!fast && opts.skipPreNavPause !== true) {
    if (isFirstNav) {
      await humanPreNavPause({
        minMs: opts.preNavMinMs ?? 3000,
        maxMs: opts.preNavMaxMs ?? 8000,
        label: `${label} (session warm-up)`,
      })
    } else {
      const short = rand(opts.preNavShortMinMs ?? 800, opts.preNavShortMaxMs ?? 2500)
      console.error(`[iherb] ${label}: gap ${Math.round(short / 1000)}s`)
      await sleep(short)
    }
  } else if (fast && !isFirstNav && opts.skipPreNavPause !== true) {
    // tiny gap only — avoid hammering the same TCP session
    await sleep(rand(opts.preNavShortMinMs ?? 120, opts.preNavShortMaxMs ?? 350))
  }

  let response = null
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
  } catch (e) {
    console.error(`[iherb] goto soft-fail: ${e?.message || e}`)
  }
  _iherbNavCount += 1

  // Paint settle: short for public pages
  await sleep(fast
    ? (isFirstNav ? rand(400, 800) : rand(200, 450))
    : (isFirstNav ? rand(2000, 4000) : rand(1000, 2200)))

  if (!fast) {
    try {
      await humanIdleMouse(page)
    } catch {
      /* ignore */
    }
    try {
      await humanScrollPage(page, { bursts: 3 })
    } catch {
      /* ignore */
    }
    await sleep(rand(600, 1400))
  } else {
    // One quick scroll for lazy tiles — no humanize mouse theatre
    try {
      await page.evaluate(async () => {
        window.scrollBy(0, 1200)
        await new Promise((r) => setTimeout(r, 150))
        window.scrollBy(0, 1200)
      })
    } catch {
      /* ignore */
    }
    await sleep(rand(150, 350))
  }

  const status = response?.status?.() ?? null
  let probe = await page.evaluate(browserIherbProbeEvaluate).catch(() => ({
    title: '',
    bodySnippet: '',
    tileCount: 0,
    page_url: url,
  }))

  let html = await page.content().catch(() => '')
  let catalogue = parseIherbCatalogue(html, {
    url: probe.page_url || url,
    captured_at: new Date().toISOString(),
  })
  let health = detectIherbHealth({
    title: probe.title,
    bodyText: probe.bodySnippet,
    url: probe.page_url || url,
    productCount: catalogue.products.length || probe.tileCount || 0,
    status,
  })

  // Empty readable page: one more scroll (lazy render), not a wall.
  if (health === 'unknown' && catalogue.products.length === 0 && status !== 403) {
    console.error(`[iherb] ${label}: 0 products — re-scroll…`)
    try {
      if (fast) {
        await page.evaluate(() => window.scrollBy(0, 2000))
      } else {
        await humanScrollPage(page, { bursts: 4 })
      }
    } catch {
      /* ignore */
    }
    await sleep(fast ? rand(300, 600) : rand(1000, 2000))
    probe = await page.evaluate(browserIherbProbeEvaluate).catch(() => probe)
    html = await page.content().catch(() => html)
    catalogue = parseIherbCatalogue(html, {
      url: probe.page_url || url,
      captured_at: new Date().toISOString(),
    })
    health = detectIherbHealth({
      title: probe.title,
      bodyText: probe.bodySnippet,
      url: probe.page_url || url,
      productCount: catalogue.products.length,
      status,
    })
  }

  // Sustained 403 / captcha path — poll until clear or deadline.
  let recovery = null
  if (health === 'blocked') {
    console.error(
      `[iherb] ${label}: BLOCKED (status=${status ?? '?'}) title=${JSON.stringify(probe.title?.slice(0, 80) || '')} — waiting for recovery (solve press-and-hold / captcha in Chrome if shown)…`,
    )
    const maxAttempts = opts.maxBlockedAttempts ?? 5
    let attempt = 0
    const probeFn = async () => {
      attempt += 1
      const backoff = Math.min(90_000, 5000 * 2 ** Math.min(attempt - 1, 4))
      console.error(
        `[iherb] ${label}: still blocked — backoff ${Math.round(backoff / 1000)}s (attempt ${attempt}/${maxAttempts})`,
      )
      await sleep(jitterMs(backoff, 0.2))
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
      } catch {
        /* ignore */
      }
      await sleep(rand(1500, 3000))
      try {
        await humanScrollPage(page, { bursts: 2 })
      } catch {
        /* ignore */
      }
      const p = await page.evaluate(browserIherbProbeEvaluate).catch(() => ({
        title: '',
        bodySnippet: '',
        tileCount: 0,
        page_url: url,
      }))
      const h = await page.content().catch(() => '')
      const cat = parseIherbCatalogue(h, {
        url: p.page_url || url,
        captured_at: new Date().toISOString(),
      })
      const hh = detectIherbHealth({
        title: p.title,
        bodyText: p.bodySnippet,
        url: p.page_url || url,
        productCount: cat.products.length,
        status: null,
      })
      // Stash for outer scope via return
      return {
        health: hh,
        productCount: cat.products.length,
        harvest: { probe: p, html: h, catalogue: cat },
      }
    }

    recovery = await waitForRecovery({
      probe: probeFn,
      label,
      deadlineMs: opts.recoveryDeadlineMs ?? 15 * 60 * 1000,
      pollMs: opts.recoveryPollMs ?? 8000,
      requireProducts: true,
      onBlocked: opts.onBlocked,
      onResolved: opts.onResolved,
    })

    if (recovery.harvest?.catalogue) {
      catalogue = recovery.harvest.catalogue
      html = recovery.harvest.html || html
      probe = recovery.harvest.probe || probe
    }
    health = recovery.health
  }

  return {
    url: probe.page_url || url,
    html,
    catalogue,
    health,
    probe,
    status,
    recovery,
  }
}

/**
 * Harvest one brand catalogue (all pages) and optionally write.
 *
 * @param {import('puppeteer').Page} page
 * @param {{
 *   workspace_id: string
 *   brand_key: string
 *   slug?: string
 *   db?: any
 *   dry_run?: boolean
 *   max_pages?: number
 *   delay_ms?: number
 *   expect_currency?: string
 *   onBlocked?: Function
 *   onResolved?: Function
 *   recoveryDeadlineMs?: number
 * }} opts
 */
export async function harvestIherbBrand(page, opts) {
  const workspace_id = opts.workspace_id
  const brand_key = String(opts.brand_key || '').trim().toLowerCase()
  const slug = String(opts.slug || brand_key).trim().toLowerCase()
  if (!workspace_id) throw new Error('harvestIherbBrand: workspace_id required')
  if (!brand_key) throw new Error('harvestIherbBrand: brand_key required')

  const maxPages = Math.min(Math.max(opts.max_pages ?? 10, 1), 30)
  const delayMs = opts.delay_ms ?? 4000
  const expectCurrency = opts.expect_currency || 'SGD'

  let nextUrl = iherbCatalogueUrl(slug)
  const pageCatalogues = []
  let pagesFetched = 0
  let stopReason = null
  let sustainedBlocked = false

  while (nextUrl && pagesFetched < maxPages) {
    console.error(`[iherb] ${brand_key} page=${pagesFetched + 1} ${nextUrl}`)

    const opened = await openAndParseIherbPage(page, nextUrl, {
      label: `${brand_key} p${pagesFetched + 1}`,
      recoveryDeadlineMs: opts.recoveryDeadlineMs,
      recoveryPollMs: opts.recoveryPollMs,
      onBlocked: opts.onBlocked,
      onResolved: opts.onResolved,
      skipPreNavPause: pagesFetched > 0 ? false : opts.skipPreNavPause,
      preNavMinMs: opts.preNavMinMs,
      preNavMaxMs: opts.preNavMaxMs,
    })

    if (opened.health === 'blocked') {
      stopReason = 'session_health=blocked'
      sustainedBlocked = true
      console.error(`[iherb] ${brand_key}: stop — ${stopReason}`)
      break
    }

    if (opened.health === 'unknown' && !(opened.catalogue.products || []).length) {
      stopReason = 'empty_or_unknown_page'
      console.error(
        `[iherb] ${brand_key}: health=unknown with 0 products — refusing to treat as ok (MH-8)`,
      )
      break
    }

    // Currency check on first page with products
    if (pagesFetched === 0 && (opened.catalogue.products || []).length) {
      assertRunCurrency(opened.catalogue.coverage, { expectCurrency })
    }

    pageCatalogues.push(opened.catalogue)
    pagesFetched += 1

    const pag = opened.catalogue.pagination || {}
    if (pag.is_last_page || !pag.next_url) {
      nextUrl = null
    } else {
      nextUrl = pag.next_url
      if (delayMs > 0) {
        const gap = Math.floor(delayMs * (0.7 + Math.random() * 0.7))
        console.error(`[iherb] page gap ${Math.round(gap / 1000)}s`)
        await sleep(gap)
      }
    }
  }

  const products = mergeIherbProducts(pageCatalogues.map((c) => c.products))
  const coverage = coverageFromProducts(products)
  const first = pageCatalogues[0] || null
  const catalogue = {
    url: first?.url || iherbCatalogueUrl(slug),
    captured_at: new Date().toISOString(),
    breadcrumb: first?.breadcrumb || null,
    pagination: {
      pages_fetched: pagesFetched,
      is_last_page: !nextUrl || pageCatalogues[pageCatalogues.length - 1]?.pagination?.is_last_page,
    },
    products,
    coverage,
  }

  const result = {
    brand_key,
    slug,
    pages_fetched: pagesFetched,
    product_count: products.length,
    coverage,
    stop_reason: stopReason,
    sustained_blocked: sustainedBlocked,
    dry_run: opts.dry_run === true,
    write: null,
  }

  if (!products.length) {
    console.error(`[iherb] ${brand_key}: 0 products after ${pagesFetched} page(s) — skip write`)
    return result
  }

  // Final currency gate before write
  assertRunCurrency(coverage, { expectCurrency })

  if (opts.dry_run) {
    console.error(
      `[iherb] dry-run ${brand_key}: ${products.length} products, with_sold=${coverage.with_sold}, currencies=${coverage.currencies.join(',')}`,
    )
    return result
  }

  if (!opts.db) {
    throw new Error('harvestIherbBrand: db required unless dry_run')
  }

  const write = await upsertIherbCatalogue(opts.db, {
    workspace_id,
    brand_key,
    country: 'sg',
    catalogue,
  })
  result.write = write
  console.error(
    `[iherb] wrote ${brand_key}: products=${write.products_upserted} snapshots=${write.snapshots_inserted} with_sold=${coverage.with_sold}`,
  )
  return result
}

/**
 * Load brands with iherb_interest for harvest queue.
 * @param {any} db
 * @param {string} workspaceId
 * @param {{ brand_keys?: string[], limit?: number }} [filter]
 */
export async function loadIherbHarvestTargets(db, workspaceId, filter = {}) {
  let q = db
    .from('marketplace_brand_universe')
    .select('id, brand_key, display_name, iherb_interest, enabled, metadata')
    .eq('workspace_id', workspaceId)
    .eq('enabled', true)
    .eq('iherb_interest', true)

  if (filter.brand_keys?.length) {
    q = q.in('brand_key', filter.brand_keys)
  }

  const { data, error } = await q.limit(filter.limit ?? 200)
  if (error) throw new Error(error.message)
  return data || []
}

/**
 * Discover all brands on the K-Beauty hub facet (checkbox list + lazy stubs).
 *
 * @param {import('puppeteer').Page} page
 * @param {{ hubUrl?: string, expandShowMore?: boolean }} [opts]
 * @returns {Promise<{
 *   brands: Array<{ code: string, name: string|null, count: number|null, url: string|null, brand_key: string|null }>
 *   listCount: number|null
 *   hubUrl: string
 *   resultCount: number|null
 * }>}
 */
export async function discoverKBeautyBrands(page, opts = {}) {
  const hubUrl = opts.hubUrl || 'https://sg.iherb.com/c/k-beauty'
  console.error(`[iherb-kbeauty] discover brands ${hubUrl}`)

  await openAndParseIherbPage(page, hubUrl, {
    label: 'k-beauty hub',
    skipPreNavPause: opts.skipPreNavPause,
  })

  // Try expand "show more" inside Brands facet only
  if (opts.expandShowMore !== false) {
    await page.evaluate(() => {
      const root =
        document.querySelector('.filter-section.brands-search')
        || document.querySelector('.brands-search')
      if (!root) return
      for (const el of root.querySelectorAll('button, a')) {
        const t = (el.textContent || '').trim()
        if (/show more|see all|view all/i.test(t) && t.length < 28) {
          try { el.click() } catch { /* */ }
        }
      }
    }).catch(() => {})
    await sleep(1200)
  }

  let extracted = await page.evaluate(browserExtractBrandFacetEvaluate).catch(() => null)
  let brands = extracted?.brands || []

  // Fallback: parse full HTML (includes lazy-load-filter-item data-id)
  if (brands.length < 20) {
    const html = await page.content().catch(() => '')
    const fromHtml = parseKBeautyBrandFacet(html)
    if (fromHtml.length > brands.length) {
      brands = fromHtml
      extracted = { brands: fromHtml, listCount: fromHtml.length, error: null }
    }
  }

  const resultCountText = await page.evaluate(() =>
    (document.body?.innerText || '').match(/of\s+[\d,]+\s+results?/i)?.[0] || null,
  ).catch(() => null)

  const enriched = brands.map((b) => ({
    ...b,
    brand_key: b.name ? brandKeyFromDisplayName(b.name) : null,
  }))

  console.error(
    `[iherb-kbeauty] discovered ${enriched.length} brands`
    + (extracted?.listCount != null ? ` (facet listCount=${extracted.listCount})` : '')
    + (resultCountText ? ` hub ${resultCountText}` : ''),
  )

  return {
    brands: enriched,
    listCount: extracted?.listCount ?? enriched.length,
    hubUrl: page.url(),
    resultCount: parseResultCount(resultCountText),
  }
}

/**
 * Harvest K-Beauty products for one or more brand codes via ?bids=.
 *
 * @param {import('puppeteer').Page} page
 * @param {{
 *   workspace_id: string
 *   codes: string | string[]
 *   brand_name?: string
 *   brand_key?: string
 *   db?: any
 *   dry_run?: boolean
 *   max_pages?: number
 *   delay_ms?: number
 *   expect_currency?: string
 *   category_path?: string
 *   onBlocked?: Function
 *   onResolved?: Function
 * }} opts
 */
export async function harvestKBeautyByBids(page, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('harvestKBeautyByBids: workspace_id required')

  const codes = (Array.isArray(opts.codes) ? opts.codes : String(opts.codes || '').split(/[,|]/))
    .map((c) => String(c || '').trim())
    .filter(Boolean)
  if (!codes.length) throw new Error('harvestKBeautyByBids: codes required')

  const maxPages = Math.min(Math.max(opts.max_pages ?? 40, 1), 80)
  const fast = opts.fast !== false // default fast for public K-Beauty
  const delayMs = opts.delay_ms ?? (fast ? 800 : 3500)
  const expectCurrency = opts.expect_currency || 'SGD'
  const categoryPath = opts.category_path || 'K-Beauty'

  const startUrl = kBeautyBidsUrl(codes, { page: 1 })
  const pageCatalogues = []
  let pagesFetched = 0
  let stopReason = null
  let sustainedBlocked = false
  let pageNum = 1

  while (pageNum <= maxPages) {
    const url = pageNum === 1 ? startUrl : kBeautyPageUrl(startUrl, pageNum, codes)
    const label = `k-beauty bids=${codes.join('+')} p${pageNum}`
    console.error(`[iherb-kbeauty] ${label} ${url}`)

    const opened = await openAndParseIherbPage(page, url, {
      label,
      fast,
      recoveryDeadlineMs: opts.recoveryDeadlineMs ?? (fast ? 60_000 : 15 * 60 * 1000),
      recoveryPollMs: opts.recoveryPollMs ?? (fast ? 3000 : 8000),
      onBlocked: opts.onBlocked,
      onResolved: opts.onResolved,
      skipPreNavPause: pageNum > 1 ? true : opts.skipPreNavPause,
      preNavMinMs: opts.preNavMinMs,
      preNavMaxMs: opts.preNavMaxMs,
    })

    if (opened.health === 'blocked') {
      stopReason = 'session_health=blocked'
      sustainedBlocked = true
      break
    }

    const products = opened.catalogue?.products || []
    if (opened.health === 'unknown' && !products.length) {
      // empty last page is normal end
      if (pagesFetched > 0) {
        stopReason = 'empty_page'
        break
      }
      stopReason = 'empty_or_unknown_page'
      console.error(`[iherb-kbeauty] ${label}: unknown/empty — stop`)
      break
    }

    if (!products.length) {
      stopReason = 'empty_page'
      break
    }

    if (pagesFetched === 0) {
      assertRunCurrency(opened.catalogue.coverage, { expectCurrency })
    }

    // Stamp category on each product for warehouse
    opened.catalogue.products = products.map((p) => ({
      ...p,
      category_path_text: categoryPath,
      category_leaf: categoryPath,
    }))
    pageCatalogues.push(opened.catalogue)
    pagesFetched += 1

    // Next page: never trust rel=next for bids — rebuild
    const expectedTotal = parseResultCount(
      await page.evaluate(() =>
        (document.body?.innerText || '').match(/of\s+[\d,]+\s+results?/i)?.[0] || null,
      ).catch(() => null),
    )
    const soFar = mergeIherbProducts(pageCatalogues.map((c) => c.products)).length
    if (expectedTotal != null && soFar >= expectedTotal) break
    if (products.length < 48 && (opened.catalogue.pagination?.is_last_page || !opened.catalogue.pagination?.next_url)) {
      // short page usually means last
      break
    }

    pageNum += 1
    if (delayMs > 0 && pageNum <= maxPages) {
      const gap = Math.floor(delayMs * (0.7 + Math.random() * 0.7))
      console.error(`[iherb-kbeauty] page gap ${Math.round(gap / 1000)}s`)
      await sleep(gap)
    }
  }

  let products = stampBrandKeysOnProducts(
    mergeIherbProducts(pageCatalogues.map((c) => c.products)),
  )
  // Prefer explicit brand for single-code harvest
  if (codes.length === 1 && opts.brand_name) {
    const bk = opts.brand_key || brandKeyFromDisplayName(opts.brand_name)
    products = products.map((p) => ({
      ...p,
      brand_name: p.brand_name || opts.brand_name,
      brand_id: p.brand_id || codes[0],
      brand_key: bk,
    }))
  }

  const coverage = coverageFromProducts(products)
  const result = {
    codes,
    pages_fetched: pagesFetched,
    product_count: products.length,
    coverage,
    stop_reason: stopReason,
    sustained_blocked: sustainedBlocked,
    dry_run: opts.dry_run === true,
    writes: /** @type {any[]} */ ([]),
    brands: [],
  }

  if (!products.length) {
    console.error(`[iherb-kbeauty] bids=${codes.join(',')} — 0 products, skip write`)
    return result
  }

  assertRunCurrency(coverage, { expectCurrency })

  const groups = groupProductsByBrand(products)
  result.brands = [...groups.values()].map((g) => ({
    brand_id: g.brand_id,
    brand_name: g.brand_name,
    brand_key: g.brand_key,
    products: g.products.length,
  }))

  if (opts.dry_run) {
    console.error(
      `[iherb-kbeauty] dry-run bids=${codes.join(',')}: ${products.length} products across ${groups.size} brand(s)`,
    )
    return result
  }

  if (!opts.db) throw new Error('harvestKBeautyByBids: db required unless dry_run')

  for (const [, g] of groups) {
    const brand_key =
      (codes.length === 1 && opts.brand_key)
      || g.brand_key
      || (g.brand_name ? brandKeyFromDisplayName(g.brand_name) : null)
      || 'unknown'

    const catalogue = {
      url: kBeautyBidsUrl(g.brand_id || codes),
      captured_at: new Date().toISOString(),
      breadcrumb: { path_text: categoryPath, path: ['K-Beauty'], scope: 'category' },
      pagination: { pages_fetched: pagesFetched },
      products: g.products,
      coverage: coverageFromProducts(g.products),
    }

    const write = await upsertIherbCatalogue(opts.db, {
      workspace_id,
      brand_key,
      country: 'sg',
      catalogue,
    })
    result.writes.push({
      brand_key,
      brand_id: g.brand_id,
      brand_name: g.brand_name,
      products_upserted: write.products_upserted,
      snapshots_inserted: write.snapshots_inserted,
      errors: write.errors,
    })
    console.error(
      `[iherb-kbeauty] wrote ${brand_key} (${g.brand_id || '?'}): `
      + `products=${write.products_upserted} snapshots=${write.snapshots_inserted}`,
    )
  }

  return result
}
