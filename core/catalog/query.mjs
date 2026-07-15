/**
 * Shared catalog query helpers for Assistant + MCP (10k+ product safe).
 * Uses exact counts + paginated search — never dump the full catalog into LLM context.
 */

/**
 * @param {unknown} n
 * @param {number} fallback
 * @param {number} max
 */
export function clampLimit(n, fallback = 15, max = 25) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return fallback
  return Math.min(Math.floor(v), max)
}

/**
 * @param {string} value
 */
function sanitizeIlike(value) {
  return String(value || '')
    .replace(/[%_,]/g, ' ')
    .trim()
    .slice(0, 200)
}

/**
 * Significant tokens for DB candidate retrieval (match / search expansion).
 * @param {string} text
 * @param {number} [max]
 */
export function significantTokens(text, max = 6) {
  const stop = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'official',
    'product',
    'study',
    'brand',
    'sg',
    'ph',
    'my',
    'shopee',
    'lazada',
  ])
  const raw = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t))
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const t of raw) {
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

/**
 * Compact product row for LLM tool results.
 * @param {Record<string, any>} p
 */
export function compactProduct(p) {
  if (!p) return null
  const brand = p.brand || p.brands
  const category = p.category || p.categories
  const pd = p.product_data && typeof p.product_data === 'object' ? p.product_data : {}
  return {
    id: p.id,
    title: p.title,
    sku: p.sku || null,
    ean: p.ean || null,
    upc: p.upc || null,
    gtin: p.gtin || null,
    status: p.status,
    retail_price: p.retail_price ?? null,
    cost_price: p.cost_price ?? null,
    currency: p.currency || null,
    stock_quantity: p.stock_quantity ?? null,
    brand: brand?.name || null,
    brand_id: p.brand_id || brand?.id || null,
    category: category?.name || null,
    pos_enabled: pd.pos_enabled ?? pd.sellable_in_pos ?? null,
    import_source: pd.import_source || pd.source || null,
    updated_at: p.updated_at || null,
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{
 *   workspace_id: string,
 *   q?: string | null,
 *   status?: string | null,
 *   brand?: string | null,
 *   sku?: string | null,
 *   ean?: string | null,
 *   upc?: string | null,
 *   gtin?: string | null,
 *   limit?: number,
 *   offset?: number,
 * }} opts
 */
export async function catalogSearch(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')

  const limit = clampLimit(opts.limit, 15, 25)
  const offset = Math.max(0, Math.floor(Number(opts.offset) || 0))
  const qText = sanitizeIlike(opts.q || '')
  const status = opts.status ? String(opts.status).toLowerCase() : null

  /** @type {string[] | null} */
  let brandIds = null
  if (opts.brand) {
    const brandQ = sanitizeIlike(opts.brand)
    const { data: brands, error: bErr } = await db
      .from('brands')
      .select('id')
      .eq('workspace_id', workspace_id)
      .ilike('name', `%${brandQ}%`)
      .limit(40)
    if (bErr) throw new Error(bErr.message)
    brandIds = (brands || []).map((b) => b.id)
    if (!brandIds.length) {
      return {
        products: [],
        total: 0,
        limit,
        offset,
        has_more: false,
        filters: { q: qText || null, status, brand: opts.brand },
      }
    }
  }

  let query = db
    .from('products')
    .select(
      'id, title, sku, ean, upc, gtin, status, retail_price, cost_price, currency, stock_quantity, brand_id, product_data, updated_at, brand:brand_id(id, name), category:category_id(id, name)',
      { count: 'exact' },
    )
    .eq('workspace_id', workspace_id)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status && ['draft', 'active', 'archived'].includes(status)) {
    query = query.eq('status', status)
  }
  if (brandIds) query = query.in('brand_id', brandIds)
  if (opts.sku) query = query.ilike('sku', `%${sanitizeIlike(opts.sku)}%`)
  if (opts.ean) query = query.eq('ean', String(opts.ean).trim())
  if (opts.upc) query = query.eq('upc', String(opts.upc).trim())
  if (opts.gtin) query = query.eq('gtin', String(opts.gtin).trim())

  if (qText) {
    // title / sku / ean / upc
    query = query.or(
      `title.ilike.%${qText}%,sku.ilike.%${qText}%,ean.eq.${qText},upc.eq.${qText},gtin.eq.${qText}`,
    )
  }

  const { data, count, error } = await query
  if (error) throw new Error(error.message)

  const products = (data || []).map(compactProduct)
  const total = count ?? products.length
  return {
    products,
    total,
    limit,
    offset,
    has_more: offset + products.length < total,
    filters: {
      q: qText || null,
      status,
      brand: opts.brand || null,
      sku: opts.sku || null,
      ean: opts.ean || null,
    },
  }
}

/**
 * Exact catalog census for large imports (do not invent totals in prompts).
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{ workspace_id: string, brand?: string | null, top_brands?: number }} opts
 */
export async function catalogStats(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')
  const topN = Math.min(Math.max(Number(opts.top_brands) || 12, 1), 25)

  /** @type {string[] | null} */
  let brandIds = null
  if (opts.brand) {
    const brandQ = sanitizeIlike(opts.brand)
    const { data: brands } = await db
      .from('brands')
      .select('id, name')
      .eq('workspace_id', workspace_id)
      .ilike('name', `%${brandQ}%`)
      .limit(40)
    brandIds = (brands || []).map((b) => b.id)
    if (!brandIds.length) {
      return {
        total: 0,
        by_status: { draft: 0, active: 0, archived: 0 },
        missing_sku: 0,
        with_ean: 0,
        brand_filter: opts.brand,
        top_brands: [],
      }
    }
  }

  /**
   * @param {(q: any) => any} apply
   */
  async function countWhere(apply) {
    let q = db
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id)
    if (brandIds) q = q.in('brand_id', brandIds)
    q = apply(q)
    const { count, error } = await q
    if (error) throw new Error(error.message)
    return count || 0
  }

  const [total, draft, active, archived, missing_sku, with_ean] = await Promise.all([
    countWhere((q) => q),
    countWhere((q) => q.eq('status', 'draft')),
    countWhere((q) => q.eq('status', 'active')),
    countWhere((q) => q.eq('status', 'archived')),
    countWhere((q) => q.is('sku', null)),
    countWhere((q) => q.not('ean', 'is', null)),
  ])

  // Brand facet: sample brand_ids (bounded) then resolve names
  let brandQuery = db
    .from('products')
    .select('brand_id')
    .eq('workspace_id', workspace_id)
    .not('brand_id', 'is', null)
    .limit(5000)
  if (brandIds) brandQuery = brandQuery.in('brand_id', brandIds)
  const { data: brandRows, error: brandErr } = await brandQuery
  if (brandErr) throw new Error(brandErr.message)

  /** @type {Map<string, number>} */
  const brandCounts = new Map()
  for (const row of brandRows || []) {
    if (!row.brand_id) continue
    brandCounts.set(row.brand_id, (brandCounts.get(row.brand_id) || 0) + 1)
  }
  const topBrandIds = [...brandCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([id]) => id)

  /** @type {Array<{ brand_id: string, name: string, count: number }>} */
  let top_brands = []
  if (topBrandIds.length) {
    const { data: brandNames } = await db
      .from('brands')
      .select('id, name')
      .eq('workspace_id', workspace_id)
      .in('id', topBrandIds)
    const nameMap = new Map((brandNames || []).map((b) => [b.id, b.name]))
    top_brands = topBrandIds.map((id) => ({
      brand_id: id,
      name: nameMap.get(id) || id,
      count: brandCounts.get(id) || 0,
    }))
  }

  return {
    total,
    by_status: { draft, active, archived },
    missing_sku,
    with_ean,
    brand_filter: opts.brand || null,
    top_brands,
    note:
      brandRows && brandRows.length >= 5000
        ? 'top_brands derived from first 5000 branded rows (approx facet)'
        : null,
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{
 *   workspace_id: string,
 *   id?: string | null,
 *   sku?: string | null,
 *   ean?: string | null,
 *   upc?: string | null,
 *   gtin?: string | null,
 * }} opts
 */
export async function catalogGet(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')
  if (!opts.id && !opts.sku && !opts.ean && !opts.upc && !opts.gtin) {
    throw new Error('Provide id, sku, ean, upc, or gtin')
  }

  let query = db
    .from('products')
    .select(
      '*, brand:brand_id(id, name), category:category_id(id, name), images:product_images(id, url, position), variants:product_variants(id, title, sku, retail_price)',
    )
    .eq('workspace_id', workspace_id)

  if (opts.id) query = query.eq('id', String(opts.id))
  else if (opts.sku) query = query.eq('sku', String(opts.sku).trim())
  else if (opts.ean) query = query.eq('ean', String(opts.ean).trim())
  else if (opts.upc) query = query.eq('upc', String(opts.upc).trim())
  else if (opts.gtin) query = query.eq('gtin', String(opts.gtin).trim())

  const { data, error } = await query.limit(2)
  if (error) throw new Error(error.message)
  if (!data?.length) return { product: null, matches: 0 }
  if (data.length > 1) {
    return {
      product: null,
      matches: data.length,
      ambiguous: data.map(compactProduct),
      error: 'Multiple products matched; refine with id',
    }
  }

  const p = data[0]
  return {
    product: {
      ...compactProduct(p),
      description: p.description || null,
      short_description: p.short_description || null,
      tags: p.tags || [],
      product_data: p.product_data || {},
      images: (p.images || []).slice(0, 8),
      variants: (p.variants || []).slice(0, 20),
    },
    matches: 1,
  }
}

/**
 * DB-side candidate pool for study match (avoids "last 200 updated" on 10k catalogs).
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{
 *   workspace_id: string,
 *   query?: string | null,
 *   listing_titles?: string[],
 *   limit?: number,
 * }} opts
 */
export async function fetchCatalogMatchPool(db, opts) {
  const workspace_id = opts.workspace_id
  const limit = clampLimit(opts.limit, 200, 300)
  const text = [opts.query, ...(opts.listing_titles || []).slice(0, 8)].filter(Boolean).join(' ')
  const tokens = significantTokens(text, 6)

  /** @type {Map<string, Record<string, any>>} */
  const byId = new Map()

  async function pull(filterFn) {
    let q = db
      .from('products')
      .select('id, title, sku, retail_price, brand:brand_id(name)')
      .eq('workspace_id', workspace_id)
      .limit(80)
    q = filterFn(q)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    for (const p of data || []) {
      if (!byId.has(p.id)) {
        byId.set(p.id, {
          id: p.id,
          title: p.title,
          sku: p.sku,
          retail_price: p.retail_price,
          brand_name: p.brand?.name || null,
        })
      }
    }
  }

  // Exact-ish token ilike OR sku hits
  for (const token of tokens) {
    if (byId.size >= limit) break
    await pull((q) => q.or(`title.ilike.%${token}%,sku.ilike.%${token}%`))
  }

  // If still thin, add recent products as weak fallback (not sole source)
  if (byId.size < 40) {
    const { data, error } = await db
      .from('products')
      .select('id, title, sku, retail_price, brand:brand_id(name)')
      .eq('workspace_id', workspace_id)
      .order('updated_at', { ascending: false })
      .limit(Math.min(120, limit))
    if (error) throw new Error(error.message)
    for (const p of data || []) {
      if (!byId.has(p.id)) {
        byId.set(p.id, {
          id: p.id,
          title: p.title,
          sku: p.sku,
          retail_price: p.retail_price,
          brand_name: p.brand?.name || null,
        })
      }
      if (byId.size >= limit) break
    }
  }

  return {
    products: [...byId.values()].slice(0, limit),
    tokens_used: tokens,
    pool_size: Math.min(byId.size, limit),
  }
}

/**
 * @param {number[]} nums
 */
function costStats(nums) {
  const vals = nums.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  if (!vals.length) {
    return { count: 0, min: null, max: null, median: null, mean: null }
  }
  const min = vals[0]
  const max = vals[vals.length - 1]
  const mid = Math.floor(vals.length / 2)
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2
  const mean = vals.reduce((s, n) => s + n, 0) / vals.length
  return {
    count: vals.length,
    min: roundMoney(min),
    max: roundMoney(max),
    median: roundMoney(median),
    mean: roundMoney(mean),
  }
}

function roundMoney(n) {
  return Math.round(n * 100) / 100
}

/**
 * One-shot catalog health for large imports (prefer this over multi-step sampling).
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{ workspace_id: string, brand?: string | null, sample_for_cost?: number }} opts
 */
export async function catalogHealth(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')
  const sampleN = Math.min(Math.max(Number(opts.sample_for_cost) || 2000, 100), 5000)

  /** @type {string[] | null} */
  let brandIds = null
  if (opts.brand) {
    const brandQ = sanitizeIlike(opts.brand)
    const { data: brands } = await db
      .from('brands')
      .select('id')
      .eq('workspace_id', workspace_id)
      .ilike('name', `%${brandQ}%`)
      .limit(40)
    brandIds = (brands || []).map((b) => b.id)
    if (!brandIds.length) {
      return {
        total: 0,
        catalog_mode_guess: 'empty',
        agent_hint: 'No products match brand filter. Do not invent rankings.',
        brand_filter: opts.brand,
      }
    }
  }

  /**
   * @param {(q: any) => any} apply
   */
  async function countWhere(apply) {
    let q = db
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id)
    if (brandIds) q = q.in('brand_id', brandIds)
    q = apply(q)
    const { count, error } = await q
    if (error) throw new Error(error.message)
    return count || 0
  }

  const baseStats = await catalogStats(db, {
    workspace_id,
    brand: opts.brand || null,
    top_brands: 10,
  })

  const [
    missing_retail,
    with_cost,
    missing_category,
    with_upc,
    with_gtin,
  ] = await Promise.all([
    countWhere((q) => q.is('retail_price', null)),
    countWhere((q) => q.not('cost_price', 'is', null)),
    countWhere((q) => q.is('category_id', null)),
    countWhere((q) => q.not('upc', 'is', null)),
    countWhere((q) => q.not('gtin', 'is', null)),
  ])

  // Sample product_data + prices for pos_enabled / import_source / cost distribution
  let sampleQ = db
    .from('products')
    .select('cost_price, retail_price, stock_quantity, product_data, currency')
    .eq('workspace_id', workspace_id)
    .order('updated_at', { ascending: false })
    .limit(sampleN)
  if (brandIds) sampleQ = sampleQ.in('brand_id', brandIds)
  const { data: sampleRows, error: sampleErr } = await sampleQ
  if (sampleErr) throw new Error(sampleErr.message)

  let pos_enabled_true = 0
  let pos_enabled_false = 0
  let pos_enabled_unknown = 0
  /** @type {Map<string, number>} */
  const importSources = new Map()
  /** @type {number[]} */
  const costs = []
  let stock_zero = 0
  let stock_positive = 0
  let currencies = new Map()

  for (const row of sampleRows || []) {
    const pd = row.product_data && typeof row.product_data === 'object' ? row.product_data : {}
    const pe = pd.pos_enabled ?? pd.sellable_in_pos
    if (pe === true || pe === 'true' || pe === 1) pos_enabled_true += 1
    else if (pe === false || pe === 'false' || pe === 0) pos_enabled_false += 1
    else pos_enabled_unknown += 1

    const src = String(pd.import_source || pd.source || '').trim() || '(none)'
    importSources.set(src, (importSources.get(src) || 0) + 1)

    if (row.cost_price != null && Number(row.cost_price) > 0) costs.push(Number(row.cost_price))
    const sq = Number(row.stock_quantity)
    if (!Number.isFinite(sq) || sq <= 0) stock_zero += 1
    else stock_positive += 1

    const cur = String(row.currency || 'unknown')
    currencies.set(cur, (currencies.get(cur) || 0) + 1)
  }

  const sampleSize = (sampleRows || []).length || 1
  const pct = (n) => Math.round((n / sampleSize) * 1000) / 10

  const total = baseStats.total || 0
  const missingRetailPct = total ? Math.round((missing_retail / total) * 1000) / 10 : 0
  const posOffHeavy = pct(pos_enabled_false) >= 80
  const retailNullHeavy = missingRetailPct >= 80
  const stockFieldZeroHeavy = pct(stock_zero) >= 80

  let catalog_mode_guess = 'live_ops'
  if (total === 0) catalog_mode_guess = 'empty'
  else if (retailNullHeavy && posOffHeavy) catalog_mode_guess = 'cost_import_not_operationalized'
  else if (retailNullHeavy) catalog_mode_guess = 'cost_list_missing_retail'
  else if (posOffHeavy) catalog_mode_guess = 'active_but_pos_disabled'

  const import_source_top = [...importSources.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([source, count]) => ({ source, count, pct_of_sample: pct(count) }))

  const agent_hint =
    catalog_mode_guess === 'cost_import_not_operationalized'
      ? 'Do NOT invent “best products” from performance. Catalog has identity + cost only; retail often null; POS mostly off; product.stock_quantity is not inventory ledger ATS. Prefer defining best by cost/brand/category, bulk Activate for POS, or seed market crawls. For physical stock use inventory tools / LOFT-SG levels when available.'
      : catalog_mode_guess === 'empty'
        ? 'Catalog empty — cannot rank or research products.'
        : 'Use catalog_search_summary for category research; inventory_ats for real on-hand (not stock_quantity on product rows).'

  return {
    total,
    by_status: baseStats.by_status,
    missing_sku: baseStats.missing_sku,
    with_ean: baseStats.with_ean,
    with_upc,
    with_gtin,
    missing_retail_price: missing_retail,
    missing_retail_price_pct: missingRetailPct,
    with_cost_price: with_cost,
    missing_category: missing_category,
    top_brands: baseStats.top_brands,
    sample: {
      size: sampleSize,
      note: sampleSize >= sampleN ? `cost/pos/import facets from newest ${sampleSize} rows (approx)` : 'full sample within limit',
      pos_enabled_true,
      pos_enabled_false,
      pos_enabled_unknown,
      pos_enabled_false_pct: pct(pos_enabled_false),
      product_row_stock_zero: stock_zero,
      product_row_stock_zero_pct: pct(stock_zero),
      cost: costStats(costs),
      currencies: [...currencies.entries()].map(([currency, count]) => ({ currency, count })),
      import_source_top,
    },
    catalog_mode_guess,
    signals: {
      retail_null_heavy: retailNullHeavy,
      pos_off_heavy: posOffHeavy,
      product_stock_field_zero_heavy: stockFieldZeroHeavy,
      stock_quantity_is_not_ledger_ats: true,
    },
    agent_hint,
    brand_filter: opts.brand || null,
    deep_links: {
      products: '/products',
      import: '/import-export',
      activate_for_pos_help: '/help/activate-for-pos',
      inventory: '/inventory',
      store_ops: '/store-ops',
    },
  }
}

