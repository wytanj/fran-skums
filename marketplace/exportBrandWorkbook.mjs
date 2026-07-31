/**
 * Recipe: **full** — multi-sheet Excel workbook of the Mall harvest.
 *
 * One worksheet per brand_key (Excel sheet name ≤31 chars, sanitized).
 * Leading sheet `_index` summarizes brand → sku_count / sold_sum / sold_max.
 *
 * Math and grouping stay in SQL/JS here — not in the LLM.
 * MCP should return a download handle (API URL or base64), not invent rows.
 */

import * as XLSX from 'xlsx'
import {
  BRAND_LISTING_COLUMNS,
  queryBrandListings,
} from './brandListingsQuery.mjs'
import { queryBrandRollup } from './brandRollupQuery.mjs'

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
 * Fetch all listing rows for one brand (pages until complete).
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
 * Build recipe **full** workbook buffer.
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
 * @returns {Promise<{
 *   recipe: string
 *   buffer: Buffer
 *   filename: string
 *   content_type: string
 *   sheet_count: number
 *   row_count: number
 *   brands: Array<{ brand_key: string, sheet: string, sku_count: number, sold_sum: number, sold_max: number }>
 *   generated_at: string
 *   note: string
 * }>}
 */
export async function buildBrandWorkbook(db, workspaceId, opts = {}) {
  const recipe = String(opts.recipe || 'full').toLowerCase()
  if (recipe !== 'full') {
    throw new Error(`Unknown workbook recipe "${recipe}". Supported: full`)
  }

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
    const rows = await fetchAllForBrand(db, workspaceId, brandKey, listFilters)
    const ordered = orderListingRows(rows)
    totalRows += ordered.length

    const soldSum = rows.reduce((s, r) => s + (Number(r.sold_count_lower_bound) || 0), 0)
    const soldMax = rows.reduce(
      (m, r) => Math.max(m, Number(r.sold_count_lower_bound) || 0),
      0,
    )

    indexRows.push({
      brand_key: brandKey,
      sheet_name: sheet,
      sku_count: ordered.length,
      sold_sum: soldSum,
      sold_max: soldMax,
    })
    brandMeta.push({
      brand_key: brandKey,
      sheet,
      sku_count: ordered.length,
      sold_sum: soldSum,
      sold_max: soldMax,
    })

    const ws =
      ordered.length > 0
        ? XLSX.utils.json_to_sheet(ordered, { header: BRAND_LISTING_COLUMNS })
        : XLSX.utils.aoa_to_sheet([BRAND_LISTING_COLUMNS, ['(no listings)']])
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
  const filename = `mall-harvest-full-${day}.xlsx`
  const buffer = XLSX.write(wbOrdered, { type: 'buffer', bookType: 'xlsx' })

  return {
    recipe: 'full',
    buffer: Buffer.from(buffer),
    filename,
    content_type:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sheet_count: wbOrdered.SheetNames.length,
    row_count: totalRows,
    brands: brandMeta,
    generated_at,
    note:
      'Recipe full: one sheet per brand_key + _index. sold_count_lower_bound is cumulative lifetime (bucketed), not a weekly rate. Do not re-sum in the LLM — use the sheets.',
  }
}
