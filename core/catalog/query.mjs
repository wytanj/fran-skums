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

