/**
 * Persist one iHerb PDP enrich result.
 *
 * Identity (gtin, platform breadcrumb, weight) lands on `iherb_products`.
 * Time-varying ranks + price/rating/sold land on a new `iherb_product_snapshots`
 * row with `signals.harvest_source = 'iherb_pdp_enrich'`.
 *
 * No new columns required — rankings live in jsonb (signals + product.metadata).
 * Schema already has gtin / category_path_* / weight_* from mig 086.
 *
 * @see marketplace/iherb/parseProduct.mjs
 * @see marketplace/iherb/pdpEnrich.mjs
 * @see tests/iherb-upsert-pdp.test.mjs
 */

/**
 * Build product.metadata patch from a parseIherbProduct() result.
 * @param {Record<string, any>} prevMeta
 * @param {Record<string, any>} pdp
 * @param {string} now
 */
export function buildPdpProductMetadata(prevMeta, pdp, now = new Date().toISOString()) {
  const prev = prevMeta && typeof prevMeta === 'object' ? { ...prevMeta } : {}
  const specs = pdp.specifications && typeof pdp.specifications === 'object'
    ? pdp.specifications
    : null
  return {
    ...prev,
    pdp_enriched_at: now,
    specs_enriched_at: specs || pdp.ingredients_text ? now : prev.specs_enriched_at ?? null,
    brand_url: pdp.brand_url ?? prev.brand_url ?? null,
    category_name: pdp.category_name ?? prev.category_name ?? null,
    category_id: pdp.category_id ?? prev.category_id ?? null,
    // Last known ranks on the product row for "already enriched?" checks + MCP.
    last_rankings: Array.isArray(pdp.rankings) ? pdp.rankings : prev.last_rankings ?? null,
    rank_best: pdp.rank_best ?? prev.rank_best ?? null,
    pdp_image: pdp.image ?? prev.pdp_image ?? null,
    package_quantity_label: pdp.package_quantity_label ?? prev.package_quantity_label ?? null,
    package_quantity_ml: pdp.volume_ml ?? prev.package_quantity_ml ?? null,
    price_per_ml: pdp.price_per_ml ?? prev.price_per_ml ?? null,
    dimensions_cm: pdp.dimensions_cm ?? specs?.dimensions_cm ?? prev.dimensions_cm ?? null,
    dimensions_in: pdp.dimensions_in ?? specs?.dimensions_in ?? prev.dimensions_in ?? null,
    specifications: specs || prev.specifications || null,
    ingredients_text: pdp.ingredients_text ?? prev.ingredients_text ?? null,
    suggested_use: pdp.suggested_use ?? prev.suggested_use ?? null,
    warnings: pdp.warnings ?? prev.warnings ?? null,
    has_ingredients: Boolean(pdp.ingredients_text || prev.ingredients_text),
    has_specifications: Boolean(specs?.upc || specs?.product_code || prev.specifications),
  }
}

/**
 * Snapshot signals for a PDP enrich write.
 * @param {Record<string, any>} pdp
 * @param {{ brand_key?: string|null, part_number?: string|null }} [ctx]
 */
export function buildPdpSnapshotSignals(pdp, ctx = {}) {
  const rankings = Array.isArray(pdp.rankings) ? pdp.rankings : []
  const rank_best = pdp.rank_best || rankings[0] || null
  return {
    brand_key: ctx.brand_key || null,
    part_number: ctx.part_number || pdp.part_number || null,
    product_id: pdp.product_id ?? null,
    harvest_source: 'iherb_pdp_enrich',
    gtin: pdp.gtin ?? null,
    breadcrumb: pdp.breadcrumb || null,
    rankings,
    rank_best,
    rank_best_rank: rank_best?.rank ?? null,
    rank_best_category: rank_best?.category ?? null,
    rank_best_category_slug: rank_best?.category_slug ?? null,
    weight_value: pdp.weight_value ?? null,
    weight_unit: pdp.weight_unit || null,
    volume_ml: pdp.volume_ml ?? null,
    price_per_ml: pdp.price_per_ml ?? null,
    package_quantity_label: pdp.package_quantity_label ?? null,
    dimensions_cm: pdp.dimensions_cm ?? null,
    dimensions_in: pdp.dimensions_in ?? null,
    specifications: pdp.specifications || null,
    ingredients_text: pdp.ingredients_text || null,
    suggested_use: pdp.suggested_use || null,
    warnings: pdp.warnings || null,
    has_ingredients: Boolean(pdp.ingredients_text),
    has_specifications: Boolean(
      pdp.specifications?.upc
      || pdp.specifications?.product_code
      || pdp.specifications?.dimensions,
    ),
    sold_field_note:
      pdp.sold_period === 'month' || pdp.sold_label
        ? 'iHerb 30-day sold rate — not comparable to Shopee lifetime sold'
        : null,
  }
}