/**
 * Stratified / multi-offset sample for research (one call instead of ad-hoc offsets).
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{
 *   workspace_id: string,
 *   n?: number,
 *   q?: string | null,
 *   brand?: string | null,
 *   status?: string | null,
 *   strategy?: 'spread' | 'recent' | 'keyword',
 * }} opts
 */
export async function catalogSample(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')
  const n = Math.min(Math.max(Number(opts.n) || 5, 1), 20)
  const strategy = opts.strategy || (opts.q ? 'keyword' : 'spread')

  // Total for spread offsets
  const base = await catalogSearch(db, {
    workspace_id,
    q: opts.q || null,
    brand: opts.brand || null,
    status: opts.status || null,
    limit: 1,
    offset: 0,
  })
  const total = base.total || 0
  if (!total) {
    return {
      products: [],
      total: 0,
      n,
      strategy,
      filters: { q: opts.q || null, brand: opts.brand || null, status: opts.status || null },
      note: 'No products matched filters.',
    }
  }

  /** @type {Map<string, ReturnType<typeof compactProduct>>} */
  const byId = new Map()

  async function pullAt(offset, limit) {
    const page = await catalogSearch(db, {
      workspace_id,
      q: opts.q || null,
      brand: opts.brand || null,
      status: opts.status || null,
      limit: Math.min(limit, 25),
      offset: Math.max(0, Math.min(offset, Math.max(0, total - 1))),
    })
    for (const p of page.products || []) {
      if (p?.id && !byId.has(p.id)) byId.set(p.id, p)
    }
  }

  if (strategy === 'recent' || strategy === 'keyword') {
    await pullAt(0, n)
  } else {
    // spread: head, ~20%, ~50%, ~75%, tail
    const fracs = n <= 5
      ? [0, 0.2, 0.5, 0.75, 0.95]
      : Array.from({ length: n }, (_, i) => (n === 1 ? 0 : i / (n - 1)))
    for (const f of fracs.slice(0, n)) {
      if (byId.size >= n) break
      const off = Math.floor(f * Math.max(0, total - 1))
      await pullAt(off, Math.min(3, n))
    }
    // fill if duplicates
    let fillOff = 0
    while (byId.size < n && fillOff < total) {
      await pullAt(fillOff, Math.min(10, n - byId.size + 2))
      fillOff += 10
      if (fillOff > total + 10) break
    }
  }

  const products = [...byId.values()].slice(0, n)
  const costs = products.map((p) => Number(p.cost_price)).filter((x) => Number.isFinite(x) && x > 0)

  return {
    products,
    total_matching: total,
    n: products.length,
    strategy,
    cost_in_sample: costStats(costs),
    filters: { q: opts.q || null, brand: opts.brand || null, status: opts.status || null },
    note:
      'Sample only — not “best”. product.stock_quantity is not LOFT/store ATS. retail_price may be null on cost imports.',
    agent_hint:
      'Do not claim market demand or sell-through from this sample alone. Use catalog_health once for catalog-wide structure.',
  }
}

