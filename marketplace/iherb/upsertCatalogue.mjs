/**
 * Upsert iHerb catalogue products + insert snapshots from parseIherbCatalogue().
 *
 * Pure orchestration — no browser. Mirrors marketplace/writers/upsertObservations.mjs
 * shape so the harvest worker can call it the same way.
 *
 * Hard rules (docs/IHERB_HANDOFF.md):
 *  - Refuse the write if coverage.currency_consistent is false
 *  - Persist run coverage so a partial harvest is visible (MH-12)
 *  - sold_period stays on the row — never flatten into a bare "sold" number
 *
 * @see marketplace/iherb/parseCatalogue.mjs
 * @see tests/iherb-upsert-catalogue.test.mjs
 */

/**
 * @param {Record<string, any> | null | undefined} coverage
 */
export function assertCurrencyConsistent(coverage) {
  if (coverage && coverage.currency_consistent === false) {
    const currencies = Array.isArray(coverage.currencies) ? coverage.currencies.join(', ') : '?'
    const err = new Error(
      `iHerb catalogue write refused: mixed currencies in one run (${currencies}). ` +
      'A page that flipped locale mid-scroll must not land in an SGD column.',
    )
    err.code = 'IHERB_CURRENCY_INCONSISTENT'
    err.coverage = coverage
    throw err
  }
}

/**
 * Normalise parseIherbCatalogue() coverage for storage + return value.
 * @param {Record<string, any> | null | undefined} coverage
 * @param {number} productCount
 */
export function normaliseCoverage(coverage, productCount = 0) {
  const c = coverage && typeof coverage === 'object' ? coverage : {}
  const currencies = Array.isArray(c.currencies) ? [...c.currencies] : []
  return {
    products: Number.isFinite(c.products) ? c.products : productCount,
    with_sold: Number.isFinite(c.with_sold) ? c.with_sold : 0,
    with_price: Number.isFinite(c.with_price) ? c.with_price : 0,
    with_rating: Number.isFinite(c.with_rating) ? c.with_rating : 0,
    out_of_stock: Number.isFinite(c.out_of_stock) ? c.out_of_stock : 0,
    sponsored: Number.isFinite(c.sponsored) ? c.sponsored : 0,
    sold_period: c.sold_period ?? null,
    currencies,
    currency_consistent: c.currency_consistent !== false && currencies.length <= 1,
  }
}

/**
 * @param {any} db Supabase-like client: { from(table).upsert|insert|select... }
 * @param {{
 *   workspace_id: string
 *   brand_key: string
 *   country?: string
 *   catalogue: {
 *     products?: Array<Record<string, any>>
 *     coverage?: Record<string, any>
 *     url?: string | null
 *     captured_at?: string | null
 *     breadcrumb?: { path_text?: string } | null
 *     pagination?: Record<string, any> | null
 *   }
 *   captured_at?: string
 * }} input
 */
export async function upsertIherbCatalogue(db, input) {
  const workspace_id = input.workspace_id
  const brand_key = String(input.brand_key || '').trim().toLowerCase()
  const country = (input.country || 'sg').toLowerCase()
  const catalogue = input.catalogue || {}
  const products = Array.isArray(catalogue.products) ? catalogue.products : []
  const coverage = normaliseCoverage(catalogue.coverage, products.length)

  if (!workspace_id) throw new Error('upsertIherbCatalogue: workspace_id required')
  if (!brand_key) throw new Error('upsertIherbCatalogue: brand_key required')

  assertCurrencyConsistent(coverage)

  const captured_at = input.captured_at
    || catalogue.captured_at
    || new Date().toISOString()

  const result = {
    products_upserted: 0,
    snapshots_inserted: 0,
    skipped: 0,
    errors: /** @type {string[]} */ ([]),
    coverage,
    captured_at,
  }

  for (const p of products) {
    try {
      const part_number = p.part_number ? String(p.part_number).trim() : ''
      if (!part_number) {
        result.skipped++
        continue
      }

      const productRow = {
        workspace_id,
        country,
        part_number,
        product_id: p.product_id != null ? String(p.product_id) : null,
        // gtin only from PDP pass later
        gtin: p.gtin != null ? String(p.gtin) : null,
        name: p.name || null,
        brand_key,
        brand_name: p.brand_name || null,
        brand_id: p.brand_id != null ? String(p.brand_id) : null,
        url: p.url || null,
        category_path_text: p.category_path_text
          || catalogue.breadcrumb?.path_text
          || null,
        category_leaf: p.category_leaf || null,
        weight_value: p.weight_value ?? null,
        weight_unit: p.weight_unit || null,
        last_seen_at: captured_at,
        metadata: {
          is_discontinued: p.is_discontinued ?? null,
          source_url: catalogue.url || null,
          last_harvest_coverage: coverage,
          pagination: catalogue.pagination || null,
        },
      }

      const { data: product, error: productErr } = await db
        .from('iherb_products')
        .upsert(productRow, {
          onConflict: 'workspace_id,country,part_number',
        })
        .select('id')
        .single()

      if (productErr || !product?.id) {
        result.errors.push(
          `product ${part_number}: ${productErr?.message || 'no row returned'}`,
        )
        result.skipped++
        continue
      }
      result.products_upserted++

      const snapshotRow = {
        workspace_id,
        product_row_id: product.id,
        captured_at,
        price: p.price ?? null,
        list_price: p.list_price ?? null,
        discount_pct: p.discount_pct ?? null,
        currency: p.currency || coverage.currencies[0] || 'SGD',
        rating: p.rating ?? null,
        review_count: p.review_count ?? null,
        sold_label: p.sold_label ?? null,
        sold_lower_bound: p.sold_lower_bound ?? null,
        sold_is_bucket: p.sold_is_bucket ?? null,
        sold_period: p.sold_period ?? null,
        in_stock: p.in_stock ?? null,
        is_sponsored: p.is_sponsored === true,
        position: p.position ?? null,
        signals: {
          brand_key,
          product_id: p.product_id ?? null,
          part_number,
          run_coverage: coverage,
          // Explicit so readers never treat sold_lower_bound as lifetime.
          sold_field_note: p.sold_period === 'month'
            ? 'iHerb 30-day sold rate — not comparable to Shopee lifetime sold'
            : null,
        },
      }

      const { error: snapErr } = await db
        .from('iherb_product_snapshots')
        .insert(snapshotRow)

      if (snapErr) {
        result.errors.push(`snapshot ${part_number}: ${snapErr.message}`)
        continue
      }
      result.snapshots_inserted++
    } catch (e) {
      result.errors.push(`${p?.part_number || '?'}: ${e?.message || e}`)
      result.skipped++
    }
  }

  return result
}
