/**
 * Read path for iHerb warehouse (iherb_products + iherb_product_snapshots).
 * Separate from Shopee Mall market_brand_* — never mix sold metrics.
 *
 * @see core/db/086_iherb_catalogue.sql
 * @see docs/IHERB_HANDOFF.md Task 4
 */

/** 30-day rate on iHerb — not Shopee lifetime. Always surface this. */
export const IHERB_SOLD_CAVEAT =
  'iHerb sold_lower_bound is a 30-DAY RATE bucket ("4K+ sold in 30 days" → 4000, sold_period=month). ' +
  'It is NOT comparable to Shopee sold_count_lower_bound (cumulative lifetime). ' +
  'Never compute a ratio between the two. Coverage with_sold is partial — missing sold means below display floor, not zero sales.'

export const SHOPEE_SOLD_CAVEAT =
  'Shopee sold_count_lower_bound is a CUMULATIVE LIFETIME counter, bucketed above ~1k. Not a rate and not recent velocity.'

/**
 * Latest snapshot per product_row_id (first row wins when ordered desc).
 * @param {Array<Record<string, any>>} snaps
 */
export function pickLatestSnapshots(snaps) {
  const latest = new Map()
  for (const s of snaps || []) {
    const id = s.product_row_id
    if (!id || latest.has(id)) continue
    latest.set(id, s)
  }
  return latest
}

/**
 * Aggregate product+latest-snap rows into brand summary.
 * @param {Array<Record<string, any>>} joined
 */
export function summarizeIherbBrandRows(joined) {
  const prices = joined.map((r) => Number(r.price)).filter((n) => Number.isFinite(n))
  const withSold = joined.filter((r) => r.sold_lower_bound != null)
  const oos = joined.filter((r) => r.in_stock === false)
  const ratings = joined.map((r) => Number(r.rating)).filter((n) => Number.isFinite(n))
  const soldSum = withSold.reduce((s, r) => s + (Number(r.sold_lower_bound) || 0), 0)
  const reviewSum = joined.reduce((s, r) => s + (Number(r.review_count) || 0), 0)

  const min = (a) => (a.length ? Math.min(...a) : null)
  const max = (a) => (a.length ? Math.max(...a) : null)
  const avg = (a) =>
    a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 : null

  return {
    products: joined.length,
    with_price: prices.length,
    with_sold: withSold.length,
    with_rating: ratings.length,
    out_of_stock: oos.length,
    coverage_ratio_sold:
      joined.length > 0 ? Math.round((withSold.length / joined.length) * 1000) / 1000 : null,
    price_band: prices.length
      ? { min: min(prices), max: max(prices), avg: avg(prices), currency: joined.find((r) => r.currency)?.currency || 'SGD' }
      : null,
    rating: ratings.length ? { min: min(ratings), max: max(ratings), avg: avg(ratings) } : null,
    sold_30d_sum_lower: soldSum,
    review_sum: reviewSum,
    sold_period: withSold[0]?.sold_period || (withSold.length ? 'month' : null),
  }
}

/**
 * @param {any} db
 * @param {string} workspaceId
 * @param {{ brand_key?: string, brand_keys?: string[], q?: string, limit?: number, offset?: number, min_sold?: number, in_stock?: boolean }} [filters]
 */
