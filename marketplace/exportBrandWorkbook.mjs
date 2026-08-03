/**
 * Recipe: **full** — multi-sheet Excel workbook of the Mall harvest.
 * Recipe: **full_sales** (MH-14) — same shape, prefer / filter sales-sort ranks.
 *
 * One worksheet per brand_key (Excel sheet name ≤31 chars, sanitized).
 * Leading sheet `_index` summarizes brand → sku_count / sold_sum / sold_max.
 *
 * Math and grouping stay in SQL/JS here — not in the LLM.
 * MCP should return a download handle (API URL or base64), not invent rows.
 */

// Full min build embeds codepages — avoids runtime `require('…/dist/cpexcel.js')`
// which breaks under Nitro/Vercel bundling (module not traced into the lambda).
// Default import: the full.min UMD/CJS interop exposes utils on the default export.
import XLSX from 'xlsx/dist/xlsx.full.min.js'
import {
  BRAND_LISTING_COLUMNS,
  enrichRowsWithPlatformBreadcrumbs,
  enrichRowsWithPrice,
  queryBrandListings,
  rowLooksLikeSalesSort,
  snapshotToBrandListingRow,
} from './brandListingsQuery.mjs'
import { queryBrandRollup } from './brandRollupQuery.mjs'

const SUPPORTED_RECIPES = new Set(['full', 'full_sales'])

/** Excel sheet name rules: max 31, no \ / ? * [ ] : */
export function sheetNameForBrand(brandKey) {
  let name = String(brandKey || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[\\/?*[\]:]/g, '-')
    .replace(/\s+/g, '_')
  if (!name) name = 'unknown'
  if (name.length > 31) name = name.slice(0, 31)
  // Excel rejects history/reserved-ish names in some locales — avoid leading '
  if (name.startsWith("'")) name = name.slice(1) || 'unknown'
  return name
}

/**
 * Deduplicate sheet names if truncation collides.
 * @param {string[]} brandKeys
 * @returns {Map<string, string>} brand_key → sheet name
 */
export function allocateSheetNames(brandKeys) {
  const used = new Set(['_index'])
  const map = new Map()
  for (const raw of brandKeys) {
    let base = sheetNameForBrand(raw)
    let name = base
    let n = 2
    while (used.has(name.toLowerCase())) {
      const suffix = `_${n++}`
      name = (base.slice(0, Math.max(1, 31 - suffix.length)) + suffix).slice(0, 31)
    }
    used.add(name.toLowerCase())
    map.set(raw, name)
  }
  return map
}

/**
 * Fetch all listing rows for one brand from latest view (pages until complete).
 * @param {any} db
 * @param {string} workspaceId
 * @param {string} brandKey
 * @param {object} filters
 */
async function fetchAllForBrand(db, workspaceId, brandKey, filters = {}) {
  const pageSize = 500
  const rows = []
  let offset = 0
  let guard = 0
  while (guard++ < 40) {
    const page = await queryBrandListings(db, workspaceId, {
      ...filters,
      brand_key: brandKey,
      limit: pageSize,
      offset,
      format: 'json',
      shape: 'objects',
    })
    const batch = page.rows || []
    rows.push(...batch)
    if (page.complete || !batch.length || page.next_offset == null) break
    offset = page.next_offset
  }
  return rows
}

/**
 * MH-14: load sales-sort observations for one brand (not only "latest by sold").
 * Prefers lower sales_rank when multiple sales snaps exist for the same listing.
 *
 * @param {any} db
 * @param {string} workspaceId
 * @param {string} brandKey
 */
