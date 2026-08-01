/**
 * Brand-radar sheet slices: flat rows for MCP / CSV / spreadsheets.
 * One row per listing (latest / best sold snapshot).
 */

import { exportRowsToCsv } from './normalize/metrics.mjs'

/**
 * RP-5 — default projection for agent (JSON) responses.
 *
 * Measured on 100 rows of the full column set: listing_url was 26% of all
 * tokens, listing_id (UUID) 6%, crawled_at 5%, platform_category_path_text
 * 10% — none of which a model reads. Dropping them plus emitting columnar
 * arrays instead of object-per-row cut the same data by 84%.
 *
 * URLs are reconstructible from shop_id + item_id, so the response carries one
 * `url_template` instead of a full URL on every row. Callers who genuinely
 * need more can ask via `fields`; CSV export is unaffected and keeps
 * BRAND_LISTING_COLUMNS in full.
 */
export const DEFAULT_LISTING_FIELDS = [
  'title',
  'sold_label',
  'sold_count_lower_bound',
  'shop_collection_name',
  // Platform PDP breadcrumbs (MH-4): full trail + leaf
  // e.g. "Shopee > Beauty & Personal Care > Makeup > Blusher"
  'platform_category_path_text',
  'platform_category_leaf',
  'price',
  'brand_key',
  'shop_id',
  'item_id',
  'sort_by',
  'sales_rank',
]

/** Reconstructs a listing URL from the ids kept in the default projection. */
export const LISTING_URL_TEMPLATE = 'https://shopee.sg/product/{shop_id}/{item_id}'

/** Stable column order for sheets */
export const BRAND_LISTING_COLUMNS = [
  'brand_key',
  'shop_username',
  'title',
  'sold_label',
  'sold_count_lower_bound',
  // MH-14: grid rank under sortBy=sales (not calendar-month units)
  'sort_by',
  'sales_rank',
  'sales_rank_page',
  'sales_rank_on_page',
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

  const sortBy =
    s.sort_by != null
      ? String(s.sort_by).toLowerCase()
      : snap.sort_by != null
        ? String(snap.sort_by).toLowerCase()
        : null
  const salesRank =
    s.sales_rank != null
      ? Number(s.sales_rank)
      : snap.rank_position != null && sortBy === 'sales'
        ? Number(snap.rank_position)
        : null

  return {
    brand_key: s.brand_key || L.metadata?.brand_key || null,
    shop_username: s.shop_username || L.shop_name || null,
    title: L.title || s.name || null,
    sold_label: snap.sold_label ?? null,
    sold_count_lower_bound:
      snap.sold_count_lower_bound != null ? Number(snap.sold_count_lower_bound) : null,
    sort_by: sortBy || null,
    sales_rank: Number.isFinite(salesRank) ? salesRank : null,
    sales_rank_page:
      s.sales_rank_page != null ? Number(s.sales_rank_page) : null,
    sales_rank_on_page:
      s.sales_rank_on_page != null ? Number(s.sales_rank_on_page) : null,
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

/** True if this sheet row came from (or carries) MH-14 sales-sort harvest. */
export function rowLooksLikeSalesSort(row) {
  if (!row || typeof row !== 'object') return false
  if (String(row.sort_by || '').toLowerCase() === 'sales') return true
  if (row.sales_rank != null && Number.isFinite(Number(row.sales_rank))) return true
  const src = String(row.harvest_source || '')
  return /_sales$|sales/i.test(src) && /mall_/i.test(src)
}

/**
 * Fill platform breadcrumbs (MH-4) onto rows missing path/leaf by looking up
 * any snapshot for the same listing_id that has platform_category_leaf.
 *
 * Needed after sales-sort re-list: the "latest" snap may be mall_all_products_sales
 * without PDP path stamps, even though an older MH-4 snap still has the trail.
 *
 * Mutates and returns the same rows array.
 *
 * @param {any} db
 * @param {string} workspaceId
 * @param {object[]} rows  brand listing rows
 */
export async function enrichRowsWithPlatformBreadcrumbs(db, workspaceId, rows) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length || !db) return list

  const missingIds = [
    ...new Set(
      list
        .filter((r) => r?.listing_id && !r.platform_category_leaf && !r.platform_category_path_text)
        .map((r) => r.listing_id),
    ),
  ]
  if (!missingIds.length) return list

  /** @type {Map<string, { leaf: string|null, path: string|null }>} */
  const byListing = new Map()

  for (let i = 0; i < missingIds.length; i += 100) {
    const chunk = missingIds.slice(i, i + 100)
    const { data, error } = await db
      .from('marketplace_listing_snapshots')
      .select('listing_id, platform_category_leaf, signals, crawled_at')
      .eq('workspace_id', workspaceId)
      .in('listing_id', chunk)
      .not('platform_category_leaf', 'is', null)
      .order('crawled_at', { ascending: false })

    if (error) {
      // Non-fatal: leave rows without crumbs rather than failing the whole export
      console.error('[brand-listings] breadcrumb enrich:', error.message)
      break
    }

    for (const snap of data || []) {
      const id = snap.listing_id
      if (!id || byListing.has(id)) continue
      const s = snap.signals && typeof snap.signals === 'object' ? snap.signals : {}
      const pathArr = Array.isArray(s.platform_category_path) ? s.platform_category_path : []
      const pathText =
        s.platform_category_path_text ||
        (pathArr.length ? pathArr.join(' > ') : null)
      byListing.set(id, {
        leaf: snap.platform_category_leaf || s.platform_category_leaf || null,
        path: pathText,
      })
    }
  }

  if (!byListing.size) return list

  for (const r of list) {
    if (r.platform_category_leaf || r.platform_category_path_text) continue
    const hit = byListing.get(r.listing_id)
    if (!hit) continue
    if (hit.leaf) r.platform_category_leaf = hit.leaf
    if (hit.path) r.platform_category_path_text = hit.path
  }
  return list
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
    format: 'json',
    // Aggregation below needs keyed rows, not columnar arrays.
    shape: 'objects',
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
    // Track RP: say plainly whether these aggregates cover the whole match set.
    // A summary computed from one page of 500 is not a summary of 3,000 rows,
    // and an agent must be able to tell the difference.
    coverage: {
      summarised_rows: result.row_count,
      total_matching: result.total_matching,
      complete: result.complete,
      ...(result.complete
        ? {}
        : {
            note: `Aggregates cover the top ${result.row_count} of ${result.total_matching} matching listings by sold. Narrow with brand_key / min_sold for a complete summary.`,
          }),
    },
    summary,
    // Small sample for agents without dumping full sheet
    sample_rows: (result.rows || []).slice(0, Math.min(5, top_n)),
  }
}