export async function queryIherbProducts(db, workspaceId, filters = {}) {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500)
  const offset = Math.max(filters.offset ?? 0, 0)

  let pq = db
    .from('iherb_products')
    .select('id, part_number, product_id, gtin, name, brand_key, brand_name, brand_id, url, category_path_text, category_leaf, first_seen_at, last_seen_at, metadata')
    .eq('workspace_id', workspaceId)
    .order('brand_key', { ascending: true })
    .order('part_number', { ascending: true })

  if (filters.brand_key) pq = pq.eq('brand_key', String(filters.brand_key).toLowerCase())
  if (Array.isArray(filters.brand_keys) && filters.brand_keys.length) {
    pq = pq.in(
      'brand_key',
      filters.brand_keys.map((k) => String(k).toLowerCase()),
    )
  }
  if (filters.q) {
    const q = String(filters.q).replace(/%/g, '')
    pq = pq.or(`name.ilike.%${q}%,part_number.ilike.%${q}%,brand_name.ilike.%${q}%`)
  }

  // Fetch a window large enough to filter after join (sold/stock on snapshots)
  const fetchCap = Math.min(offset + limit + 200, 2000)
  const { data: products, error } = await pq.limit(fetchCap)
  if (error) throw new Error(error.message)
  const list = products || []
  if (!list.length) {
    return {
      source: 'iherb',
      columns: defaultProductColumns(),
      rows: [],
      total_matched: 0,
      returned: 0,
      offset,
      complete: true,
      next_offset: null,
      caveat: IHERB_SOLD_CAVEAT,
    }
  }

  const ids = list.map((p) => p.id)
  const snaps = []
  const chunk = 80
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk)
    const { data, error: sErr } = await db
      .from('iherb_product_snapshots')
      .select(
        'product_row_id, captured_at, price, list_price, discount_pct, currency, rating, review_count, sold_label, sold_lower_bound, sold_is_bucket, sold_period, in_stock, is_sponsored, position, signals',
      )
      .in('product_row_id', slice)
      .order('captured_at', { ascending: false })
      .limit(slice.length * 20)
    if (sErr) throw new Error(sErr.message || String(sErr))
    snaps.push(...(data || []))
  }

  const latest = pickLatestSnapshots(snaps)
  let joined = list.map((p) => {
    const s = latest.get(p.id) || {}
    return {
      part_number: p.part_number,
      product_id: p.product_id,
      gtin: p.gtin,
      name: p.name,
      brand_key: p.brand_key,
      brand_name: p.brand_name,
      brand_id: p.brand_id,
      url: p.url,
      category_path_text: p.category_path_text,
      category_leaf: p.category_leaf,
      last_seen_at: p.last_seen_at,
      price: s.price ?? null,
      list_price: s.list_price ?? null,
      discount_pct: s.discount_pct ?? null,
      currency: s.currency ?? null,
      rating: s.rating ?? null,
      review_count: s.review_count ?? null,
      sold_label: s.sold_label ?? null,
      sold_lower_bound: s.sold_lower_bound ?? null,
      sold_period: s.sold_period ?? null,
      in_stock: s.in_stock ?? null,
      is_sponsored: s.is_sponsored ?? false,
      position: s.position ?? null,
      captured_at: s.captured_at ?? null,
    }
  })

  if (filters.min_sold != null) {
    const min = Number(filters.min_sold)
    joined = joined.filter((r) => (r.sold_lower_bound ?? 0) >= min)
  }
  if (filters.in_stock === true) joined = joined.filter((r) => r.in_stock === true)
  if (filters.in_stock === false) joined = joined.filter((r) => r.in_stock === false)

  const total = joined.length
  const page = joined.slice(offset, offset + limit)
  const complete = offset + page.length >= total

  const columns = defaultProductColumns()
  const rows = page.map((r) => columns.map((c) => r[c] ?? null))

  return {
    source: 'iherb',
    columns,
    rows,
    objects: page,
    total_matched: total,
    returned: page.length,
    offset,
    complete,
    next_offset: complete ? null : offset + page.length,
    caveat: IHERB_SOLD_CAVEAT,
    agent_hint:
      'Columnar: zip columns[] with each rows[i]. sold_lower_bound is 30-day rate (sold_period=month). For Shopee use market_brand_*.',
  }
}

function defaultProductColumns() {
  return [
    'brand_key',
    'brand_name',
    'brand_id',
    'part_number',
    'name',
    'price',
    'currency',
    'rating',
    'review_count',
    'sold_label',
    'sold_lower_bound',
    'sold_period',
    'in_stock',
    'url',
    'category_path_text',
    'captured_at',
  ]
}

/**
 * Brand-level rollup over latest iHerb snapshots.
 * @param {any} db
 * @param {string} workspaceId
 * @param {{ brand_key?: string, brand_keys?: string[], limit?: number, min_products?: number }} [filters]
 */
