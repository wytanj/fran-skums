/**
 * Brand-radar sheet slices: flat rows for MCP / CSV / spreadsheets.
 * One row per listing (latest / best sold snapshot).
 */

import { exportRowsToCsv } from './normalize/metrics.mjs'

/** Stable column order for sheets */
export const BRAND_LISTING_COLUMNS = [
  'brand_key',
  'shop_username',
  'title',
  'sold_label',
  'sold_count_lower_bound',
  'shop_collection_name',
  'shop_collection_id',
  'platform_category_path_text',
  'platform_category_leaf',
  'price',
  'currency',
  'rating',
  'review_count',
  'seller_type',
  'shop_id',
  'item_id',
  'listing_url',
  'harvest_source',
  'crawled_at',
  'listing_id',
]

/**
 * Flatten a snapshot+listing join into a sheet row.
 * @param {object} snap
 */
export function snapshotToBrandListingRow(snap) {
  const L = snap.marketplace_listings || snap.listing || {}
  const s = snap.signals && typeof snap.signals === 'object' ? snap.signals : {}
  const pathArr = Array.isArray(s.platform_category_path) ? s.platform_category_path : []
  const pathText =
    s.platform_category_path_text ||
    (pathArr.length ? pathArr.join(' > ') : null) ||
    L.category_path ||
    null

  return {
    brand_key: s.brand_key || L.metadata?.brand_key || null,
    shop_username: s.shop_username || L.shop_name || null,
    title: L.title || s.name || null,
    sold_label: snap.sold_label ?? null,
    sold_count_lower_bound:
      snap.sold_count_lower_bound != null ? Number(snap.sold_count_lower_bound) : null,
    shop_collection_name: s.shop_collection_name || s.category || null,
    shop_collection_id: s.shop_collection_id != null ? String(s.shop_collection_id) : null,
    platform_category_path_text: pathText,
    platform_category_leaf: s.platform_category_leaf || null,
    price: snap.price != null ? Number(snap.price) : null,
    currency: snap.currency || 'SGD',
    rating: snap.rating != null ? Number(snap.rating) : s.pdp_rating ?? null,
    review_count:
      snap.review_count != null ? Number(snap.review_count) : s.pdp_review_count ?? null,
    seller_type: snap.seller_type || L.seller_type || null,
    shop_id: L.shop_id || null,
    item_id: L.item_id || null,
    listing_url: L.listing_url || null,
    harvest_source: s.harvest_source || null,
    crawled_at: snap.crawled_at || null,
    listing_id: snap.listing_id || L.id || null,
  }
}

/**
 * Dedupe by listing_id: prefer higher sold, then newer crawl.
 * @param {object[]} snaps
 */
export function dedupeSnapshotsByListing(snaps) {
  const map = new Map()
  for (const snap of snaps || []) {
    const id = snap.listing_id
    if (!id) continue
    const prev = map.get(id)
    if (!prev) {
      map.set(id, snap)
      continue
    }
    const sold = snap.sold_count_lower_bound ?? -1
    const prevSold = prev.sold_count_lower_bound ?? -1
    if (sold > prevSold) map.set(id, snap)
    else if (sold === prevSold) {
      if (String(snap.crawled_at || '') > String(prev.crawled_at || '')) map.set(id, snap)
    }
  }
  return [...map.values()]
}

/**
 * Apply in-memory filters (brand/shelf/platform/min_sold) after fetch.
 * @param {object[]} rows  brand listing rows
 * @param {object} filters
 */