/**
 * Search + summary stats in one call (e.g. “lipsticks”).
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{
 *   workspace_id: string,
 *   q?: string | null,
 *   brand?: string | null,
 *   status?: string | null,
 *   limit?: number,
 *   facet_sample?: number,
 * }} opts
 */
export async function catalogSearchSummary(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')
  const limit = clampLimit(opts.limit, 10, 25)
  const facetN = Math.min(Math.max(Number(opts.facet_sample) || 400, 50), 800)

  const page = await catalogSearch(db, {
    workspace_id,
    q: opts.q || null,
    brand: opts.brand || null,
    status: opts.status || null,
    limit,
    offset: 0,
  })

  // Facet sample: first facetN matches by updated_at (same filters, larger page)
  const facetPage = await catalogSearch(db, {
    workspace_id,
    q: opts.q || null,
    brand: opts.brand || null,
    status: opts.status || null,
    limit: Math.min(25, facetN),
    offset: 0,
  })

  // Pull more pages for facets (bounded)
  /** @type {typeof facetPage.products} */
  let facetProducts = [...(facetPage.products || [])]
  let off = facetPage.products?.length || 0
  while (facetProducts.length < facetN && off < (page.total || 0) && off < facetN + 50) {
    const more = await catalogSearch(db, {
      workspace_id,
      q: opts.q || null,
      brand: opts.brand || null,
      status: opts.status || null,
      limit: 25,
      offset: off,
    })
    if (!more.products?.length) break
    facetProducts = facetProducts.concat(more.products)
    off += more.products.length
    if (!more.has_more) break
  }
  facetProducts = facetProducts.slice(0, facetN)

  /** @type {Map<string, number>} */
  const brandMap = new Map()
  /** @type {Map<string, number>} */
  const statusMap = new Map()
  const costs = []
  let missing_retail = 0
  let pos_on = 0
  let pos_off = 0

  for (const p of facetProducts) {
    const b = p.brand || '(no brand)'
    brandMap.set(b, (brandMap.get(b) || 0) + 1)
    const st = p.status || 'unknown'
    statusMap.set(st, (statusMap.get(st) || 0) + 1)
    if (p.retail_price == null) missing_retail += 1
    if (p.cost_price != null && Number(p.cost_price) > 0) costs.push(Number(p.cost_price))
    if (p.pos_enabled === true) pos_on += 1
    else if (p.pos_enabled === false) pos_off += 1
  }

  const top_brands = [...brandMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }))

  return {
    query: opts.q || null,
    total_matching: page.total,
    products: page.products,
    limit: page.limit,
    has_more: page.has_more,
    facets: {
      sample_size: facetProducts.length,
      note:
        facetProducts.length < (page.total || 0)
          ? `Facets from first ${facetProducts.length} of ${page.total} matches (newest first)`
          : 'Facets from all matches',
      top_brands,
      by_status: Object.fromEntries(statusMap),
      missing_retail_in_sample: missing_retail,
      pos_enabled_true_in_sample: pos_on,
      pos_enabled_false_in_sample: pos_off,
      cost: costStats(costs),
    },
    filters: page.filters,
    agent_hint:
      page.total === 0
        ? 'No matches — try a broader keyword.'
        : 'This is catalog identity/cost summary, not market demand. For stock use inventory_ats when available; do not invent rankings from cost alone unless user asked for cost-based picks.',
  }
}