export async function queryIherbBrands(db, workspaceId, filters = {}) {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 300)

  // Paginate — Supabase/PostgREST default max rows is often 1000
  const list = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    let pq = db
      .from('iherb_products')
      .select('id, brand_key, brand_name, brand_id')
      .eq('workspace_id', workspaceId)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)

    if (filters.brand_key) pq = pq.eq('brand_key', String(filters.brand_key).toLowerCase())
    if (Array.isArray(filters.brand_keys) && filters.brand_keys.length) {
      pq = pq.in(
        'brand_key',
        filters.brand_keys.map((k) => String(k).toLowerCase()),
      )
    }

    const { data: products, error } = await pq
    if (error) throw new Error(error.message)
    const batch = products || []
    list.push(...batch)
    if (batch.length < pageSize) break
    if (list.length >= 20000) break // hard safety
  }

  if (!list.length) {
    return {
      source: 'iherb',
      brands: [],
      brand_count: 0,
      product_count: 0,
      caveat: IHERB_SOLD_CAVEAT,
    }
  }

  const ids = list.map((p) => p.id)
  // Chunk IN queries — PostgREST GET has URL length limits (~80 UUIDs is safe)
  const snaps = []
  const chunk = 80
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk)
    const { data, error: sErr } = await db
      .from('iherb_product_snapshots')
      .select(
        'product_row_id, price, currency, rating, review_count, sold_lower_bound, sold_period, in_stock, captured_at',
      )
      .in('product_row_id', slice)
      .order('captured_at', { ascending: false })
      .limit(slice.length * 20) // enough history to pick latest per product
    if (sErr) throw new Error(sErr.message || String(sErr))
    snaps.push(...(data || []))
  }

  const latest = pickLatestSnapshots(snaps)
  const byBrand = new Map()

  for (const p of list) {
    const key = p.brand_key || 'unknown'
    if (!byBrand.has(key)) {
      byBrand.set(key, {
        brand_key: key,
        brand_name: p.brand_name || null,
        brand_id: p.brand_id || null,
        rows: [],
      })
    }
    const g = byBrand.get(key)
    if (!g.brand_name && p.brand_name) g.brand_name = p.brand_name
    if (!g.brand_id && p.brand_id) g.brand_id = p.brand_id
    const s = latest.get(p.id) || {}
    g.rows.push({
      price: s.price,
      currency: s.currency,
      rating: s.rating,
      review_count: s.review_count,
      sold_lower_bound: s.sold_lower_bound,
      sold_period: s.sold_period,
      in_stock: s.in_stock,
    })
  }

  let brands = [...byBrand.values()].map((g) => {
    const stats = summarizeIherbBrandRows(g.rows)
    return {
      brand_key: g.brand_key,
      brand_name: g.brand_name,
      brand_id: g.brand_id,
      ...stats,
    }
  })

  if (filters.min_products != null) {
    const min = Number(filters.min_products)
    brands = brands.filter((b) => b.products >= min)
  }

  brands.sort((a, b) => b.products - a.products || a.brand_key.localeCompare(b.brand_key))
  const truncated = brands.length > limit
  brands = brands.slice(0, limit)

  const product_count = list.length

  return {
    source: 'iherb',
    brands,
    brand_count: brands.length,
    brand_count_total: byBrand.size,
    product_count,
    truncated,
    caveat: IHERB_SOLD_CAVEAT,
    agent_hint:
      'iHerb K-Beauty / catalogue harvest. sold_30d_sum_lower is sum of 30-day rate lower bounds — not lifetime. Use market_iherb_products for SKUs.',
  }
}

/**
 * Side-by-side Shopee Mall vs iHerb for one brand_key.
 * Never ratios the two sold measures.
 *
 * @param {any} db
 * @param {string} workspaceId
 * @param {{ brand_key: string }} opts
 * @param {{ queryBrandSummary?: Function, queryBrandRollup?: Function }} [deps] inject for tests
 */