async function fetchSalesSortForBrand(db, workspaceId, brandKey) {
  const pageSize = 1000
  /** @type {any[]} */
  const snaps = []
  let from = 0
  let guard = 0
  while (guard++ < 40) {
    // signals->>sort_by is written by mall harvest (MH-14)
    const { data, error } = await db
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
        rank_position,
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
      `,
      )
      .eq('workspace_id', workspaceId)
      .eq('brand_key', brandKey)
      .filter('signals->>sort_by', 'eq', 'sales')
      .order('crawled_at', { ascending: false })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(error.message)
    const batch = data || []
    snaps.push(...batch)
    if (batch.length < pageSize) break
    from += pageSize
  }

  // Dedupe listing_id: prefer lower sales_rank, then newer crawl
  const byListing = new Map()
  for (const snap of snaps) {
    const id = snap.listing_id
    if (!id) continue
    const row = snapshotToBrandListingRow(snap)
    const prev = byListing.get(id)
    if (!prev) {
      byListing.set(id, row)
      continue
    }
    const pr = prev.sales_rank != null ? Number(prev.sales_rank) : 999999
    const nr = row.sales_rank != null ? Number(row.sales_rank) : 999999
    if (nr < pr) byListing.set(id, row)
    else if (nr === pr && String(row.crawled_at || '') > String(prev.crawled_at || '')) {
      byListing.set(id, row)
    }
  }

  const rows = [...byListing.values()].sort((a, b) => {
    const ar = a.sales_rank != null ? Number(a.sales_rank) : 999999
    const br = b.sales_rank != null ? Number(b.sales_rank) : 999999
    if (ar !== br) return ar - br
    return (b.sold_count_lower_bound || 0) - (a.sold_count_lower_bound || 0)
  })
  return rows
}

/**
 * @param {object[]} rows
 * @returns {object[]} rows ordered for sheet columns
 */
function orderListingRows(rows) {
  return rows.map((r) => {
    const o = {}
    for (const k of BRAND_LISTING_COLUMNS) o[k] = r[k] ?? ''
    return o
  })
}

/**
 * Build recipe **full** or **full_sales** workbook buffer.
 *
 * @param {any} db
 * @param {string} workspaceId
 * @param {{
 *   recipe?: string
 *   brand_keys?: string[]
 *   min_sold?: number
 *   shop_username?: string
 *   max_brands?: number
 *   per_brand_limit?: number  // soft note only; we still page
 * }} [opts]
 */
export async function buildBrandWorkbook(db, workspaceId, opts = {}) {
  const recipe = String(opts.recipe || 'full').toLowerCase()
  if (!SUPPORTED_RECIPES.has(recipe)) {
    throw new Error(
      `Unknown workbook recipe "${recipe}". Supported: full, full_sales`,
    )
  }
  const salesRecipe = recipe === 'full_sales'

  const maxBrands = Math.min(Math.max(Number(opts.max_brands) || 120, 1), 200)
  const listFilters = {
    min_sold: opts.min_sold,
    shop_username: opts.shop_username,
    seller_type: opts.seller_type,
    since: opts.since,
    until: opts.until,
  }

  // Brand list from rollup (SQL) — deterministic order by sold_sum desc
  const rollup = await queryBrandRollup(db, workspaceId, {
    group_by: 'brand',
    metrics: ['sku_count', 'sold_sum', 'sold_max', 'with_platform_path'],
    limit: maxBrands,
    brand_keys: opts.brand_keys,
    brand_key: opts.brand_key,
    ...listFilters,
  })

  let brandKeys = (rollup.groups || [])
    .map((g) => g.group || g.group_key || g.brand_key || g.dimension_key)
    .filter(Boolean)
    .map((k) => String(k).toLowerCase())

  if (Array.isArray(opts.brand_keys) && opts.brand_keys.length) {
    const allow = new Set(opts.brand_keys.map((b) => String(b).toLowerCase()))
    brandKeys = brandKeys.filter((k) => allow.has(k))
  }

  if (!brandKeys.length) {
    throw new Error('No brands with harvest data for this workspace / filters')
  }

  const sheetMap = allocateSheetNames(brandKeys)
  const wb = XLSX.utils.book_new()
  const indexRows = []
  let totalRows = 0
  const brandMeta = []

  for (const brandKey of brandKeys) {
    const sheet = sheetMap.get(brandKey)
    let rows
    if (salesRecipe) {
      rows = await fetchSalesSortForBrand(db, workspaceId, brandKey)
      // Fallback: latest view filtered to sales-stamped rows (partial MH-14 coverage)
      if (!rows.length) {
        const all = await fetchAllForBrand(db, workspaceId, brandKey, listFilters)
        rows = all.filter(rowLooksLikeSalesSort)
      }
    } else {
      rows = await fetchAllForBrand(db, workspaceId, brandKey, listFilters)
    }

    // Optional min_sold for sales path (not applied in SQL above)
    if (listFilters.min_sold != null && Number.isFinite(Number(listFilters.min_sold))) {
      const min = Number(listFilters.min_sold)
      rows = rows.filter((r) => (r.sold_count_lower_bound || 0) >= min)
    }

    // Attach MH-4 platform breadcrumbs (Shopee › … › leaf) even when latest snap is sales-only
    rows = await enrichRowsWithPlatformBreadcrumbs(db, workspaceId, rows)
    // Attach price from any snap when the winning latest/sales row is priceless
    rows = await enrichRowsWithPrice(db, workspaceId, rows)

    const ordered = orderListingRows(rows)
    const withPath = rows.filter(
      (r) => r.platform_category_path_text || r.platform_category_leaf,
    ).length
    const withPrice = rows.filter(
      (r) => r.price != null && r.price !== '' && Number.isFinite(Number(r.price)),
    ).length
    totalRows += ordered.length

    const soldSum = rows.reduce((s, r) => s + (Number(r.sold_count_lower_bound) || 0), 0)
    const soldMax = rows.reduce(
      (m, r) => Math.max(m, Number(r.sold_count_lower_bound) || 0),
      0,
    )
    const withRank = rows.filter((r) => r.sales_rank != null).length

    indexRows.push({
      brand_key: brandKey,
      sheet_name: sheet,
      sku_count: ordered.length,
      sold_sum: soldSum,
      sold_max: soldMax,
      with_price: withPrice,
      with_platform_path: withPath,
      ...(salesRecipe ? { with_sales_rank: withRank } : {}),
    })
    brandMeta.push({
      brand_key: brandKey,
      sheet,
      sku_count: ordered.length,
      sold_sum: soldSum,
      sold_max: soldMax,
      with_price: withPrice,
      with_platform_path: withPath,
      ...(salesRecipe ? { with_sales_rank: withRank } : {}),
    })

    const ws =
      ordered.length > 0
        ? XLSX.utils.json_to_sheet(ordered, { header: BRAND_LISTING_COLUMNS })
        : XLSX.utils.aoa_to_sheet([
            BRAND_LISTING_COLUMNS,
            salesRecipe
              ? ['(no sales-sort harvest yet — run MH-14)']
              : ['(no listings)'],
          ])
    XLSX.utils.book_append_sheet(wb, ws, sheet)
  }

  // Index first: rebuild book with index prepended
  const wbOrdered = XLSX.utils.book_new()
  const indexWs = XLSX.utils.json_to_sheet(indexRows)
  XLSX.utils.book_append_sheet(wbOrdered, indexWs, '_index')
  for (const name of wb.SheetNames) {
    XLSX.utils.book_append_sheet(wbOrdered, wb.Sheets[name], name)
  }

  const generated_at = new Date().toISOString()
  const day = generated_at.slice(0, 10)
  const filename = salesRecipe
    ? `mall-harvest-full-sales-${day}.xlsx`
    : `mall-harvest-full-${day}.xlsx`
  const buffer = XLSX.write(wbOrdered, { type: 'buffer', bookType: 'xlsx' })

  return {
    recipe,
    buffer: Buffer.from(buffer),
    filename,
    content_type:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sheet_count: wbOrdered.SheetNames.length,
    row_count: totalRows,
    brands: brandMeta,
    generated_at,
    note: salesRecipe
      ? 'Recipe full_sales (MH-14): one sheet per brand from sortBy=sales harvest. Columns include price (SGD) when any snap has it (merged). sales_rank is Shopee Top Sales grid position, not monthly units sold. sold_count_lower_bound remains cumulative lifetime. platform_category_path_text / platform_category_leaf are Shopee PDP breadcrumbs (MH-4), merged in when any snap has them. Do not re-sum in the LLM.'
      : 'Recipe full: one sheet per brand_key + _index. Columns include price (SGD) merged from any listing snapshot when present. sold_count_lower_bound is cumulative lifetime (bucketed), not a weekly rate. platform_category_path_text is the Shopee Category breadcrumb trail (e.g. Shopee > Beauty & Personal Care > Makeup > Blusher). sort_by / sales_rank appear when present. _index.with_price = rows with a price. Do not re-sum in the LLM — use the sheets.',
  }
}
