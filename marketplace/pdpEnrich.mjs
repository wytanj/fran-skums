/**
 * MH-4 — PDP enrich orchestration (load candidates, stamp platform path).
 */

import {
  browserPdpEvaluate,
  parseBreadcrumbList,
  parseProductJsonLd,
} from './parseBreadcrumb.mjs'
import { detectSessionHealth } from './shopee/parseSearch.mjs'

/**
 * Build listing candidates for MH-4 from recent snapshots with brand_key.
 * @param {any} db
 * @param {string} workspaceId
 * @param {{
 *   brand_key?: string
 *   brand_keys?: string[]
 *   top?: number
 *   only_missing?: boolean
 *   shop_username?: string
 * }} [opts]
 */
export async function loadPdpEnrichCandidates(db, workspaceId, opts = {}) {
  const top = Math.min(Math.max(opts.top ?? 20, 1), 200)
  const onlyMissing = opts.only_missing !== false
  const brandKeys = opts.brand_keys?.length
    ? opts.brand_keys.map((k) => String(k).toLowerCase())
    : opts.brand_key
      ? [String(opts.brand_key).toLowerCase()]
      : null

  const { data, error } = await db
    .from('marketplace_listing_snapshots')
    .select(
      `
      id,
      listing_id,
      sold_label,
      sold_count_lower_bound,
      signals,
      crawled_at,
      listing:marketplace_listings (
        id,
        listing_url,
        title,
        shop_id,
        item_id,
        shop_name,
        seller_type,
        category_path,
        metadata,
        last_seen_at
      )
    `,
    )
    .eq('workspace_id', workspaceId)
    .order('crawled_at', { ascending: false })
    .limit(800)

  if (error) throw new Error(error.message)

  /** @type {Map<string, any>} */
  const byListing = new Map()
  for (const row of data || []) {
    const L = row.listing
    if (!L?.id) continue
    const signals = row.signals || {}
    const brand_key = signals.brand_key || L.metadata?.brand_key || null
    if (brandKeys && !brandKeys.includes(String(brand_key || '').toLowerCase())) continue
    if (opts.shop_username) {
      const shop = String(signals.shop_username || L.shop_name || '').toLowerCase()
      if (shop !== String(opts.shop_username).toLowerCase()) continue
    }

    const hasPlatform =
      Array.isArray(signals.platform_category_path) && signals.platform_category_path.length > 0
    if (onlyMissing && hasPlatform) continue

    const url =
      L.listing_url ||
      (L.shop_id && L.item_id
        ? `https://shopee.sg/product/${L.shop_id}/${L.item_id}`
        : null)
    if (!url) continue

    const prev = byListing.get(L.id)
    const sold = row.sold_count_lower_bound ?? -1
    if (!prev || sold > (prev.sold_count_lower_bound ?? -1)) {
      byListing.set(L.id, {
        listing_id: L.id,
        listing_url: url,
        title: L.title,
        shop_id: L.shop_id,
        item_id: L.item_id,
        shop_name: L.shop_name,
        brand_key,
        shop_username: signals.shop_username || L.shop_name,
        sold_label: row.sold_label,
        sold_count_lower_bound: row.sold_count_lower_bound,
        signals,
        has_platform: hasPlatform,
      })
    }
  }

  return [...byListing.values()]
    .sort((a, b) => (b.sold_count_lower_bound || 0) - (a.sold_count_lower_bound || 0))
    .slice(0, top)
}

/**
 * Apply parse result onto signals + listing fields.
 * @param {object} breadcrumbResult  parseBreadcrumbList output
 * @param {object} [productResult]   parseProductJsonLd output
 * @param {object} [baseSignals]
 */
export function buildPdpEnrichStamps(breadcrumbResult, productResult = null, baseSignals = {}) {
  const signals = { ...(baseSignals || {}) }
  if (breadcrumbResult?.ok) {
    signals.platform_category_path = breadcrumbResult.platform_category_path
    signals.platform_category_ids = breadcrumbResult.platform_category_ids
    signals.platform_category_leaf = breadcrumbResult.platform_category_leaf
    signals.platform_category_path_text = breadcrumbResult.platform_category_path_text
    signals.mh4_enriched_at = new Date().toISOString()
  }
  if (productResult?.ok) {
    if (productResult.rating != null) signals.pdp_rating = productResult.rating
    if (productResult.review_count != null) signals.pdp_review_count = productResult.review_count
  }
  return {
    signals,
    category_path: breadcrumbResult?.platform_category_path_text || null,
    price: productResult?.ok ? productResult.price : null,
    currency: productResult?.ok ? productResult.currency : 'SGD',
    rating: productResult?.ok ? productResult.rating : null,
    review_count: productResult?.ok ? productResult.review_count : null,
  }
}

/**
 * Persist MH-4 result: update listing + insert snapshot.
 * @param {any} db
 * @param {{
 *   workspace_id: string
 *   listing_id: string
 *   candidate: object
 *   breadcrumb: object
 *   product: object
 *   page_url?: string
 * }} input
 */
