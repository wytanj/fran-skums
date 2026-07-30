/**
 * RP-6 — Shopee Mall metric definitions (the semantic layer).
 *
 * Why this exists: dropping Power BI does not remove the need to define
 * metrics once, it just moves it. Without a single place that says what
 * "top seller" means, an LLM picks a different definition every conversation
 * (cumulative sold? weekly velocity? per shelf?) and nobody notices the
 * inconsistency. This module is what makes MCP chat, Track K report packs and
 * CSV export agree on the same number.
 *
 * SCOPE: Shopee Mall harvest only (marketplace bucket). These definitions read
 * `v_marketplace_listing_latest`. They say nothing about our own catalog or
 * stock — that is `inventory_ats` / `catalog_*`, and *Mall/BR ≠ ATS* holds.
 *
 * Consumed by: marketplace/brandRollupQuery.mjs · core/reports/sections.mjs
 * (marketplace.* handlers only) · mcp/src/agentInstructions.mjs
 */

/**
 * The single most misread field in this dataset. Every consumer that reports a
 * sold number must carry this caveat, or an agent will treat a lifetime
 * counter as a rate and call an old listing a bestseller.
 */
export const SOLD_FIELD_CAVEAT =
  'sold_count_lower_bound is a CUMULATIVE LIFETIME counter, bucketed by Shopee above ~1k ("4k+ sold" → 4000). It is not a rate and not a recent figure. Ranking by it ranks by age × popularity, and age dominates. Never describe it as "selling well now" — only as "has sold at least N since listing".'

/**
 * Group-by dimensions the rollup supports.
 * `column` must exist on v_marketplace_listing_latest (migration 076).
 */
export const ROLLUP_DIMENSIONS = {
  brand: {
    column: 'brand_key',
    label: 'Brand',
    description: 'Brand slug from the brand universe. NULL = unattributed (multi-brand distributor shop where title matching found no allowlist brand).',
  },
  shelf: {
    column: 'shop_collection_name',
    label: 'Seller shelf (taxonomy A)',
    description: 'Merchant-defined marketing shelf, e.g. "Serums", "Bundle SET". Seller-controlled — never equate with the Shopee platform category.',
  },
  platform_leaf: {
    column: 'platform_category_leaf',
    label: 'Shopee category leaf (taxonomy B)',
    description: 'Platform taxonomy leaf from the PDP breadcrumb (MH-4), e.g. "Eye Care". Only present on listings MH-4 has enriched — absence means not-yet-enriched, not uncategorised.',
  },
  shop: {
    column: 'shop_username',
    label: 'Mall storefront',
    description: 'Shopee shop @username. One shop may carry many brands (distributor).',
  },
}

/**
 * Metrics the rollup can compute. `sql` is the aggregate expression evaluated
 * inside the Postgres function (migration 077) — keep in sync with it.
 */
export const METRIC_DEFINITIONS = {
  sku_count: {
    label: 'Listings',
    sql: 'count(*)',
    description: 'Distinct listings in the group (one row per listing — the view already collapses observations).',
    caveat: null,
  },
  sold_sum: {
    label: 'Sold (lower bound, summed)',
    sql: 'sum(coalesce(sold_count_lower_bound, 0))',
    description: 'Sum of cumulative lifetime lower bounds across the group.',
    caveat: `${SOLD_FIELD_CAVEAT} Summing bucketed lower bounds understates the true total and is only valid for comparing groups, never as an absolute unit count.`,
  },
  sold_max: {
    label: 'Best-selling listing (lower bound)',
    sql: 'max(sold_count_lower_bound)',
    description: 'Highest lifetime lower bound in the group.',
    caveat: SOLD_FIELD_CAVEAT,
  },
  sold_avg: {
    label: 'Average sold per listing',
    sql: 'round(avg(coalesce(sold_count_lower_bound, 0)))',
    description: 'Mean lifetime lower bound across listings in the group.',
    caveat: `${SOLD_FIELD_CAVEAT} Averages are dragged down by newly listed SKUs, which have had less time to accumulate.`,
  },
  price_p50: {
    label: 'Median price',
    sql: 'percentile_cont(0.5) within group (order by price)',
    description: 'Median listed price in SGD across listings with a price.',
    caveat: 'Listed price, not transacted price. Ignores vouchers, bundles and flash discounts.',
  },
  with_platform_path: {
    label: 'MH-4 enriched',
    sql: 'count(*) filter (where platform_category_leaf is not null)',
    description: 'Listings that have a Shopee platform category from PDP enrichment.',
    caveat: 'Low values mean MH-4 has not run for those listings, not that they lack a category.',
  },
}

/**
 * Named, reusable definitions for questions people actually ask.
 * These are the phrases that must mean the same thing everywhere.
 */
export const NAMED_METRICS = {
  top_seller: {
    label: 'Top seller',
    definition: 'The listing with the highest sold_count_lower_bound within the filtered set.',
    caveat: `${SOLD_FIELD_CAVEAT} "Top seller" here means highest lifetime total, which favours older listings. It is NOT "fastest selling".`,
    resolves_to: { order_by: 'sold_count_lower_bound', direction: 'desc' },
  },
  shelf_share: {
    label: 'Shelf share',
    definition: "A shelf's listing count as a percentage of the brand's total listings.",
    caveat: 'Share of SKU count, not of revenue or units.',
    resolves_to: { group_by: 'shelf', metric: 'sku_count', as: 'percent_of_total' },
  },
  sold_band: {
    label: 'Sold band',
    definition: 'Bucketed lifetime sold: 50k+ / 10k–50k / 5k–10k / 1k–5k / 100–1k / 1–100 / unknown.',
    caveat: 'Bands exist because Shopee itself buckets the underlying number; they do not add precision it lacks.',
    resolves_to: { helper: 'soldBand' },
  },
}

/**
 * Compact block for agent prompts / tool descriptions so a model can cite the
 * definition it used instead of inventing one.
 * @returns {string}
 */
export function metricDefinitionsForAgents() {
  const dims = Object.entries(ROLLUP_DIMENSIONS)
    .map(([k, d]) => `  ${k} — ${d.label}: ${d.description}`)
    .join('\n')
  const named = Object.entries(NAMED_METRICS)
    .map(([k, m]) => `  ${k} — ${m.definition} CAVEAT: ${m.caveat}`)
    .join('\n')
  return [
    'Shopee Mall metric definitions (RP-6). Cite these; do not invent alternatives.',
    '',
    `CRITICAL: ${SOLD_FIELD_CAVEAT}`,
    '',
    'Group-by dimensions:',
    dims,
    '',
    'Named metrics:',
    named,
  ].join('\n')
}

/**
 * @param {string} name
 * @returns {{ ok: boolean, dimension?: object, error?: string }}
 */
export function resolveDimension(name) {
  const key = String(name || '').trim().toLowerCase()
  if (!ROLLUP_DIMENSIONS[key]) {
    return {
      ok: false,
      error: `Unknown group_by "${name}". Supported: ${Object.keys(ROLLUP_DIMENSIONS).join(', ')}.`,
    }
  }
  return { ok: true, dimension: { key, ...ROLLUP_DIMENSIONS[key] } }
}

/**
 * Caveats that apply to a produced rollup, so the response can carry them.
 * @param {string[]} metricNames
 * @returns {string[]}
 */
export function caveatsFor(metricNames = []) {
  const out = new Set()
  for (const m of metricNames) {
    const def = METRIC_DEFINITIONS[m]
    if (def?.caveat) out.add(def.caveat)
  }
  return [...out]
}