/**
 * Upsert product identity fields + insert one PDP snapshot.
 *
 * Looks up by (workspace_id, country, part_number) when product_row_id is
 * omitted. Refuses write when parse result is not found or has no part_number.
 *
 * @param {any} db
 * @param {{
 *   workspace_id: string
 *   country?: string
 *   brand_key?: string | null
 *   product_row_id?: string | null
 *   part_number?: string | null
 *   pdp: Record<string, any>
 *   captured_at?: string
 * }} input
 */
export async function upsertIherbPdp(db, input) {
  const workspace_id = input.workspace_id
  const country = (input.country || 'sg').toLowerCase()
  const pdp = input.pdp || {}
  const captured_at = input.captured_at || pdp.captured_at || new Date().toISOString()

  if (!workspace_id) throw new Error('upsertIherbPdp: workspace_id required')
  if (!pdp.found) {
    const err = new Error(pdp.reason || 'upsertIherbPdp: pdp.found is false')
    err.code = 'IHERB_PDP_NOT_FOUND'
    throw err
  }

  const part_number = String(input.part_number || pdp.part_number || '').trim()
  if (!part_number) {
    const err = new Error('upsertIherbPdp: part_number required')
    err.code = 'IHERB_PDP_NO_PART_NUMBER'
    throw err
  }

  // Resolve product row
  let productId = input.product_row_id || null
  let existingMeta = {}

  if (productId) {
    const { data, error } = await db
      .from('iherb_products')
      .select('id, metadata, brand_key')
      .eq('id', productId)
      .eq('workspace_id', workspace_id)
      .maybeSingle()
    if (error) throw new Error(`product lookup: ${error.message}`)
    if (!data?.id) {
      const err = new Error(`upsertIherbPdp: product_row_id ${productId} not found`)
      err.code = 'IHERB_PDP_PRODUCT_MISSING'
      throw err
    }
    existingMeta = data.metadata || {}
    if (!input.brand_key && data.brand_key) input.brand_key = data.brand_key
  } else {
    const { data, error } = await db
      .from('iherb_products')
      .select('id, metadata, brand_key')
      .eq('workspace_id', workspace_id)
      .eq('country', country)
      .eq('part_number', part_number)
      .maybeSingle()
    if (error) throw new Error(`product lookup: ${error.message}`)
    if (!data?.id) {
      // Create identity row if catalogue never wrote it (PDP-first is rare but ok)
      const insertRow = {
        workspace_id,
        country,
        part_number,
        product_id: pdp.product_id != null ? String(pdp.product_id) : null,
        gtin: pdp.gtin != null ? String(pdp.gtin) : null,
        name: pdp.name || null,
        brand_key: input.brand_key || null,
        brand_name: pdp.brand_name || null,
        brand_id: pdp.brand_id != null ? String(pdp.brand_id) : null,
        url: pdp.url || null,
        category_path_text: pdp.breadcrumb?.path_text || null,
        category_leaf: pdp.breadcrumb?.leaf || null,
        weight_value: pdp.weight_value ?? null,
        weight_unit: pdp.weight_unit || null,
        last_seen_at: captured_at,
        metadata: buildPdpProductMetadata({}, pdp, captured_at),
      }
      const { data: created, error: cErr } = await db
        .from('iherb_products')
        .upsert(insertRow, { onConflict: 'workspace_id,country,part_number' })
        .select('id, metadata, brand_key')
        .single()
      if (cErr || !created?.id) {
        throw new Error(`product create: ${cErr?.message || 'no row'}`)
      }
      productId = created.id
      existingMeta = created.metadata || {}
      if (!input.brand_key && created.brand_key) input.brand_key = created.brand_key
    } else {
      productId = data.id
      existingMeta = data.metadata || {}
      if (!input.brand_key && data.brand_key) input.brand_key = data.brand_key
    }
  }

  const meta = buildPdpProductMetadata(existingMeta, pdp, captured_at)
  const productPatch = {
    product_id: pdp.product_id != null ? String(pdp.product_id) : undefined,
    gtin: pdp.gtin != null ? String(pdp.gtin) : undefined,
    name: pdp.name || undefined,
    brand_name: pdp.brand_name || undefined,
    brand_id: pdp.brand_id != null ? String(pdp.brand_id) : undefined,
    brand_key: input.brand_key || undefined,
    url: pdp.url || undefined,
    category_path_text: pdp.breadcrumb?.path_text || undefined,
    category_leaf: pdp.breadcrumb?.leaf || undefined,
    weight_value: pdp.weight_value ?? undefined,
    weight_unit: pdp.weight_unit || undefined,
    last_seen_at: captured_at,
    metadata: meta,
  }
  // Drop undefined so we don't wipe existing columns
  for (const k of Object.keys(productPatch)) {
    if (productPatch[k] === undefined) delete productPatch[k]
  }

  const { error: updErr } = await db
    .from('iherb_products')
    .update(productPatch)
    .eq('id', productId)
    .eq('workspace_id', workspace_id)

  if (updErr) throw new Error(`product update: ${updErr.message}`)

  // Carry forward sold/price from prior snap when PDP HTML omitted them.
  // Otherwise a null PDP row becomes "latest" and hides good catalogue sold rates.
  let prior = null
  try {
    const { data: priorRows } = await db
      .from('iherb_product_snapshots')
      .select(
        'price, currency, sold_label, sold_lower_bound, sold_is_bucket, sold_period, rating, review_count',
      )
      .eq('product_row_id', productId)
      .order('captured_at', { ascending: false })
      .limit(5)
    prior = (priorRows || []).find(
      (r) => r.sold_lower_bound != null || r.price != null,
    ) || (priorRows || [])[0] || null
  } catch {
    prior = null
  }

  const price = pdp.price ?? prior?.price ?? null
  const sold_lower_bound = pdp.sold_lower_bound ?? prior?.sold_lower_bound ?? null
  const sold_label = pdp.sold_label ?? prior?.sold_label ?? null
  const sold_is_bucket = pdp.sold_is_bucket ?? prior?.sold_is_bucket ?? null
  const sold_period = pdp.sold_period ?? prior?.sold_period ?? (sold_lower_bound != null ? 'month' : null)

  const signals = buildPdpSnapshotSignals(
    {
      ...pdp,
      price,
      volume_ml: pdp.volume_ml ?? null,
      price_per_ml: pdp.price_per_ml ?? null,
    },
    {
      brand_key: input.brand_key || null,
      part_number,
    },
  )
  if (pdp.volume_ml != null) signals.volume_ml = pdp.volume_ml
  if (pdp.price_per_ml != null) signals.price_per_ml = pdp.price_per_ml
  if (pdp.dimensions_cm) signals.dimensions_cm = pdp.dimensions_cm

  const snapshotRow = {
    workspace_id,
    product_row_id: productId,
    captured_at,
    price,
    list_price: null,
    discount_pct: null,
    currency: pdp.currency || prior?.currency || 'SGD',
    rating: pdp.rating ?? prior?.rating ?? null,
    review_count: pdp.review_count ?? prior?.review_count ?? null,
    sold_label,
    sold_lower_bound,
    sold_is_bucket,
    sold_period,
    in_stock: pdp.in_stock ?? null,
    is_sponsored: false,
    position: null,
    signals,
  }

  const { error: snapErr } = await db.from('iherb_product_snapshots').insert(snapshotRow)
  if (snapErr) throw new Error(`snapshot insert: ${snapErr.message}`)

  return {
    product_row_id: productId,
    part_number,
    gtin: pdp.gtin ?? null,
    rankings_count: Array.isArray(pdp.rankings) ? pdp.rankings.length : 0,
    rank_best: pdp.rank_best || null,
    breadcrumb: pdp.breadcrumb || null,
    captured_at,
  }
}