export function filterBrandListingRows(rows, filters = {}) {
  let out = Array.isArray(rows) ? [...rows] : []
  const brand = filters.brand_key ? String(filters.brand_key).toLowerCase() : null
  const brands = Array.isArray(filters.brand_keys)
    ? filters.brand_keys.map((b) => String(b).toLowerCase())
    : null
  const shop = filters.shop_username ? String(filters.shop_username).toLowerCase() : null
  const shelf = filters.shop_collection_name
    ? String(filters.shop_collection_name).toLowerCase()
    : null
  const leaf = filters.platform_category_leaf
    ? String(filters.platform_category_leaf).toLowerCase()
    : null
  const minSold =
    filters.min_sold != null && filters.min_sold !== ''
      ? Number(filters.min_sold)
      : null
  const q = filters.q ? String(filters.q).toLowerCase() : null

  if (brand) out = out.filter((r) => String(r.brand_key || '').toLowerCase() === brand)
  if (brands?.length) {
    out = out.filter((r) => brands.includes(String(r.brand_key || '').toLowerCase()))
  }
  if (shop) out = out.filter((r) => String(r.shop_username || '').toLowerCase() === shop)
  if (shelf) {
    out = out.filter((r) =>
      String(r.shop_collection_name || '')
        .toLowerCase()
        .includes(shelf),
    )
  }
  if (leaf) {
    out = out.filter((r) =>
      String(r.platform_category_leaf || '')
        .toLowerCase()
        .includes(leaf),
    )
  }
  if (minSold != null && Number.isFinite(minSold)) {
    out = out.filter((r) => (r.sold_count_lower_bound || 0) >= minSold)
  }
  if (q) {
    out = out.filter((r) =>
      `${r.title || ''} ${r.brand_key || ''} ${r.shop_collection_name || ''} ${r.platform_category_path_text || ''}`
        .toLowerCase()
        .includes(q),
    )
  }

  out.sort((a, b) => (b.sold_count_lower_bound || 0) - (a.sold_count_lower_bound || 0))
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500)
  return out.slice(0, limit)
}

/**
 * Summarize rows for agent/sheet header.
 * @param {object[]} rows
 */
export function summarizeBrandListings(rows) {
  const list = rows || []
  const byBrand = {}
  const byShelf = {}
  const byLeaf = {}
  let withSold = 0
  let withPlatform = 0
  for (const r of list) {
    const bk = r.brand_key || '(none)'
    byBrand[bk] = (byBrand[bk] || 0) + 1
    const sh = r.shop_collection_name || '(none)'
    byShelf[sh] = (byShelf[sh] || 0) + 1
    const leaf = r.platform_category_leaf || '(none)'
    byLeaf[leaf] = (byLeaf[leaf] || 0) + 1
    if (r.sold_label || r.sold_count_lower_bound) withSold++
    if (r.platform_category_path_text || r.platform_category_leaf) withPlatform++
  }
  return {
    row_count: list.length,
    with_sold: withSold,
    with_platform_path: withPlatform,
    by_brand: byBrand,
    by_shop_collection: byShelf,
    by_platform_leaf: byLeaf,
  }
}

/**
 * Sold band for radar (lower bound).
 * @param {number | null} n
 */
export function soldBand(n) {
  const v = Number(n) || 0
  if (v >= 50000) return '50k+'
  if (v >= 10000) return '10k–50k'
  if (v >= 5000) return '5k–10k'
  if (v >= 1000) return '1k–5k'
  if (v >= 100) return '100–1k'
  if (v > 0) return '1–100'
  return 'unknown'
}

/**
 * Rich brand-radar summary for MCP (sheet-planning / narrative).
 * @param {object[]} rows  brand listing rows (already filtered)
 * @param {{ top_n?: number }} [opts]
 */
export function buildBrandRadarSummary(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  const topN = Math.min(Math.max(opts.top_n ?? 10, 1), 50)
  const base = summarizeBrandListings(list)

  const by_sold_band = {}
  let soldSum = 0
  let soldN = 0
  for (const r of list) {
    const band = soldBand(r.sold_count_lower_bound)
    by_sold_band[band] = (by_sold_band[band] || 0) + 1
    if (r.sold_count_lower_bound != null) {
      soldSum += Number(r.sold_count_lower_bound) || 0
      soldN++
    }
  }

  const top_products = [...list]
    .sort((a, b) => (b.sold_count_lower_bound || 0) - (a.sold_count_lower_bound || 0))
    .slice(0, topN)
    .map((r) => ({
      title: r.title,
      sold_label: r.sold_label,
      sold_count_lower_bound: r.sold_count_lower_bound,
      shop_collection_name: r.shop_collection_name,
      platform_category_leaf: r.platform_category_leaf,
      listing_url: r.listing_url,
      brand_key: r.brand_key,
    }))

  // Per-brand cards when multi-brand
  const brandKeys = [...new Set(list.map((r) => r.brand_key).filter(Boolean))]
  const brands = brandKeys.map((bk) => {
    const subset = list.filter((r) => r.brand_key === bk)
    const top = [...subset].sort(
      (a, b) => (b.sold_count_lower_bound || 0) - (a.sold_count_lower_bound || 0),
    )[0]
    return {
      brand_key: bk,
      sku_count: subset.length,
      with_platform_path: subset.filter(
        (r) => r.platform_category_path_text || r.platform_category_leaf,
      ).length,
      shop_username: subset[0]?.shop_username || null,
      top_sku: top
        ? {
            title: top.title,
            sold_label: top.sold_label,
            sold_count_lower_bound: top.sold_count_lower_bound,
          }
        : null,
      shelves: summarizeBrandListings(subset).by_shop_collection,
    }
  })

  return {
    ...base,
    by_sold_band,
    sold_lower_bound_sum: soldN ? soldSum : null,
    sold_lower_bound_avg: soldN ? Math.round(soldSum / soldN) : null,
    top_products,
    brands,
    sheet_hint:
      'Use market_brand_export_csv with same brand_key filters to paste into Google Sheets / Excel.',
  }
}