export async function writePdpEnrichResult(db, input) {
  const stamps = buildPdpEnrichStamps(input.breadcrumb, input.product, input.candidate.signals || {})
  const now = new Date().toISOString()

  // Merge platform fields into existing listing.metadata (don't wipe)
  const { data: existing } = await db
    .from('marketplace_listings')
    .select('metadata')
    .eq('id', input.listing_id)
    .maybeSingle()
  const prevMeta =
    existing?.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}
  const metaPatch = {
    ...prevMeta,
    platform_category_path: stamps.signals.platform_category_path || null,
    platform_category_ids: stamps.signals.platform_category_ids || null,
    platform_category_leaf: stamps.signals.platform_category_leaf || null,
    mh4_enriched_at: stamps.signals.mh4_enriched_at || now,
  }

  const { error: listErr } = await db
    .from('marketplace_listings')
    .update({
      category_path: stamps.category_path,
      last_seen_at: now,
      metadata: metaPatch,
    })
    .eq('id', input.listing_id)

  if (listErr) throw new Error(`listing update: ${listErr.message}`)

  const snapshotRow = {
    workspace_id: input.workspace_id,
    listing_id: input.listing_id,
    crawl_job_id: null,
    crawled_at: now,
    price: stamps.price,
    currency: stamps.currency || 'SGD',
    price_sgd: stamps.price,
    rating: stamps.rating,
    review_count: stamps.review_count,
    sold_label: input.candidate.sold_label ?? null,
    sold_count_lower_bound: input.candidate.sold_count_lower_bound ?? null,
    availability: 'unknown',
    search_query: `mh4:pdp:${input.candidate.item_id || input.listing_id}`,
    seller_type: 'mall',
    signals: {
      ...stamps.signals,
      brand_key: input.candidate.brand_key,
      shop_username: input.candidate.shop_username,
      harvest_source: 'mall_pdp_mh4',
    },
    raw_observation: {
      page_url: input.page_url || input.candidate.listing_url,
      breadcrumb: input.breadcrumb,
      product: input.product,
    },
  }

  const { error: snapErr } = await db.from('marketplace_listing_snapshots').insert(snapshotRow)
  if (snapErr) throw new Error(`snapshot insert: ${snapErr.message}`)

  return {
    listing_id: input.listing_id,
    category_path: stamps.category_path,
    platform_category_leaf: stamps.signals.platform_category_leaf,
    price: stamps.price,
    rating: stamps.rating,
  }
}

/**
 * Open one PDP and parse (computer or script style).
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @param {{ computer?: boolean, pauseAfterLoad?: boolean, step?: boolean }} [opts]
 */
export async function openAndEnrichPdp(page, url, opts = {}) {
  const { waitForEnter, humanScrollPage, humanIdleMouse } = await import('./computerHarvest.mjs')

  if (opts.computer) {
    console.error(`[mh4] open ${url}`)
    try {
      await humanIdleMouse(page)
    } catch {
      /* ignore */
    }
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
    } catch (e) {
      console.error(`[mh4] goto soft-fail: ${e?.message || e}`)
    }
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000))

    if (opts.pauseAfterLoad === true) {
      await waitForEnter(
        '[mh4] When PDP is fully loaded (captcha cleared), press Enter…',
        { fallbackMs: 300000 },
      )
    }

    try {
      await humanScrollPage(page, { bursts: 2 })
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 800))
  } else {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 2000))
  }

  let raw
  try {
    raw = await page.evaluate(browserPdpEvaluate)
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      session_health: 'blocked',
      breadcrumb: parseBreadcrumbList(null),
      product: { ok: false },
    }
  }

  const health = detectSessionHealth({
    title: raw.session_probe?.title,
    bodyText: raw.session_probe?.bodySnippet,
    url: raw.page_url || url,
  })

  const breadcrumb = parseBreadcrumbList(raw.breadcrumb)
  const product = raw.product ? parseProductJsonLd(raw.product) : { ok: false }

  // Captcha loop: wait + re-extract
  let rounds = 0
  while (
    (!breadcrumb.ok || health === 'blocked' || health === 'login_required') &&
    rounds < 15
  ) {
    console.error(`[mh4] need human (health=${health} breadcrumb_ok=${breadcrumb.ok})`)
    try {
      process.stderr.write('\x07')
    } catch {
      /* ignore */
    }
    await waitForEnter(
      '[mh4] Solve captcha / wait for product page, then press Enter…',
      { fallbackMs: 300000 },
    )
    try {
      raw = await page.evaluate(browserPdpEvaluate)
    } catch (e) {
      rounds++
      continue
    }
    const h2 = detectSessionHealth({
      title: raw.session_probe?.title,
      bodyText: raw.session_probe?.bodySnippet,
      url: raw.page_url || url,
    })
    const bc2 = parseBreadcrumbList(raw.breadcrumb)
    const pr2 = raw.product ? parseProductJsonLd(raw.product) : { ok: false }
    if (bc2.ok) {
      return {
        ok: h2 === 'ok' || bc2.ok,
        session_health: h2,
        page_url: raw.page_url || url,
        breadcrumb: bc2,
        product: pr2,
        raw,
      }
    }
    rounds++
  }

  if (opts.step) {
    await waitForEnter(
      `[mh4] path=${breadcrumb.platform_category_path_text || '—'} · press Enter for next…`,
      { fallbackMs: 5000 },
    )
  }

  return {
    ok: breadcrumb.ok,
    session_health: health,
    page_url: raw.page_url || url,
    breadcrumb,
    product,
    raw,
  }
}
