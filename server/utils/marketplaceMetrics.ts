/**
 * Compute and persist marketplace_metrics_daily from recent snapshots.
 */

import { computeSellerMixMetrics } from '../../marketplace/normalize/metrics.mjs'
import { getServiceClient } from './supabase'

export interface MetricsTickOptions {
  workspace_id?: string
  /** ISO date YYYY-MM-DD; default today UTC */
  metric_date?: string
  /** Only consider snapshots since this ISO timestamp; default start of metric_date */
  since?: string
  marketplace?: string
  country?: string
  limit_queries?: number
}

export interface MetricsTickResult {
  metric_date: string
  queries_processed: number
  rows_upserted: number
  errors: string[]
  samples: Array<Record<string, unknown>>
}

function startOfUtcDay(isoDate: string): string {
  return `${isoDate}T00:00:00.000Z`
}

function endOfUtcDay(isoDate: string): string {
  return `${isoDate}T23:59:59.999Z`
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Group latest snapshots by search_query (+ marketplace/country) and upsert metrics.
 */
export async function runMarketplaceMetricsDaily(
  options: MetricsTickOptions = {},
): Promise<MetricsTickResult> {
  const db = getServiceClient()
  const metric_date = options.metric_date || todayUtcDate()
  const since = options.since || startOfUtcDay(metric_date)
  const until = endOfUtcDay(metric_date)
  const marketplace = options.marketplace || 'shopee'
  const country = options.country || 'sg'
  const limitQueries = Math.min(Math.max(options.limit_queries ?? 50, 1), 200)

  const result: MetricsTickResult = {
    metric_date,
    queries_processed: 0,
    rows_upserted: 0,
    errors: [],
    samples: [],
  }

  // Load snapshots for the day (with listing join for title/shop)
  let q = db
    .from('marketplace_listing_snapshots')
    .select(
      `
      id,
      workspace_id,
      listing_id,
      crawled_at,
      price,
      sold_count_lower_bound,
      rank_position,
      search_query,
      seller_type,
      signals,
      marketplace_listings (
        shop_id,
        item_id,
        title,
        shop_name,
        seller_type
      )
    `,
    )
    .gte('crawled_at', since)
    .lte('crawled_at', until)
    .not('search_query', 'is', null)
    .order('crawled_at', { ascending: false })
    .limit(5000)

  if (options.workspace_id) q = q.eq('workspace_id', options.workspace_id)

  const { data: snaps, error } = await q
  if (error) throw new Error(`Failed to load snapshots: ${error.message}`)
  if (!snaps?.length) return result

  // Group by workspace + query
  type Key = string
  const groups = new Map<Key, { workspace_id: string; query: string; rows: any[] }>()

  for (const s of snaps) {
    const listing = (s as any).marketplace_listings || {}
    const query = String(s.search_query || '').trim()
    if (!query) continue
    const ws = s.workspace_id
    if (options.workspace_id && ws !== options.workspace_id) continue

    const key = `${ws}::${query}`
    if (!groups.has(key)) {
      groups.set(key, { workspace_id: ws, query, rows: [] })
    }
    const g = groups.get(key)!
    // Dedupe by listing_id keeping newest (already ordered desc)
    if (g.rows.some((r) => r.listing_id === s.listing_id)) continue
    g.rows.push({
      listing_id: s.listing_id,
      shop_id: listing.shop_id,
      item_id: listing.item_id,
      title: listing.title,
      seller_type: s.seller_type || listing.seller_type || 'unknown',
      price: s.price,
      sold_count_lower_bound: s.sold_count_lower_bound,
      rank_position: s.rank_position,
      signals: s.signals || {},
    })
  }

  let processed = 0
  for (const g of groups.values()) {
    if (processed >= limitQueries) break
    processed++
    result.queries_processed++

    const metrics = computeSellerMixMetrics(g.rows, {
      query: g.query,
      marketplace,
      country,
    })

    const row = {
      workspace_id: g.workspace_id,
      metric_date,
      marketplace,
      country,
      dimension_type: 'query',
      dimension_key: g.query,
      metrics,
    }

    const { error: upErr } = await db.from('marketplace_metrics_daily').upsert(row, {
      onConflict: 'workspace_id,metric_date,marketplace,country,dimension_type,dimension_key',
    })

    if (upErr) {
      result.errors.push(`${g.query}: ${upErr.message}`)
      continue
    }
    result.rows_upserted++
    if (result.samples.length < 5) {
      result.samples.push({
        query: g.query,
        listing_count: metrics.listing_count,
        official_store_share_pct: metrics.seller_mix.official_store_share_pct,
        undercut_count: metrics.reseller_pressure.undercut_count,
      })
    }
  }

  return result
}
