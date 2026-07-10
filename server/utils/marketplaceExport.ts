/**
 * Build sheet-ready BI export tables from marketplace snapshots.
 */

import { buildExportTable, computeSellerMixMetrics, exportRowsToCsv } from '../../marketplace/normalize/metrics.mjs'
import { getServiceClient } from './supabase'

export interface ExportTableOptions {
  workspace_id: string
  search_query?: string
  seller_type?: string
  marketplace?: string
  country?: string
  since?: string
  until?: string
  limit?: number
  format?: 'json' | 'csv'
  include_summary?: boolean
}

export async function buildMarketplaceExportTable(options: ExportTableOptions) {
  const db = getServiceClient()
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
  const marketplace = options.marketplace || 'shopee'
  const country = options.country || 'sg'

  let q = db
    .from('marketplace_listing_snapshots')
    .select(
      `
      id,
      listing_id,
      crawled_at,
      price,
      original_price,
      currency,
      rating,
      review_count,
      sold_label,
      sold_count_lower_bound,
      rank_position,
      search_query,
      seller_type,
      signals,
      marketplace_listings!inner (
        id,
        shop_id,
        item_id,
        title,
        shop_name,
        listing_url,
        seller_type,
        marketplace,
        country
      )
    `,
    )
    .eq('workspace_id', options.workspace_id)
    .order('crawled_at', { ascending: false })
    .limit(limit)

  if (options.search_query) q = q.eq('search_query', options.search_query)
  if (options.seller_type) q = q.eq('seller_type', options.seller_type)
  if (options.since) q = q.gte('crawled_at', options.since)
  if (options.until) q = q.lte('crawled_at', options.until)

  // Filter marketplace/country via join filter isn't always available; filter in app if needed
  const { data, error } = await q
  if (error) throw new Error(error.message)

  let rows = data ?? []
  rows = rows.filter((r: any) => {
    const L = r.marketplace_listings || {}
    if (marketplace && L.marketplace && L.marketplace !== marketplace) return false
    if (country && L.country && L.country !== country) return false
    return true
  })

  // Prefer latest snapshot per listing when no explicit query filter dump
  const seen = new Set<string>()
  const deduped: any[] = []
  for (const r of rows) {
    const lid = r.listing_id
    if (seen.has(lid)) continue
    seen.add(lid)
    deduped.push(r)
  }

  const table = buildExportTable(deduped, {
    marketplace,
    country,
    query: options.search_query,
  })

  // Sort by rank when present
  table.sort((a: any, b: any) => {
    const ra = a.rank ?? 9999
    const rb = b.rank ?? 9999
    return ra - rb
  })

  const summary = options.include_summary !== false
    ? computeSellerMixMetrics(
        table.map((t: any) => ({
          shop_id: t.shop_id,
          item_id: t.item_id,
          title: t.title,
          seller_type: t.seller_type,
          price: t.price,
          sold_count_lower_bound: t.sold_count_lower_bound,
          rank_position: t.rank,
          signals: {
            ships_from_overseas: t.ships_from_overseas,
            preorder: t.preorder,
          },
        })),
        {
          query: options.search_query,
          marketplace,
          country,
        },
      )
    : null

  if (options.format === 'csv') {
    return {
      format: 'csv' as const,
      csv: exportRowsToCsv(table),
      row_count: table.length,
      summary,
    }
  }

  return {
    format: 'json' as const,
    rows: table,
    row_count: table.length,
    summary,
  }
}