/**
 * Load listings then build radar summary (high fetch limit, returns summary + top only).
 * @param {any} db
 * @param {string} workspaceId
 * @param {object} filters
 */
export async function queryBrandSummary(db, workspaceId, filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 500, 1), 500)
  const top_n = Math.min(Math.max(Number(filters.top_n) || 10, 1), 50)
  const result = await queryBrandListings(db, workspaceId, {
    ...filters,
    limit,
    fetch_limit: Math.max(Number(filters.fetch_limit) || 1200, limit),
    format: 'json',
  })
  const summary = buildBrandRadarSummary(result.rows || [], { top_n })
  return {
    workspace_id: workspaceId,
    filters: {
      brand_key: filters.brand_key || null,
      brand_keys: filters.brand_keys || null,
      shop_username: filters.shop_username || null,
      shop_collection_name: filters.shop_collection_name || null,
      min_sold: filters.min_sold ?? null,
    },
    summary,
    // Small sample for agents without dumping full sheet
    sample_rows: (result.rows || []).slice(0, Math.min(5, top_n)),
  }
}

/**
 * Query snapshots and return brand-listing slice.
 * @param {any} db supabase client
 * @param {string} workspaceId
 * @param {object} filters
 */
export async function queryBrandListings(db, workspaceId, filters = {}) {
  const fetchLimit = Math.min(Math.max(Number(filters.fetch_limit) || 800, 50), 2000)

  let q = db
    .from('marketplace_listing_snapshots')
    .select(
      `
      id,
      listing_id,
      crawled_at,
      price,
      currency,
      rating,
      review_count,
      sold_label,
      sold_count_lower_bound,
      seller_type,
      search_query,
      signals,
      marketplace_listings (
        id,
        shop_id,
        item_id,
        title,
        shop_name,
        listing_url,
        seller_type,
        category_path,
        metadata
      )
    `,
    )
    .eq('workspace_id', workspaceId)
    .order('crawled_at', { ascending: false })
    .limit(fetchLimit)

  // Narrow in DB when possible (jsonb brand_key)
  if (filters.brand_key) {
    q = q.contains('signals', { brand_key: String(filters.brand_key).toLowerCase() })
  }
  if (filters.seller_type) q = q.eq('seller_type', filters.seller_type)
  if (filters.since) q = q.gte('crawled_at', filters.since)
  if (filters.until) q = q.lte('crawled_at', filters.until)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const deduped = dedupeSnapshotsByListing(data || [])
  let rows = deduped.map(snapshotToBrandListingRow)
  rows = filterBrandListingRows(rows, filters)

  const summary = summarizeBrandListings(rows)
  const format = filters.format === 'csv' ? 'csv' : 'json'

  if (format === 'csv') {
    // Ensure column order
    const ordered = rows.map((r) => {
      const o = {}
      for (const k of BRAND_LISTING_COLUMNS) o[k] = r[k] ?? ''
      return o
    })
    return {
      format: 'csv',
      row_count: ordered.length,
      summary,
      csv: exportRowsToCsv(ordered),
      columns: BRAND_LISTING_COLUMNS,
    }
  }

  return {
    format: 'json',
    row_count: rows.length,
    summary,
    rows,
    columns: BRAND_LISTING_COLUMNS,
  }
}
