export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'pos:read')
  const client = getAdminClient()
  const query = getQuery(event)

  const requestedLimit = Number(query.limit) || 100
  const requestedOffset = Number(query.offset) || 0
  const limit = Math.min(Math.max(Math.floor(requestedLimit), 1), 250)
  const offset = Math.max(Math.floor(requestedOffset), 0)
  const search = String(query.search || '').trim()
  const includeDisabled = query.include_disabled === 'true'
  /** Store-scoped ATS: pos_location_code (e.g. LIS-ION) or inventory location_id UUID */
  const posLocationCode = String(query.pos_location_code || query.store_code || '').trim().toUpperCase()
  const locationIdParam = String(query.location_id || query.inventory_location_id || '').trim()

  /**
   * POS opt-in flag in product_data.
   * Missing/empty → true for legacy products created before M5.
   * Explicit false/off → excluded from default catalog.
   * New import/pipeline products set pos_enabled: false until "Activate for POS".
   */
  function isPosEnabled(value: unknown) {
    if (value === undefined || value === null || value === '') return true
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    const normalized = String(value).trim().toLowerCase()
    return !['false', '0', 'no', 'n', 'disabled', 'inactive', 'off'].includes(normalized)
  }

  function storageLocationCodeFromProductData(productData: Record<string, any>) {
    const value =
      productData.storage_location_code ??
      productData.store_location_code ??
      productData.bin_location ??
      productData.location_code ??
      productData.pos_location_code ??
      productData.store?.location_code ??
      productData.inventory?.storage_location_code
    if (value === undefined || value === null) return null
    const normalized = String(value).trim().toUpperCase()
    return normalized || null
  }

  let productQuery = client
    .from('products')
    .select('*, brand:brand_id(id, name), category:category_id(id, name)')
    .eq('workspace_id', ctx.workspaceId)
    .order('title')
    .range(offset, offset + limit)

  // M5: default POS catalog = active only (never draft/archived). include_disabled can surface others for tooling.
  if (!includeDisabled) {
    productQuery = productQuery.eq('status', 'active')
  }

  if (search) {
    productQuery = productQuery.or(`title.ilike.%${search}%,sku.ilike.%${search}%,ean.eq.${search},upc.eq.${search},gtin.eq.${search}`)
  }

  const { data: products, error } = await productQuery
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const fetchedRows = products || []
  const hasMore = fetchedRows.length > limit
  const rows = fetchedRows.slice(0, limit)
  const productIds = rows.map((row: any) => row.id)
  let graphByProductId = new Map<string, any>()
  let stockByProductId = new Map<string, { on_hand: number; reserved: number; available: number; location_id: string; location_code: string | null }>()
  let resolvedLocationId: string | null = locationIdParam || null
  let resolvedLocationCode: string | null = posLocationCode || null

  if (productIds.length > 0) {
    const { data: graphRows, error: graphError } = await client
      .from('v_product_identity_graph')
      .select('product_id, product_identity_id, trade_units, identifiers, sku_assignments')
      .eq('workspace_id', ctx.workspaceId)
      .in('product_id', productIds)

    if (graphError) throw createError({ statusCode: 500, statusMessage: graphError.message })
    graphByProductId = new Map((graphRows || []).map((row: any) => [row.product_id, row]))
  }

  // Resolve store inventory location for ATS
  if (!resolvedLocationId && posLocationCode) {
    const { data: posLoc } = await client
      .from('pos_locations')
      .select('id, code, inventory_location_id')
      .eq('workspace_id', ctx.workspaceId)
      .ilike('code', posLocationCode)
      .maybeSingle()
    if (posLoc?.inventory_location_id) {
      resolvedLocationId = posLoc.inventory_location_id
      resolvedLocationCode = posLoc.code || posLocationCode
    } else {
      const { data: invLoc } = await client
        .from('inventory_locations')
        .select('id, code')
        .eq('workspace_id', ctx.workspaceId)
        .ilike('code', posLocationCode)
        .maybeSingle()
      if (invLoc?.id) {
        resolvedLocationId = invLoc.id
        resolvedLocationCode = invLoc.code
      }
    }
  }

  if (resolvedLocationId && productIds.length > 0) {
    const { data: levels, error: levelsError } = await client
      .from('inventory_levels')
      .select('product_id, on_hand, reserved, location_id')
      .eq('workspace_id', ctx.workspaceId)
      .eq('location_id', resolvedLocationId)
      .in('product_id', productIds)

    if (levelsError) throw createError({ statusCode: 500, statusMessage: levelsError.message })
    for (const level of levels || []) {
      const onHand = Number(level.on_hand || 0)
      const reserved = Number(level.reserved || 0)
      stockByProductId.set(level.product_id, {
        on_hand: onHand,
        reserved,
        available: Math.max(0, onHand - reserved),
        location_id: level.location_id,
        location_code: resolvedLocationCode,
      })
    }
  }

  const data = rows
    .map((product: any) => {
      const productData = product.product_data || {}
      const posEnabled = isPosEnabled(productData.pos_enabled ?? productData.sellable_in_pos)
      const storageLocationCode = storageLocationCodeFromProductData(productData)
      const graph = graphByProductId.get(product.id)
      const tradeUnits = Array.isArray(graph?.trade_units) ? graph.trade_units : []
      const skuAssignments = Array.isArray(graph?.sku_assignments) ? graph.sku_assignments : []
      const defaultTradeUnit = tradeUnits.find((unit: any) => unit.is_default) || tradeUnits[0] || null
      const primarySkuAssignment = skuAssignments.find((assignment: any) => assignment.is_primary && assignment.is_active)
        || skuAssignments.find((assignment: any) => assignment.is_active)
        || null
      const unitPrice = Number(product.sale_price ?? product.retail_price ?? 0)
      const level = stockByProductId.get(product.id)
      // Prefer store-scoped inventory_levels ATS; fall back to legacy product.stock_quantity
      const stockQuantity = level
        ? level.available
        : (product.stock_quantity ?? 0)

      return {
        id: product.id,
        product_id: product.id,
        revision: product.updated_at || product.created_at || product.id,
        updated_at: product.updated_at || null,
        product_identity_id: graph?.product_identity_id || null,
        trade_unit_id: defaultTradeUnit?.id || null,
        listing_id: null,
        channel_id: null,
        sku_assignment_id: primarySkuAssignment?.id || null,
        identifier_id: null,
        variant_id: defaultTradeUnit?.variant_id || null,
        batch_id: null,
        sku: product.sku || primarySkuAssignment?.sku || product.ean || product.upc || product.gtin || product.id,
        title: product.title,
        display_name: product.title,
        brand_name: product.brand?.name || null,
        category_name: product.category?.name || null,
        unit_price: unitPrice,
        list_price: product.retail_price == null ? unitPrice : Number(product.retail_price),
        currency: product.currency || 'USD',
        storage_location_code: storageLocationCode,
        stock_quantity: stockQuantity,
        track_inventory: product.track_inventory ?? true,
        status: product.status,
        pos_enabled: posEnabled,
        inventory_location_id: level?.location_id || resolvedLocationId || null,
        inventory_location_code: level?.location_code || resolvedLocationCode || null,
        on_hand: level?.on_hand ?? null,
        reserved: level?.reserved ?? null,
        available: level?.available ?? null,
        identifiers: {
          sku: product.sku || null,
          ean: product.ean || null,
          upc: product.upc || null,
          gtin: product.gtin || null,
          asin: product.asin || null,
          mpn: product.mpn || null,
        },
        metadata: {
          product_data: productData,
          graph_identifiers: graph?.identifiers || [],
          storage_location_code: storageLocationCode,
          source: productData.source || null,
          availability: productData.availability || null,
          stock_source: level ? 'inventory_levels' : 'product_legacy',
        },
      }
    })
    // Exclude drafts always; exclude non-pos_enabled unless include_disabled
    .filter((item: any) => {
      if (item.status === 'draft' || item.status === 'archived') {
        return includeDisabled
      }
      return includeDisabled || item.pos_enabled
    })

  return {
    data,
    total: hasMore ? offset + rows.length + 1 : offset + rows.length,
    limit,
    offset,
    has_more: hasMore,
    next_offset: hasMore ? offset + rows.length : null,
    inventory_location_id: resolvedLocationId,
    inventory_location_code: resolvedLocationCode,
    stock_scoped: Boolean(resolvedLocationId),
  }
})