const SNAPSHOT_SELECT = `
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
  brand_key,
  shop_username,
  shop_collection_name,
  platform_category_leaf,
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
`

/**
 * Track RP — apply every supported filter in SQL.
 *
 * Previously only brand_key / seller_type / since / until reached the database;
 * min_sold, brand_keys, shop, shelf, leaf and q were applied in JS *after* a
 * capped recency window, so they silently saw ~12% of the table. Filters now
 * run against the denormalised columns from migration 076.
 *
 * @param {any} q supabase query builder
 * @param {object} filters
 */
function applySqlFilters(q, filters = {}) {
  const lower = (v) => String(v).trim().toLowerCase()

  if (filters.brand_key) q = q.eq('brand_key', lower(filters.brand_key))
  if (Array.isArray(filters.brand_keys) && filters.brand_keys.length) {
    q = q.in('brand_key', filters.brand_keys.map(lower))
  }
  if (filters.shop_username) q = q.eq('shop_username', lower(filters.shop_username))

  // Shelf / leaf stay substring matches — callers pass partials like "Bundle".
  if (filters.shop_collection_name) {
    q = q.ilike('shop_collection_name', `%${String(filters.shop_collection_name).trim()}%`)
  }
  if (filters.platform_category_leaf) {
    q = q.ilike('platform_category_leaf', `%${String(filters.platform_category_leaf).trim()}%`)
  }

  const minSold =
    filters.min_sold != null && filters.min_sold !== '' ? Number(filters.min_sold) : null
  if (minSold != null && Number.isFinite(minSold)) {
    q = q.gte('sold_count_lower_bound', minSold)
  }

  if (filters.seller_type) q = q.eq('seller_type', filters.seller_type)
  if (filters.since) q = q.gte('crawled_at', filters.since)
  if (filters.until) q = q.lte('crawled_at', filters.until)

  return q
}