export async function compareBrandShopeeIherb(db, workspaceId, opts, deps = {}) {
  const brand_key = String(opts.brand_key || '').trim().toLowerCase()
  if (!brand_key) throw new Error('brand_key is required')

  // iHerb side
  const iherbBrands = await queryIherbBrands(db, workspaceId, {
    brand_key,
    limit: 5,
  })
  const iherb = iherbBrands.brands[0] || null

  // Shopee side — prefer rollup if available
  let shopee = null
  try {
    if (typeof deps.queryBrandRollup === 'function') {
      const roll = await deps.queryBrandRollup(db, workspaceId, {
        group_by: 'brand',
        brand_key,
        metrics: ['sku_count', 'sold_sum', 'sold_max', 'price_p50'],
        limit: 5,
      })
      const row = (roll.groups || roll.rows || []).find(
        (g) => String(g.brand_key || g.dimension || '').toLowerCase() === brand_key,
      ) || (roll.groups || roll.rows || [])[0]
      if (row) {
        shopee = {
          listings: row.sku_count ?? row.listings ?? null,
          sold_sum: row.sold_sum ?? null,
          sold_max: row.sold_max ?? null,
          price_p50: row.price_p50 ?? null,
          source: 'market_brand_rollup',
        }
      }
    } else if (typeof deps.queryBrandSummary === 'function') {
      const sum = await deps.queryBrandSummary(db, workspaceId, {
        brand_key,
        limit: 500,
        top_n: 5,
      })
      shopee = {
        listings: sum.sku_count ?? sum.listing_count ?? sum.total_skus ?? null,
        sold_sum: sum.sold_sum ?? sum.totals?.sold_sum ?? null,
        top: sum.top_products || sum.top || null,
        source: 'market_brand_summary',
        raw_keys: sum && typeof sum === 'object' ? Object.keys(sum).slice(0, 20) : [],
      }
      // Prefer nested totals if present
      if (sum.totals) {
        shopee.listings = sum.totals.sku_count ?? shopee.listings
        shopee.sold_sum = sum.totals.sold_sum ?? shopee.sold_sum
      }
    } else {
      // Inline light Shopee query via listings table + latest view if exists
      shopee = await lightShopeeBrandStats(db, workspaceId, brand_key)
    }
  } catch (e) {
    shopee = { error: e?.message || String(e), listings: null, sold_sum: null }
  }

  const iherbBlock = iherb
    ? {
        products: iherb.products,
        price_band: iherb.price_band,
        avg_rating: iherb.rating?.avg ?? null,
        review_sum: iherb.review_sum,
        sold_30d_sum_lower: iherb.sold_30d_sum_lower,
        with_sold: iherb.with_sold,
        coverage: {
          products: iherb.products,
          with_sold: iherb.with_sold,
          with_price: iherb.with_price,
          ratio_sold: iherb.coverage_ratio_sold,
        },
        sold_period: iherb.sold_period || 'month',
        brand_id: iherb.brand_id,
        brand_name: iherb.brand_name,
      }
    : null

  return {
    brand_key,
    shopee: shopee
      ? {
          ...shopee,
          sold_field: 'lifetime_lower_bound',
          caveat: SHOPEE_SOLD_CAVEAT,
        }
      : { listings: 0, sold_sum: null, note: 'No Shopee Mall harvest for this brand_key' },
    iherb: iherbBlock || {
      products: 0,
      note: 'No iHerb harvest for this brand_key — run iherb-kbeauty-cycle or iherb-brand-cycle',
    },
    caveat:
      'Do NOT ratio Shopee sold_sum against iHerb sold_30d_sum_lower. Different measures (lifetime vs 30-day rate). Compare price bands, assortment size, and coverage separately.',
    iherb_sold_caveat: IHERB_SOLD_CAVEAT,
    shopee_sold_caveat: SHOPEE_SOLD_CAVEAT,
    agent_hint:
      'Present two sections: Shopee Mall (lifetime sold) vs iHerb (30-day sold rate + rating). Never "X times more sold on Shopee".',
  }
}

async function lightShopeeBrandStats(db, workspaceId, brand_key) {
  // Prefer view if present
  try {
    const { data, error } = await db
      .from('v_marketplace_listing_latest')
      .select('listing_id, sold_count_lower_bound, price, brand_key')
      .eq('workspace_id', workspaceId)
      .eq('brand_key', brand_key)
      .limit(2000)
    if (!error && data) {
      const sold = data.map((r) => Number(r.sold_count_lower_bound) || 0)
      const prices = data.map((r) => Number(r.price)).filter((n) => Number.isFinite(n))
      return {
        listings: data.length,
        sold_sum: sold.reduce((a, b) => a + b, 0),
        sold_max: sold.length ? Math.max(...sold) : null,
        price_band: prices.length
          ? { min: Math.min(...prices), max: Math.max(...prices) }
          : null,
        source: 'v_marketplace_listing_latest',
      }
    }
  } catch {
    /* view may not be exposed */
  }

  // Fallback: snapshots with brand_key dimension (migration 076)
  const { data: snaps, error: sErr } = await db
    .from('marketplace_listing_snapshots')
    .select('listing_id, sold_count_lower_bound, price, brand_key, crawled_at')
    .eq('workspace_id', workspaceId)
    .eq('brand_key', brand_key)
    .order('crawled_at', { ascending: false })
    .limit(3000)
  if (sErr) throw new Error(sErr.message)
  const seen = new Set()
  const deduped = []
  for (const s of snaps || []) {
    if (seen.has(s.listing_id)) continue
    seen.add(s.listing_id)
    deduped.push(s)
  }
  const sold = deduped.map((r) => Number(r.sold_count_lower_bound) || 0)
  const prices = deduped.map((r) => Number(r.price)).filter((n) => Number.isFinite(n))
  return {
    listings: deduped.length,
    sold_sum: sold.reduce((a, b) => a + b, 0),
    sold_max: sold.length ? Math.max(...sold) : null,
    price_band: prices.length
      ? { min: Math.min(...prices), max: Math.max(...prices) }
      : null,
    source: 'marketplace_listing_snapshots',
  }
}