/**
 * Escape one CSV cell (RFC-style quotes).
 * @param {unknown} value
 */
export function escapeCsvCell(value) {
  if (value == null || value === '') return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * @param {string[]} headers
 * @param {Array<Record<string, unknown>>} rows
 */
export function rowsToCsv(headers, rows) {
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h])).join(','))
  }
  return lines.join('\n') + '\n'
}

const EXPORT_HEADERS = [
  'id',
  'title',
  'sku',
  'ean',
  'upc',
  'gtin',
  'brand',
  'category',
  'status',
  'retail_price',
  'cost_price',
  'currency',
  'pos_enabled',
  'import_source',
]

/**
 * Bounded catalog CSV export (never full 10k dump into the agent).
 * Default 50 rows, hard max 200. Prefer filters (q/brand/status).
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{
 *   workspace_id: string,
 *   q?: string | null,
 *   brand?: string | null,
 *   status?: string | null,
 *   sku?: string | null,
 *   limit?: number,
 *   offset?: number,
 *   columns?: string[] | null,
 * }} opts
 */
export async function catalogExportCsv(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')

  const limit = clampLimit(opts.limit, 50, 200)
  const offset = Math.max(0, Math.floor(Number(opts.offset) || 0))
  const qText = sanitizeIlike(opts.q || '')
  const status = opts.status ? String(opts.status).toLowerCase() : null

  /** @type {string[] | null} */
  let brandIds = null
  if (opts.brand) {
    const brandQ = sanitizeIlike(opts.brand)
    const { data: brands, error: bErr } = await db
      .from('brands')
      .select('id')
      .eq('workspace_id', workspace_id)
      .ilike('name', `%${brandQ}%`)
      .limit(40)
    if (bErr) throw new Error(bErr.message)
    brandIds = (brands || []).map((b) => b.id)
    if (!brandIds.length) {
      return {
        csv: rowsToCsv(EXPORT_HEADERS, []),
        row_count: 0,
        total_matching: 0,
        truncated: false,
        limit,
        offset,
        columns: EXPORT_HEADERS,
        filters: { q: qText || null, brand: opts.brand, status, sku: opts.sku || null },
        note: 'No brands matched filter.',
        agent_hint: 'Widen brand filter or drop it. CSV is empty.',
      }
    }
  }

  let query = db
    .from('products')
    .select(
      'id, title, sku, ean, upc, gtin, status, retail_price, cost_price, currency, product_data, updated_at, brand:brand_id(name), category:category_id(name)',
      { count: 'exact' },
    )
    .eq('workspace_id', workspace_id)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status && ['draft', 'active', 'archived'].includes(status)) {
    query = query.eq('status', status)
  }
  if (brandIds) query = query.in('brand_id', brandIds)
  if (opts.sku) query = query.ilike('sku', `%${sanitizeIlike(opts.sku)}%`)
  if (qText) {
    query = query.or(
      `title.ilike.%${qText}%,sku.ilike.%${qText}%,ean.eq.${qText},upc.eq.${qText},gtin.eq.${qText}`,
    )
  }

  const { data, count, error } = await query
  if (error) throw new Error(error.message)

  const total_matching = count ?? (data || []).length
  const rows = (data || []).map((p) => {
    const pd = p.product_data && typeof p.product_data === 'object' ? p.product_data : {}
    return {
      id: p.id,
      title: p.title,
      sku: p.sku || '',
      ean: p.ean || '',
      upc: p.upc || '',
      gtin: p.gtin || '',
      brand: p.brand?.name || '',
      category: p.category?.name || '',
      status: p.status || '',
      retail_price: p.retail_price ?? '',
      cost_price: p.cost_price ?? '',
      currency: p.currency || '',
      pos_enabled: pd.pos_enabled ?? pd.sellable_in_pos ?? '',
      import_source: pd.import_source || pd.source || '',
    }
  })

  let headers = EXPORT_HEADERS
  if (Array.isArray(opts.columns) && opts.columns.length) {
    const allowed = new Set(EXPORT_HEADERS)
    const picked = opts.columns.map(String).filter((c) => allowed.has(c))
    if (picked.length) headers = picked
  }

  const csv = rowsToCsv(headers, rows)
  const truncated = offset + rows.length < total_matching

  return {
    csv,
    row_count: rows.length,
    total_matching,
    truncated,
    limit,
    offset,
    columns: headers,
    filters: {
      q: qText || null,
      brand: opts.brand || null,
      status,
      sku: opts.sku || null,
    },
    note: truncated
      ? `Exported ${rows.length} of ${total_matching} matches (max ${limit} per call). Raise offset or tighten filters for the rest.`
      : `Exported ${rows.length} row(s).`,
    agent_hint:
      'Return CSV as a fenced code block or downloadable text. retail_price/pos_enabled may be blank on cost-only imports — do not invent values. For full catalog use /import-export in the app, not unbounded MCP export.',
    deep_links: { import_export: '/import-export', products: '/products' },
  }
}