/**
 * RP-5 — reshape rows for an LLM client.
 *
 * Two savings, both measured:
 *  1. Columnar arrays remove the per-row repetition of every key. With 20
 *     columns and 100 rows that is 2,000 redundant key strings.
 *  2. Fields whose value is identical across the whole result (brand_key and
 *     shop_username on a single-brand query, for instance) are hoisted into a
 *     `constant` header and dropped from the rows entirely.
 *
 * @param {object[]} rows
 * @param {string[]} fields
 * @returns {{ columns: string[], constant: Record<string, any>, rows: any[][] }}
 */
export function toColumnar(rows, fields) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return { columns: fields, constant: {}, rows: [] }

  const constant = {}
  const varying = []
  for (const f of fields) {
    const first = list[0][f] ?? null
    // Only hoist a value that is actually present — hoisting `null` would
    // hide "this field is empty for every row", which is information.
    const same = first != null && list.every((r) => (r[f] ?? null) === first)
    if (same) constant[f] = first
    else varying.push(f)
  }

  return {
    columns: varying,
    constant,
    rows: list.map((r) => varying.map((f) => r[f] ?? null)),
  }
}

/**
 * Free-text search still runs in JS: it spans the listing title (a joined
 * table) plus derived path text, which PostgREST cannot express as one
 * predicate. Callers combining `q` with a narrow filter get correct results;
 * `q` alone over a large table is best-effort and reported as such.
 * @param {object[]} rows
 * @param {string} [needle]
 */
function applyTextSearch(rows, needle) {
  if (!needle) return rows
  const n = String(needle).toLowerCase()
  return rows.filter((r) =>
    `${r.title || ''} ${r.brand_key || ''} ${r.shop_collection_name || ''} ${r.platform_category_path_text || ''}`
      .toLowerCase()
      .includes(n),
  )
}

/**
 * Query the latest-observation-per-listing view and return a brand-listing slice.
 *
 * Contract (Track RP):
 *   row_count       rows in this response
 *   total_matching  rows matching the filter in the database
 *   complete        row_count === total_matching
 *   next_offset     pass back as `offset` to page (null when complete)
 *
 * `complete` exists because the old path silently truncated: an agent had no
 * way to know it was reasoning about a subset.
 *
 * @param {any} db supabase client
 * @param {string} workspaceId
 * @param {object} filters
 */
