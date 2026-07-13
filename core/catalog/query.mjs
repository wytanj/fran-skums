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