/**
 * Data ops composite: intentional retail/POS flags + market seed plan (read-only suggestions).
 * Does not write seeds or activate POS.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{
 *   workspace_id: string,
 *   brand?: string | null,
 *   q?: string | null,
 *   seed_suggestions?: number,
 *   marketplace?: string | null,
 *   country?: string | null,
 * }} opts
 */
export async function catalogDataOps(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')

  const health = await catalogHealth(db, {
    workspace_id,
    brand: opts.brand || null,
  })

  const sampleN = Math.min(Math.max(Number(opts.seed_suggestions) || 5, 1), 12)
  const sample = await catalogSample(db, {
    workspace_id,
    n: sampleN,
    q: opts.q || null,
    brand: opts.brand || null,
    strategy: opts.q ? 'keyword' : 'spread',
  })

  // Existing crawl seeds (read)
  let existing_seeds = []
  let seeds_error = null
  try {
    const { data, error } = await db
      .from('marketplace_crawl_seeds')
      .select('id, marketplace, country, mode, target, enabled, schedule_kind, priority, next_run_at')
      .eq('workspace_id', workspace_id)
      .order('priority', { ascending: false })
      .limit(30)
    if (error) seeds_error = error.message
    else existing_seeds = data || []
  } catch (e) {
    seeds_error = e instanceof Error ? e.message : String(e)
  }

  const mode = health.catalog_mode_guess
  const retailHeavy = health.signals?.retail_null_heavy
  const posHeavy = health.signals?.pos_off_heavy

  /** @type {string} */
  let intentional_read =
    'Mixed or unknown — inspect sample retail_price and pos_enabled before bulk changes.'
  if (mode === 'cost_import_not_operationalized') {
    intentional_read =
      'Likely bulk cost import: retail mostly null, POS mostly off, stock_quantity field zero. That is often intentional for a supplier cost list — not yet a live sellable catalog. Do not treat as “all OOS.”'
  } else if (mode === 'cost_list_missing_retail') {
    intentional_read =
      'Costs present but retail missing — set retail deliberately before margin or POS activation.'
  } else if (mode === 'active_but_pos_disabled') {
    intentional_read =
      'Products active but POS sellable flag off — activation is a deliberate HQ step (Activate for POS), not automatic from status=active.'
  } else if (mode === 'empty') {
    intentional_read = 'Catalog empty — import or create products before data ops.'
  } else if (mode === 'live_ops') {
    intentional_read =
      'Looks closer to operational catalog (retail/POS not bulk-empty). Still verify per SKU before mass edits.'
  }

  /** @type {Array<{ action: string, why: string, path?: string, mcp_note?: string }>} */
  const recommended_actions = []
  if (mode === 'empty') {
    recommended_actions.push({
      action: 'import_catalog',
      why: 'No products to operate on',
      path: '/import-export',
    })
  } else {
    if (retailHeavy) {
      recommended_actions.push({
        action: 'set_retail_prices_intentionally',
        why: `${health.missing_retail_price_pct ?? '?'}% missing retail in census — fill retail before margin/POS claims`,
        path: '/import-export',
        mcp_note: 'Use catalog_export_csv filtered subset, edit retail_price offline, re-import upsert by SKU',
      })
    }
    if (posHeavy) {
      recommended_actions.push({
        action: 'activate_for_pos_when_ready',
        why: 'POS flags mostly off — only enable products you intend to sell on register',
        path: '/help/activate-for-pos',
        mcp_note: 'MCP cannot bulk-activate POS; humans use product UI / future bulk tools',
      })
    }
    recommended_actions.push({
      action: 'seed_market_research_for_priority_skus',
      why: 'Market warehouse is often empty until crawl seeds exist — pick extremes or top brands first',
      path: '/actions',
      mcp_note:
        'Safe: pipeline_propose kind=watchlist_seed. Full profile only: bi_upsert_seed. Never invent demand without snapshots.',
    })
    recommended_actions.push({
      action: 'use_inventory_ats_for_stock',
      why: 'product.stock_quantity is not ledger ATS',
      path: '/inventory',
      mcp_note: 'product_inventory_status / inventory_ats',
    })
  }

  const marketplace = String(opts.marketplace || 'shopee').toLowerCase()
  const country = String(opts.country || 'sg').toLowerCase()

  /** @type {Array<Record<string, any>>} */
  const seed_suggestions = []
  const seenTargets = new Set(existing_seeds.map((s) => String(s.target || '').toLowerCase()))

  // Prefer brand-level seeds + a few product titles from sample
  for (const b of (health.top_brands || []).slice(0, 4)) {
    const target = String(b.name || '').trim()
    if (!target || seenTargets.has(target.toLowerCase())) continue
    seenTargets.add(target.toLowerCase())
    seed_suggestions.push({
      target,
      mode: 'keyword',
      marketplace,
      country,
      reason: `top brand (${b.count} products)`,
      pipeline_propose_sketch: {
        kind: 'watchlist_seed',
        title: `Watch ${target} on ${marketplace} ${country}`,
        payload: { target, marketplace, country, mode: 'keyword' },
      },
    })
  }

  for (const p of sample.products || []) {
    if (seed_suggestions.length >= sampleN) break
    const brand = p.brand
    const title = p.title
    const target = (brand && String(brand).trim()) || significantTokens(title, 3).slice(0, 2).join(' ')
    if (!target || seenTargets.has(target.toLowerCase())) continue
    seenTargets.add(target.toLowerCase())
    seed_suggestions.push({
      target,
      mode: 'keyword',
      marketplace,
      country,
      product_id: p.id,
      sku: p.sku,
      product_title: title,
      reason: opts.q ? `from keyword sample (${opts.q})` : 'spread sample for research seed',
      pipeline_propose_sketch: {
        kind: 'watchlist_seed',
        title: `Watch ${target}`,
        payload: { target, marketplace, country, mode: 'keyword', product_id: p.id },
      },
    })
  }

  return {
    intentional_read,
    catalog_mode_guess: mode,
    signals: health.signals,
    census: {
      total: health.total,
      missing_retail_price: health.missing_retail_price,
      missing_retail_price_pct: health.missing_retail_price_pct,
      with_cost_price: health.with_cost_price,
      sample_pos: health.sample
        ? {
            pos_enabled_true: health.sample.pos_enabled_true,
            pos_enabled_false: health.sample.pos_enabled_false,
            pos_enabled_false_pct: health.sample.pos_enabled_false_pct,
            import_source_top: health.sample.import_source_top,
          }
        : null,
    },
    recommended_actions,
    market_seeds: {
      existing_count: existing_seeds.length,
      existing_sample: existing_seeds.slice(0, 8),
      suggestions: seed_suggestions,
      write_policy:
        'Suggestions are read-only. Cloud/safe: pipeline_propose(watchlist_seed) only. bi_upsert_seed / bi_run_seed_now require full profile + explicit user request.',
      seeds_error,
    },
    sample_products: (sample.products || []).map((p) => ({
      id: p.id,
      title: p.title,
      sku: p.sku,
      brand: p.brand,
      retail_price: p.retail_price,
      cost_price: p.cost_price,
      pos_enabled: p.pos_enabled,
    })),
    agent_hint:
      'Lead with intentional_read. Retail null + POS off after cost import is usually intentional-not-yet-operationalized — not a bug. Suggest catalog_export_csv for retail fill; pipeline_propose for research seeds; never claim market demand without crawl data.',
    deep_links: {
      import_export: '/import-export',
      products: '/products',
      activate_for_pos: '/help/activate-for-pos',
      actions: '/actions',
      inventory: '/inventory',
    },
  }
}

