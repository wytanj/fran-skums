import { brandsForLines } from './poBrandAliasPack.mjs'
import {
  buildMatchCatalog,
  parseCurrencyDate,
  toWideRow,
  wideStats,
} from './poCompetitiveMatch.mjs'

/**
 * @param {Record<string, unknown>} row
 */
export function iherbRecordFromPr1(row) {
  if (String(row?.match_source || '') !== 'iherb') return null
  const barcode = String(row.barcode || '').trim()
  if (!barcode) return null
  const parsed = parseCurrencyDate(row.currency_or_date_seen || row.currency)
  const priceText = String(row.price_sgd || '').trim()
  const price = priceText ? Number(priceText) : null
  const seen = parsed.date || String(row.date_seen || '').trim()
  return {
    gtin: barcode,
    url: String(row.listing_url || '').trim(),
    price: Number.isFinite(price) ? price : null,
    price_sgd: Number.isFinite(price) ? price : null,
    currency: parsed.currency || (Number.isFinite(price) ? 'SGD' : ''),
    date_seen: seen,
    captured_at: seen,
  }
}

/**
 * @param {Record<string, unknown>} hit
 */
export function iherbRecordFromRefresh(hit) {
  const barcode = String(hit?.barcode || '').trim()
  if (!barcode) return null
  const priceText = String(hit.price_sgd || '').trim()
  const price = priceText ? Number(priceText) : null
  const seen = String(hit.seen_at || hit.date_seen || '').trim()
  return {
    gtin: barcode,
    url: String(hit.url || hit.listing_url || '').trim(),
    price: Number.isFinite(price) ? price : null,
    price_sgd: Number.isFinite(price) ? price : null,
    currency: String(hit.currency || (Number.isFinite(price) ? 'SGD' : '')),
    date_seen: seen,
    captured_at: seen,
  }
}

/**
 * @param {{
 *   lines: Array<Record<string, unknown>>,
 *   iherbRefreshHits?: Array<Record<string, unknown>>,
 *   listings?: Array<Record<string, unknown>>,
 *   pack?: import('./poBrandAliasPack.mjs').PO_BRAND_ALIAS_PACK,
 * }} input
 */
export function buildWideMatrix(input) {
  const lines = input.lines || []
  const iherb = []
  for (const row of lines) {
    const record = iherbRecordFromPr1(row)
    if (record) iherb.push(record)
  }
  for (const hit of input.iherbRefreshHits || []) {
    const record = iherbRecordFromRefresh(hit)
    if (record) iherb.push(record)
  }
  const listings = input.listings || []
  const catalog = buildMatchCatalog({
    iherb,
    shopee: listings,
    brands: brandsForLines(lines, listings, input.pack),
  })
  const rows = lines.map((line) => toWideRow(line, catalog))
  return { rows, stats: wideStats(rows) }
}