export async function queryBrandListings(db, workspaceId, filters = {}) {
  const offset = Math.max(Number(filters.offset) || 0, 0)
  const hasTextSearch = Boolean(filters.q)

  // RP-7 — tier row access.
  //
  // An unfiltered row request is almost always the wrong call: it returns an
  // arbitrary top-N of thousands of listings, which reads as an answer but is
  // a sample. Rather than error (hostile for a reasonable-looking call), cap
  // it hard and steer to the aggregate tool. Narrowed calls keep the full
  // default. Paging past the first page counts as intent, not a blind dump.
  const narrowed = Boolean(
    filters.brand_key
    || (Array.isArray(filters.brand_keys) && filters.brand_keys.length)
    || filters.shop_username
    || filters.shop_collection_name
    || filters.platform_category_leaf
    || filters.min_sold
    || filters.q
    || offset > 0,
  )
  const requestedLimit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500)
  const limit = narrowed ? requestedLimit : Math.min(requestedLimit, 25)

  // One row per listing in SQL (mig 076 view) — no JS dedupe, no fetch window.
  const base = () => applySqlFilters(
    db.from('v_marketplace_listing_latest').select(SNAPSHOT_SELECT).eq('workspace_id', workspaceId),
    filters,
  )

  // Exact count of what matches, independent of the page we return.
  const { count: totalMatching, error: countErr } = await applySqlFilters(
    db
      .from('v_marketplace_listing_latest')
      .select('listing_id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId),
    filters,
  )
  if (countErr) throw new Error(countErr.message)

  // Text search can only be evaluated after the join is materialised, so widen
  // the page when it is in play and narrow back down afterwards.
  const fetchSize = hasTextSearch ? Math.min(limit * 10, 2000) : limit

  const { data, error } = await base()
    .order('sold_count_lower_bound', { ascending: false, nullsFirst: false })
    .order('listing_id', { ascending: true })
    .range(offset, offset + fetchSize - 1)

  if (error) throw new Error(error.message)

  const sourceRows = (data || []).map(snapshotToBrandListingRow)
  let rows
  let consumedSourceRows

  if (hasTextSearch) {
    // `offset` addresses the SQL candidate stream, not the filtered matches.
    // Stop at the source row that produced the final returned match so the
    // next page neither repeats candidates nor skips additional matches that
    // were already fetched in this widened window.
    rows = []
    consumedSourceRows = 0
    for (const sourceRow of sourceRows) {
      consumedSourceRows++
      if (applyTextSearch([sourceRow], filters.q).length) rows.push(sourceRow)
      if (rows.length >= limit) break
    }
  } else {
    rows = sourceRows.slice(0, limit)
    consumedSourceRows = rows.length
  }

  // Merge MH-4 path/leaf from any snap for the listing (sales latest may lack crumbs)
  if (filters.enrich_breadcrumbs !== false) {
    rows = await enrichRowsWithPlatformBreadcrumbs(db, workspaceId, rows)
  }

  const total = totalMatching ?? rows.length
  const sourceExhausted =
    offset + consumedSourceRows >= total
    || (sourceRows.length < fetchSize && consumedSourceRows >= sourceRows.length)
  const complete = hasTextSearch
    ? sourceExhausted
    : offset + rows.length >= total
  const nextOffset = complete ? null : offset + consumedSourceRows

  const summary = summarizeBrandListings(rows)

  // RP-7: when a response is partial, name the tool that answers the question
  // completely. An agent should not have to infer that rows were the wrong
  // shape of request.
  const guidance = []
  if (!narrowed) {
    guidance.push(
      `Unfiltered row request — capped at ${limit} of ${total} listings. This is a sample, not a ranking. For "which brands/shelves sell most" use market_brand_rollup (complete and ~10x cheaper); for specific SKUs pass brand_key or shop_collection_name.`,
    )
  } else if (!complete) {
    guidance.push(
      `Partial: ${rows.length} of ${total}. Page with offset=${nextOffset}, narrow the filter, or use market_brand_rollup if you only need totals.`,
    )
  }

  const coverage = {
    row_count: rows.length,
    total_matching: total,
    offset,
    complete,
    next_offset: nextOffset,
    ...(guidance.length ? { guidance: guidance.join(' ') } : {}),
    ...(hasTextSearch
      ? {
          note: `total_matching counts the SQL filters; q="${filters.q}" was applied to this page only. Combine q with brand_key or min_sold for exact counts.`,
        }
      : {}),
  }

  const format = filters.format === 'csv' ? 'csv' : 'json'

  if (format === 'csv') {
    const ordered = rows.map((r) => {
      const o = {}
      for (const k of BRAND_LISTING_COLUMNS) o[k] = r[k] ?? ''
      return o
    })
    return {
      format: 'csv',
      ...coverage,
      summary,
      csv: exportRowsToCsv(ordered),
      columns: BRAND_LISTING_COLUMNS,
    }
  }

  // RP-5: columnar is the default for JSON because the consumer is a model.
  // `shape: 'objects'` stays available for callers that want row objects
  // (queryBrandSummary needs them internally, as does any UI table).
  const shape = filters.shape === 'objects' ? 'objects' : 'columnar'
  if (shape === 'objects') {
    return { format: 'json', shape, ...coverage, summary, rows, columns: BRAND_LISTING_COLUMNS }
  }

  const requested = Array.isArray(filters.fields) && filters.fields.length
    ? filters.fields.filter((f) => BRAND_LISTING_COLUMNS.includes(f))
    : DEFAULT_LISTING_FIELDS
  const fields = requested.length ? requested : DEFAULT_LISTING_FIELDS
  const table = toColumnar(rows, fields)

  return {
    format: 'json',
    shape,
    ...coverage,
    summary,
    ...table,
    ...(fields.includes('shop_id') && fields.includes('item_id')
      ? { url_template: LISTING_URL_TEMPLATE }
      : {}),
    available_fields: BRAND_LISTING_COLUMNS,
  }
}
