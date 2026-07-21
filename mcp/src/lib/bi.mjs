/**
 * BI / marketplace warehouse operations for MCP.
 */
import {
  queryBrandListings,
  queryBrandSummary,
} from '../../../marketplace/brandListingsQuery.mjs'
import {
  buildExportTable,
  computeSellerMixMetrics,
  exportRowsToCsv,
} from '../../../marketplace/normalize/metrics.mjs'
import {
  buildJobFromSeed,
  computeNextRunAt,
  seedPatchAfterEnqueue,
} from '../../../marketplace/scheduler.mjs'
import { getDb } from '../context.mjs'

export async function listSeeds(workspaceId, filters = {}) {
  const db = getDb()
  let q = db
    .from('marketplace_crawl_seeds')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('priority', { ascending: false })
    .limit(200)
  if (filters.enabled === true) q = q.eq('enabled', true)
  if (filters.enabled === false) q = q.eq('enabled', false)
  if (filters.marketplace) q = q.eq('marketplace', filters.marketplace)
  if (filters.country) q = q.eq('country', filters.country)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function upsertSeed(workspaceId, body) {
  const db = getDb()
  const target = String(body.target || '').trim()
  if (!target) throw new Error('target is required')

  const schedule_kind = body.schedule_kind || 'daily'
  const preferred_hour = Number(body.preferred_hour ?? 2)
  const weekly_day = body.weekly_day != null ? Number(body.weekly_day) : 1
  const now = new Date()
  const next = computeNextRunAt(now, {
    schedule_kind,
    preferred_hour,
    weekly_day,
    schedule_cron: body.schedule_cron ?? null,
  })

  const row = {
    workspace_id: workspaceId,
    marketplace: body.marketplace || 'shopee',
    country: String(body.country || 'sg').toLowerCase(),
    mode: body.mode || 'keyword',
    target,
    enabled: body.enabled !== false,
    schedule_kind,
    schedule_cron: body.schedule_cron ?? null,
    timezone: body.timezone || 'Asia/Singapore',
    preferred_hour: Number.isFinite(preferred_hour) ? preferred_hour : 2,
    weekly_day: schedule_kind === 'weekly' ? weekly_day : null,
    max_pages: Number(body.max_pages ?? 3),
    max_listings: Number(body.max_listings ?? 60),
    detail_top_n: Number(body.detail_top_n ?? 15),
    priority: Number(body.priority ?? 100),
    collector_id: body.collector_id || 'mock',
    next_run_at: next ? next.toISOString() : null,
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  }

  const { data, error } = await db
    .from('marketplace_crawl_seeds')
    .upsert(row, { onConflict: 'workspace_id,marketplace,country,mode,target' })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function setSeedCadence(workspaceId, seedId, patch) {
  const db = getDb()
  const { data: existing, error } = await db
    .from('marketplace_crawl_seeds')
    .select('*')
    .eq('id', seedId)
    .eq('workspace_id', workspaceId)
    .single()
  if (error || !existing) throw new Error('Seed not found')

  const schedule_kind = patch.schedule_kind || existing.schedule_kind
  const preferred_hour =
    patch.preferred_hour != null ? Number(patch.preferred_hour) : existing.preferred_hour
  const weekly_day =
    patch.weekly_day != null ? Number(patch.weekly_day) : existing.weekly_day
  const schedule_cron =
    patch.schedule_cron !== undefined ? patch.schedule_cron : existing.schedule_cron

  const next = computeNextRunAt(new Date(), {
    schedule_kind,
    preferred_hour,
    weekly_day,
    schedule_cron,
  })

  const update = {
    schedule_kind,
    preferred_hour,
    weekly_day: schedule_kind === 'weekly' ? weekly_day : null,
    schedule_cron,
    next_run_at: next ? next.toISOString() : null,
  }
  if (patch.enabled !== undefined) update.enabled = patch.enabled
  if (patch.collector_id) update.collector_id = patch.collector_id

  const { data, error: upErr } = await db
    .from('marketplace_crawl_seeds')
    .update(update)
    .eq('id', seedId)
    .select('*')
    .single()
  if (upErr) throw new Error(upErr.message)
  return data
}

export async function runSeedNow(workspaceId, seedId) {
  const db = getDb()
  const { data: seed, error } = await db
    .from('marketplace_crawl_seeds')
    .select('*')
    .eq('id', seedId)
    .eq('workspace_id', workspaceId)
    .single()
  if (error || !seed) throw new Error('Seed not found')

  const now = new Date()
  const jobRow = {
    ...buildJobFromSeed(seed, now),
    priority: (seed.priority ?? 100) + 500,
    metadata: { enqueued_by: 'mcp_run_now', schedule_kind: seed.schedule_kind },
  }

  const { data: job, error: jobErr } = await db
    .from('marketplace_crawl_jobs')
    .insert(jobRow)
    .select('*')
    .single()
  if (jobErr) throw new Error(jobErr.message)

  await db
    .from('marketplace_crawl_seeds')
    .update({ last_enqueued_at: now.toISOString(), last_error: null })
    .eq('id', seed.id)

  return job
}

export async function listJobs(workspaceId, filters = {}) {
  const db = getDb()
  let q = db
    .from('marketplace_crawl_jobs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200))
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.seed_id) q = q.eq('seed_id', filters.seed_id)
  if (filters.job_id) q = q.eq('id', filters.job_id)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function querySnapshots(workspaceId, filters = {}) {
  const db = getDb()
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
  let q = db
    .from('marketplace_listing_snapshots')
    .select(
      `
      id, listing_id, crawl_job_id, crawled_at, price, original_price, currency,
      rating, review_count, sold_label, sold_count_lower_bound, rank_position,
      search_query, seller_type, signals,
      marketplace_listings ( shop_id, item_id, title, shop_name, listing_url, seller_type )
    `,
    )
    .eq('workspace_id', workspaceId)
    .order('crawled_at', { ascending: false })
    .limit(limit)

  if (filters.search_query) q = q.eq('search_query', filters.search_query)
  if (filters.seller_type) q = q.eq('seller_type', filters.seller_type)
  if (filters.listing_id) q = q.eq('listing_id', filters.listing_id)
  if (filters.since) q = q.gte('crawled_at', filters.since)
  if (filters.until) q = q.lte('crawled_at', filters.until)
  if (filters.min_price != null) q = q.gte('price', Number(filters.min_price))
  if (filters.max_price != null) q = q.lte('price', Number(filters.max_price))

  const { data, error } = await q
  if (error) throw new Error(error.message)

  let snapshots = data ?? []
  if (filters.overseas) {
    snapshots = snapshots.filter((s) => s.signals?.ships_from_overseas === true)
  }
  return snapshots
}

export async function exportTable(workspaceId, filters = {}) {
  const snapshots = await querySnapshots(workspaceId, {
    ...filters,
    limit: filters.limit ?? 100,
  })

  const seen = new Set()
  const deduped = []
  for (const r of snapshots) {
    if (seen.has(r.listing_id)) continue
    seen.add(r.listing_id)
    deduped.push(r)
  }

  const rows = buildExportTable(deduped, {
    marketplace: filters.marketplace || 'shopee',
    country: filters.country || 'sg',
    query: filters.search_query,
  })

  const summary = computeSellerMixMetrics(
    rows.map((t) => ({
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
      query: filters.search_query,
      marketplace: filters.marketplace || 'shopee',
      country: filters.country || 'sg',
    },
  )

  if (filters.format === 'csv') {
    return { format: 'csv', csv: exportRowsToCsv(rows), row_count: rows.length, summary }
  }
  return { format: 'json', rows, row_count: rows.length, summary }
}

export async function sellerMix(workspaceId, search_query) {
  const exported = await exportTable(workspaceId, {
    search_query,
    limit: 100,
  })
  return exported.summary
}

/**
 * Brand-radar flat listings for MCP / spreadsheets.
 * @param {string} workspaceId
 * @param {object} filters  brand_key, shop_username, min_sold, format, limit, …
 */
export async function brandListings(workspaceId, filters = {}) {
  const db = getDb()
  return queryBrandListings(db, workspaceId, {
    brand_key: filters.brand_key,
    brand_keys: filters.brand_keys,
    shop_username: filters.shop_username,
    shop_collection_name: filters.shop_collection_name,
    platform_category_leaf: filters.platform_category_leaf,
    min_sold: filters.min_sold,
    q: filters.q,
    seller_type: filters.seller_type,
    since: filters.since,
    until: filters.until,
    limit: filters.limit ?? 100,
    format: filters.format === 'csv' ? 'csv' : 'json',
  })
}

/**
 * Brand-radar summary (sold bands, top SKUs, shelf mix) for agents.
 */
export async function brandSummary(workspaceId, filters = {}) {
  const db = getDb()
  return queryBrandSummary(db, workspaceId, {
    brand_key: filters.brand_key,
    brand_keys: filters.brand_keys,
    shop_username: filters.shop_username,
    shop_collection_name: filters.shop_collection_name,
    platform_category_leaf: filters.platform_category_leaf,
    min_sold: filters.min_sold,
    q: filters.q,
    seller_type: filters.seller_type,
    limit: filters.limit ?? 500,
    top_n: filters.top_n ?? 10,
  })
}

export async function listMetrics(workspaceId, filters = {}) {
  const db = getDb()
  let q = db
    .from('marketplace_metrics_daily')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('metric_date', { ascending: false })
    .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200))
  if (filters.metric_date) q = q.eq('metric_date', filters.metric_date)
  if (filters.dimension_key) q = q.eq('dimension_key', filters.dimension_key)
  if (filters.q) q = q.ilike('dimension_key', `%${filters.q}%`)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function latestDigest(workspaceId) {
  const db = getDb()
  const { data, error } = await db
    .from('bi_digests')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function listingHistory(workspaceId, opts) {
  const db = getDb()
  let listingId = opts.listing_id
  if (!listingId && opts.shop_id && opts.item_id) {
    const { data: listing } = await db
      .from('marketplace_listings')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('shop_id', String(opts.shop_id))
      .eq('item_id', String(opts.item_id))
      .maybeSingle()
    listingId = listing?.id
  }
  if (!listingId) throw new Error('listing_id or shop_id+item_id required')

  const { data, error } = await db
    .from('marketplace_listing_snapshots')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('listing_id', listingId)
    .order('crawled_at', { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200))
  if (error) throw new Error(error.message)
  return { listing_id: listingId, snapshots: data ?? [] }
}
