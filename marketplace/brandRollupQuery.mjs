/**
 * RP-4 — aggregate-first read path for the Shopee Mall harvest.
 *
 * This is the slice that replaces "teach marketers Power BI". Their questions
 * are overwhelmingly aggregate ("which shelf is moving", "who are the top
 * sellers", "what's enriched"). Answering those with rows forces the model to
 * do arithmetic it is bad at, costs 22k+ tokens, and is not reproducible.
 * Answering them with a SQL GROUP BY is correct, deterministic, and roughly
 * constant-size no matter how large the harvest grows.
 *
 * Aggregation runs in Postgres (migration 077). Metric semantics live in
 * ./metrics/definitions.mjs (RP-6) and travel with the response so an agent
 * can cite the definition instead of inventing one.
 */

import {
  METRIC_DEFINITIONS,
  NAMED_METRICS,
  ROLLUP_DIMENSIONS,
  SOLD_FIELD_CAVEAT,
  caveatsFor,
  resolveDimension,
} from './metrics/definitions.mjs'
import { withQueryCache } from './queryCache.mjs'

const DEFAULT_METRICS = ['sku_count', 'sold_sum', 'sold_max', 'with_platform_path']

/** Normalise filters into the function's argument names. */
function rpcArgs(workspaceId, groupBy, filters = {}) {
  const lower = (v) => (v == null || v === '' ? null : String(v).trim().toLowerCase())
  const brandKeys = Array.isArray(filters.brand_keys) && filters.brand_keys.length
    ? filters.brand_keys.map((b) => String(b).trim().toLowerCase())
    : filters.brand_key
      ? [String(filters.brand_key).trim().toLowerCase()]
      : null

  const minSold =
    filters.min_sold != null && filters.min_sold !== '' && Number.isFinite(Number(filters.min_sold))
      ? Number(filters.min_sold)
      : null

  return {
    p_workspace_id: workspaceId,
    p_group_by: groupBy,
    p_brand_keys: brandKeys,
    p_shop_username: lower(filters.shop_username),
    p_shelf: filters.shop_collection_name ? String(filters.shop_collection_name).trim() : null,
    p_leaf: filters.platform_category_leaf ? String(filters.platform_category_leaf).trim() : null,
    p_min_sold: minSold,
    p_seller_type: filters.seller_type ? String(filters.seller_type).trim() : null,
    p_since: filters.since || null,
    p_until: filters.until || null,
  }
}

/**
 * Grouped aggregates over the Mall harvest.
 *
 * @param {any} db supabase client
 * @param {string} workspaceId
 * @param {{
 *   group_by?: 'brand'|'shelf'|'platform_leaf'|'shop'
 *   metrics?: string[]
 *   limit?: number
 *   brand_key?: string, brand_keys?: string[], shop_username?: string,
 *   shop_collection_name?: string, platform_category_leaf?: string,
 *   min_sold?: number, seller_type?: string, since?: string, until?: string
 * }} [opts]
 */
export async function queryBrandRollup(db, workspaceId, opts = {}) {
  // Validate before touching the cache so a bad group_by fails fast and is
  // never memoised.
  const check = resolveDimension(opts.group_by || 'brand')
  if (!check.ok) throw new Error(check.error)

  // RP-8: memoise against the snapshot fingerprint. Same question + unchanged
  // harvest = no Postgres work.
  return withQueryCache(
    db,
    workspaceId,
    'market_brand_rollup',
    opts,
    () => computeBrandRollup(db, workspaceId, opts),
    { enabled: opts.cache !== false },
  )
}

/** Uncached rollup — the work `queryBrandRollup` memoises. */
export async function computeBrandRollup(db, workspaceId, opts = {}) {
  const dim = resolveDimension(opts.group_by || 'brand')
  if (!dim.ok) throw new Error(dim.error)

  const requested = Array.isArray(opts.metrics) && opts.metrics.length
    ? opts.metrics.filter((m) => METRIC_DEFINITIONS[m])
    : DEFAULT_METRICS
  const metrics = requested.length ? requested : DEFAULT_METRICS

  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200)
  const args = rpcArgs(workspaceId, dim.dimension.key, opts)

  const [{ data, error }, { data: groupTotal, error: countErr }] = await Promise.all([
    db.rpc('marketplace_brand_rollup', { ...args, p_limit: limit }),
    db.rpc('marketplace_brand_rollup_count', args),
  ])
  if (error) throw new Error(error.message)
  if (countErr) throw new Error(countErr.message)

  const all = data || []
  // Project only the metrics asked for — every extra column is tokens.
  const groups = all.map((r) => {
    const row = { group: r.group_key }
    for (const m of metrics) {
      if (m === 'sku_count') row.sku_count = Number(r.sku_count)
      else if (m === 'sold_sum') row.sold_sum = Number(r.sold_sum)
      else if (m === 'sold_max') row.sold_max = r.sold_max == null ? null : Number(r.sold_max)
      else if (m === 'sold_avg') row.sold_avg = r.sold_avg == null ? null : Number(r.sold_avg)
      else if (m === 'price_p50') row.price_p50 = r.price_p50 == null ? null : Number(r.price_p50)
      else if (m === 'with_platform_path') row.with_platform_path = Number(r.with_platform_path)
    }
    if (r.top_title) row.top_listing = { title: r.top_title, sold_lower_bound: Number(r.top_sold) }
    return row
  })

  const totalGroups = Number(groupTotal ?? groups.length)
  const complete = groups.length >= totalGroups

  return {
    group_by: dim.dimension.key,
    dimension: {
      label: dim.dimension.label,
      description: dim.dimension.description,
    },
    metrics,
    // Same honest-truncation contract as RP-1: an agent must never have to
    // guess whether it is looking at all the groups.
    group_count: groups.length,
    total_groups: totalGroups,
    complete,
    ...(complete
      ? {}
      : { note: `Showing the top ${groups.length} of ${totalGroups} groups by sold_sum. Raise limit or narrow the filter for the rest.` }),
    filters: {
      brand_keys: args.p_brand_keys,
      shop_username: args.p_shop_username,
      shop_collection_name: args.p_shelf,
      platform_category_leaf: args.p_leaf,
      min_sold: args.p_min_sold,
    },
    groups,
    // RP-6: definitions travel with the numbers so the agent cites rather than invents.
    definitions: {
      sold_field: SOLD_FIELD_CAVEAT,
      metrics: Object.fromEntries(
        metrics.map((m) => [m, METRIC_DEFINITIONS[m]?.description]).filter(([, v]) => v),
      ),
      caveats: caveatsFor(metrics),
    },
  }
}

export { METRIC_DEFINITIONS, NAMED_METRICS, ROLLUP_DIMENSIONS }
