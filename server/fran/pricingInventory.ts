import { randomUUID } from 'node:crypto'
import { toFranProductContext } from './productContext'

const DEFAULT_QUOTE_TTL_SECONDS = 10 * 60

const PRODUCT_SELECT = [
  'id',
  'workspace_id',
  'sku',
  'ean',
  'upc',
  'gtin',
  'title',
  'status',
  'tags',
  'stock_quantity',
  'track_inventory',
  'retail_price',
  'sale_price',
  'currency',
  'product_data',
  'brand:brand_id(id, name)',
  'category:category_id(id, name)',
  'updated_at',
  'created_at',
].join(', ')

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized || null
}

function numberValue(value: unknown, fallback = 0): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}

function positiveQuantity(value: unknown): number {
  const quantity = numberValue(value, 1)
  if (quantity <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'line quantity must be greater than 0' })
  }
  return quantity
}

function integerQuantity(value: unknown, label = 'quantity'): number {
  const quantity = numberValue(value, 0)
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw createError({ statusCode: 400, statusMessage: `${label} must be a positive integer for inventory reservation` })
  }
  return quantity
}

function normalizeMode(value: unknown): 'checkout' | 'reward' | 'sample' | 'preview' {
  const normalized = textValue(value)?.toLowerCase()
  if (normalized === 'reward' || normalized === 'sample' || normalized === 'preview') return normalized
  return 'checkout'
}

function reservationReasonType(mode: string) {
  if (mode === 'reward') return 'reward'
  if (mode === 'sample') return 'sample'
  return 'pos_cart'
}

function uuidOrNull(value: unknown): string | null {
  const text = textValue(value)
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null
}

function compact<T>(values: Array<T | null | undefined>): T[] {
  return Array.from(new Set(values.filter((value): value is T => value !== null && value !== undefined)))
}

function lineInputKey(line: Record<string, any>, index: number): string {
  return textValue(line.line_id) || textValue(line.id) || textValue(line.cart_line_id) || `line-${index + 1}`
}

function lineIdentifier(line: Record<string, any>): string | null {
  return (
    textValue(line.sku) ||
    textValue(line.barcode) ||
    textValue(line.scanned_value) ||
    textValue(line.identifier) ||
    textValue(line.ean) ||
    textValue(line.upc) ||
    textValue(line.gtin)
  )
}

function productIdentifiers(product: Record<string, any>): string[] {
  return compact([product.sku, product.ean, product.upc, product.gtin].map((value) => textValue(value)?.toLowerCase()))
}

function requestedLocation(body: Record<string, any>) {
  const store = asRecord(body.store)
  return {
    locationId:
      textValue(body.location_id) ||
      textValue(body.pos_location_id) ||
      textValue(body.store_id) ||
      textValue(store.location_id) ||
      textValue(store.pos_location_id) ||
      textValue(store.id),
    locationCode:
      textValue(body.location_code) ||
      textValue(body.pos_location_code) ||
      textValue(body.store_code) ||
      textValue(store.code),
    inventoryLocationId:
      textValue(body.inventory_location_id) ||
      textValue(store.inventory_location_id),
    registerId: textValue(body.register_id) || textValue(asRecord(body.register).id),
    registerSessionId: textValue(body.register_session_id),
  }
}

async function resolveLocationContext(client: any, workspaceId: string, body: Record<string, any>) {
  const requested = requestedLocation(body)
  let location: Record<string, any> | null = null

  if (requested.locationId) {
    const { data, error } = await client
      .from('pos_locations')
      .select('id, inventory_location_id, currency, code')
      .eq('workspace_id', workspaceId)
      .eq('id', requested.locationId)
      .maybeSingle()

    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    location = data || null
  } else if (requested.locationCode) {
    const { data, error } = await client
      .from('pos_locations')
      .select('id, inventory_location_id, currency, code')
      .eq('workspace_id', workspaceId)
      .eq('code', requested.locationCode)
      .maybeSingle()

    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    location = data || null
  }

  return {
    location_id: location?.id || requested.locationId || null,
    inventory_location_id: requested.inventoryLocationId || location?.inventory_location_id || null,
    register_id: requested.registerId || null,
    register_session_id: requested.registerSessionId || null,
    currency: location?.currency || null,
  }
}

async function fetchProducts(client: any, workspaceId: string, lines: Record<string, any>[]) {
  const byId = new Map<string, any>()
  const byIdentifier = new Map<string, any>()
  const productIds = compact(lines.map((line) => textValue(line.product_id) || textValue(line.product?.id)))
  const rawIdentifiers = compact(lines.map(lineIdentifier))
  const identifiers = compact(rawIdentifiers.flatMap((value) => [value, value.toUpperCase(), value.toLowerCase()]))

  async function addRows(rows: any[] | null) {
    for (const product of rows || []) {
      byId.set(product.id, product)
      for (const identifier of productIdentifiers(product)) {
        if (!byIdentifier.has(identifier)) byIdentifier.set(identifier, product)
      }
    }
  }

  if (productIds.length > 0) {
    const { data, error } = await client
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('workspace_id', workspaceId)
      .in('id', productIds)

    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    await addRows(data || [])
  }

  for (const field of ['sku', 'ean', 'upc', 'gtin']) {
    if (identifiers.length === 0) break
    const { data, error } = await client
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('workspace_id', workspaceId)
      .in(field, identifiers)

    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    await addRows(data || [])
  }

  return { byId, byIdentifier }
}

async function fetchGraphByProductId(client: any, workspaceId: string, productIds: string[]) {
  if (productIds.length === 0) return new Map<string, any>()

  const { data, error } = await client
    .from('v_product_identity_graph')
    .select('product_id, product_identity_id, trade_units, identifiers, sku_assignments')
    .eq('workspace_id', workspaceId)
    .in('product_id', productIds)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return new Map((data || []).map((row: any) => [row.product_id, row]))
}

async function fetchAvailabilityByProductId(
  client: any,
  workspaceId: string,
  productIds: string[],
  inventoryLocationId: string | null,
) {
  if (productIds.length === 0) return new Map<string, any>()

  let query = client
    .from('inventory_levels')
    .select('product_id, variant_id, location_id, on_hand, reserved, on_order, in_transit')
    .eq('workspace_id', workspaceId)
    .in('product_id', productIds)

  if (inventoryLocationId) query = query.eq('location_id', inventoryLocationId)

  const { data, error } = await query
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const locationIds = compact((data || []).map((level: any) => level.location_id))
  const locations = new Map<string, any>()
  if (locationIds.length > 0) {
    const { data: locationRows, error: locationError } = await client
      .from('inventory_locations')
      .select('id, name, code, location_type')
      .eq('workspace_id', workspaceId)
      .in('id', locationIds)

    if (locationError) throw createError({ statusCode: 500, statusMessage: locationError.message })
    for (const location of locationRows || []) locations.set(location.id, location)
  }

  const grouped = new Map<string, any[]>()
  for (const level of data || []) {
    const rows = grouped.get(level.product_id) || []
    rows.push(level)
    grouped.set(level.product_id, rows)
  }

  const availability = new Map<string, any>()
  for (const [productId, levels] of grouped) {
    const byLocation = levels.map((level) => {
      const location = locations.get(level.location_id)
      const onHand = numberValue(level.on_hand)
      const reserved = numberValue(level.reserved)
      return {
        location_id: level.location_id,
        location_name: location?.name || null,
        location_code: location?.code || null,
        location_type: location?.location_type || null,
        on_hand: onHand,
        reserved,
        available_to_sell: Math.max(0, onHand - reserved),
        on_order: numberValue(level.on_order),
        in_transit: numberValue(level.in_transit),
      }
    })

    availability.set(productId, {
      on_hand: byLocation.reduce((total, level) => total + level.on_hand, 0),
      reserved: byLocation.reduce((total, level) => total + level.reserved, 0),
      available_to_sell: byLocation.reduce((total, level) => total + level.available_to_sell, 0),
      reservable_quantity: Math.floor(byLocation.reduce((total, level) => total + level.available_to_sell, 0)),
      by_location: byLocation,
    })
  }

  return availability
}

function productForLine(line: Record<string, any>, products: { byId: Map<string, any>; byIdentifier: Map<string, any> }) {
  const productId = textValue(line.product_id) || textValue(line.product?.id)
  if (productId && products.byId.has(productId)) return products.byId.get(productId)
  const identifier = lineIdentifier(line)?.toLowerCase()
  return identifier ? products.byIdentifier.get(identifier) || null : null
}

function graphContext(graph: Record<string, any> | null | undefined) {
  const tradeUnits = Array.isArray(graph?.trade_units) ? graph?.trade_units : []
  const skuAssignments = Array.isArray(graph?.sku_assignments) ? graph?.sku_assignments : []
  const defaultTradeUnit = tradeUnits.find((unit: any) => unit.is_default) || tradeUnits[0] || null
  const primarySkuAssignment = skuAssignments.find((assignment: any) => assignment.is_primary && assignment.is_active)
    || skuAssignments.find((assignment: any) => assignment.is_active)
    || null

  return {
    product_identity_id: graph?.product_identity_id || null,
    trade_unit_id: defaultTradeUnit?.id || null,
    sku_assignment_id: primarySkuAssignment?.id || null,
    variant_id: defaultTradeUnit?.variant_id || primarySkuAssignment?.variant_id || null,
    identifiers: graph?.identifiers || [],
    sku_assignments: skuAssignments,
  }
}

function quoteLineFromProduct({
  line,
  index,
  product,
  graph,
  availability,
  inventoryLocationId,
  defaultCurrency,
  quoteLineId,
}: {
  line: Record<string, any>
  index: number
  product: Record<string, any> | null
  graph: Record<string, any> | null | undefined
  availability: Record<string, any> | undefined
  inventoryLocationId: string | null
  defaultCurrency: string
  quoteLineId: string
}) {
  const quantity = positiveQuantity(line.quantity ?? line.qty)
  const inputLineId = lineInputKey(line, index)
  const warnings: string[] = []

  if (!product) {
    return {
      db: {
        id: quoteLineId,
        line_id: inputLineId,
        product_id: null,
        variant_id: null,
        inventory_location_id: inventoryLocationId,
        sku: lineIdentifier(line),
        display_name: textValue(line.display_name) || textValue(line.title) || lineIdentifier(line),
        requested_quantity: quantity,
        reservable_quantity: 0,
        unit_price: 0,
        list_price: 0,
        discount_amount: 0,
        tax_basis: {},
        line_total: 0,
        currency: defaultCurrency,
        price_source: { type: 'unresolved', reason: 'product_not_found' },
        availability: { track_inventory: true, available_to_sell: 0, reservable_quantity: 0, by_location: [] },
        product_context: {},
        blocked: true,
        warnings: ['product_not_found'],
        metadata: { requested_identifier: lineIdentifier(line), input: line },
      },
      response: null,
    }
  }

  const graphValues = graphContext(graph)
  const unitPrice = numberValue(product.sale_price ?? product.retail_price, 0)
  const listPrice = product.retail_price == null ? unitPrice : numberValue(product.retail_price, unitPrice)
  const discountAmount = Math.max(0, listPrice - unitPrice) * quantity
  const lineTotal = unitPrice * quantity
  const currency = textValue(product.currency) || defaultCurrency
  const trackInventory = product.track_inventory !== false
  const productAvailability = availability || {
    on_hand: 0,
    reserved: 0,
    available_to_sell: 0,
    reservable_quantity: 0,
    by_location: [],
  }

  if (product.status !== 'active') warnings.push('product_not_active')
  if (trackInventory && productAvailability.by_location.length === 0) warnings.push('inventory_level_missing')
  if (trackInventory && productAvailability.reservable_quantity < quantity) warnings.push('insufficient_inventory')

  const blocked = product.status !== 'active' || (trackInventory && productAvailability.reservable_quantity < quantity)
  const productContext = toFranProductContext(product)
  const priceSource = {
    type: 'legacy_product_price',
    product_id: product.id,
    product_revision: product.updated_at || product.created_at || product.id,
    sale_price_used: product.sale_price !== null && product.sale_price !== undefined,
    fields: product.sale_price !== null && product.sale_price !== undefined ? ['sale_price', 'retail_price'] : ['retail_price'],
  }
  const availabilityContext = {
    track_inventory: trackInventory,
    on_hand: trackInventory ? productAvailability.on_hand : null,
    reserved: trackInventory ? productAvailability.reserved : null,
    available_to_sell: trackInventory ? productAvailability.available_to_sell : null,
    reservable_quantity: trackInventory ? productAvailability.reservable_quantity : Math.ceil(quantity),
    by_location: trackInventory ? productAvailability.by_location : [],
  }

  const db = {
    id: quoteLineId,
    line_id: inputLineId,
    product_identity_id: graphValues.product_identity_id,
    trade_unit_id: graphValues.trade_unit_id,
    listing_id: textValue(line.listing_id),
    channel_id: textValue(line.channel_id),
    sku_assignment_id: graphValues.sku_assignment_id,
    identifier_id: textValue(line.identifier_id),
    product_id: product.id,
    variant_id: textValue(line.variant_id) || graphValues.variant_id,
    inventory_location_id: inventoryLocationId,
    sku: product.sku || lineIdentifier(line),
    display_name: product.title,
    requested_quantity: quantity,
    reservable_quantity: availabilityContext.reservable_quantity,
    unit_price: money(unitPrice),
    list_price: money(listPrice),
    discount_amount: money(discountAmount),
    tax_basis: asRecord(line.tax_basis),
    line_total: money(lineTotal),
    currency,
    price_source: priceSource,
    availability: availabilityContext,
    product_context: productContext,
    blocked,
    warnings,
    metadata: {
      requested_identifier: lineIdentifier(line),
      graph_identifiers: graphValues.identifiers,
      sku_assignments: graphValues.sku_assignments,
      product_data: product.product_data || {},
    },
  }

  return {
    db,
    response: {
      quote_line_id: quoteLineId,
      line_id: inputLineId,
      product_id: product.id,
      variant_id: db.variant_id,
      product_identity_id: db.product_identity_id,
      trade_unit_id: db.trade_unit_id,
      sku_assignment_id: db.sku_assignment_id,
      sku: db.sku,
      display_name: db.display_name,
      quantity,
      unit_price: db.unit_price,
      list_price: db.list_price,
      discount_amount: db.discount_amount,
      tax_basis: db.tax_basis,
      line_total: db.line_total,
      currency,
      price_source: priceSource,
      product_context: productContext,
      availability: availabilityContext,
      blocked,
      warnings,
    },
  }
}

export async function createBasketQuoteFromBody(event: any, body: Record<string, any>) {
  const ctx = await requireApiKey(event, 'pos:read')
  const client = getAdminClient()
  const lines = Array.isArray(body.lines) ? body.lines : Array.isArray(body.items) ? body.items : []

  if (lines.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'lines must be a non-empty array' })
  }

  const idempotencyKey = textValue(body.idempotency_key)
  if (idempotencyKey) {
    const { data: existing, error } = await client
      .from('pos_basket_quotes')
      .select('response_snapshot')
      .eq('workspace_id', ctx.workspaceId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    if (existing?.response_snapshot && Object.keys(existing.response_snapshot).length > 0) {
      return { ...existing.response_snapshot, duplicate: true }
    }
  }

  const quoteId = randomUUID()
  const quoteRevision = `${quoteId}:1`
  const now = new Date()
  const ttlSeconds = Math.min(Math.max(Math.floor(numberValue(body.ttl_seconds, DEFAULT_QUOTE_TTL_SECONDS)), 60), 30 * 60)
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString()
  const locationContext = await resolveLocationContext(client, ctx.workspaceId, body)
  const mode = normalizeMode(body.quote_mode || body.mode)
  const products = await fetchProducts(client, ctx.workspaceId, lines)
  const resolvedProducts = lines.map((line) => productForLine(asRecord(line), products)).filter(Boolean)
  const productIds = compact(resolvedProducts.map((product: any) => product.id))
  const graphByProductId = await fetchGraphByProductId(client, ctx.workspaceId, productIds)
  const availabilityByProductId = await fetchAvailabilityByProductId(client, ctx.workspaceId, productIds, locationContext.inventory_location_id)
  const defaultCurrency = textValue(body.currency) || locationContext.currency || 'USD'

  const quoteLines = lines.map((rawLine, index) => {
    const line = asRecord(rawLine)
    const product = productForLine(line, products)
    return quoteLineFromProduct({
      line,
      index,
      product,
      graph: product ? graphByProductId.get(product.id) : null,
      availability: product ? availabilityByProductId.get(product.id) : undefined,
      inventoryLocationId: locationContext.inventory_location_id,
      defaultCurrency,
      quoteLineId: randomUUID(),
    })
  })

  const dbLines = quoteLines.map((line) => ({
    workspace_id: ctx.workspaceId,
    quote_id: quoteId,
    ...line.db,
  }))
  const responseLines = quoteLines.map((line) => line.response || {
    quote_line_id: line.db.id,
    line_id: line.db.line_id,
    product_id: null,
    sku: line.db.sku,
    display_name: line.db.display_name,
    quantity: line.db.requested_quantity,
    unit_price: 0,
    list_price: 0,
    discount_amount: 0,
    tax_basis: {},
    line_total: 0,
    currency: line.db.currency,
    price_source: line.db.price_source,
    product_context: {},
    availability: line.db.availability,
    blocked: true,
    warnings: line.db.warnings,
  })
  const blockedLines = responseLines.filter((line: any) => line.blocked)
  const warnings = compact(responseLines.flatMap((line: any) => line.warnings || []))
  const subtotal = money(responseLines.reduce((total: number, line: any) => total + numberValue(line.unit_price) * numberValue(line.quantity), 0))
  const discountTotal = money(responseLines.reduce((total: number, line: any) => total + numberValue(line.discount_amount), 0))
  const taxTotal = money(responseLines.reduce((total: number, line: any) => total + numberValue(line.tax_amount), 0))
  const total = money(responseLines.reduce((lineTotal: number, line: any) => lineTotal + numberValue(line.line_total), 0))
  const priceSource = {
    type: 'legacy_product_price',
    quote_revision: quoteRevision,
    product_revisions: responseLines
      .filter((line: any) => line.product_id)
      .map((line: any) => ({
        product_id: line.product_id,
        product_revision: line.price_source?.product_revision || null,
      })),
  }

  const response = {
    data: {
      quote_id: quoteId,
      quote_revision: quoteRevision,
      status: blockedLines.length > 0 ? 'blocked' : 'quoted',
      ttl_seconds: ttlSeconds,
      expires_at: expiresAt,
      workspace_id: ctx.workspaceId,
      location_id: locationContext.location_id,
      inventory_location_id: locationContext.inventory_location_id,
      register_id: locationContext.register_id,
      register_session_id: locationContext.register_session_id,
      quote_mode: mode,
      currency: defaultCurrency,
      customer: {
        customer_ref: textValue(body.customer_ref) || textValue(body.crm_customer_ref) || textValue(asRecord(body.customer).customer_ref),
        member_ref: textValue(body.member_ref) || textValue(body.loyalty_member_ref) || textValue(asRecord(body.customer).member_ref),
      },
      price_source: priceSource,
      totals: {
        subtotal,
        discount_total: discountTotal,
        tax_total: taxTotal,
        total,
      },
      lines: responseLines,
      blocked_lines: blockedLines.map((line: any) => ({
        quote_line_id: line.quote_line_id,
        line_id: line.line_id,
        product_id: line.product_id,
        warnings: line.warnings,
      })),
      warnings,
    },
  }

  const quoteInput = {
    id: quoteId,
    workspace_id: ctx.workspaceId,
    location_id: locationContext.location_id,
    inventory_location_id: locationContext.inventory_location_id,
    register_id: locationContext.register_id,
    register_session_id: locationContext.register_session_id,
    customer_ref: response.data.customer.customer_ref,
    member_ref: response.data.customer.member_ref,
    quote_mode: mode,
    currency: defaultCurrency,
    quote_revision: quoteRevision,
    status: 'quoted',
    idempotency_key: idempotencyKey,
    expires_at: expiresAt,
    price_source: priceSource,
    requested_context: {
      source: textValue(body.source) || 'fran_pos',
      cart_id: textValue(body.cart_id) || textValue(body.pos_cart_id),
      requested_quote_mode: body.quote_mode || body.mode || null,
    },
    totals: response.data.totals,
    response_snapshot: response,
  }

  const { error: quoteError } = await client.from('pos_basket_quotes').insert(quoteInput)
  if (quoteError) {
    if (idempotencyKey && quoteError.code === '23505') {
      const { data: existing } = await client
        .from('pos_basket_quotes')
        .select('response_snapshot')
        .eq('workspace_id', ctx.workspaceId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      if (existing?.response_snapshot) return { ...existing.response_snapshot, duplicate: true }
    }
    throw createError({ statusCode: 500, statusMessage: quoteError.message })
  }

  const { error: lineError } = await client.from('pos_basket_quote_lines').insert(dbLines)
  if (lineError) throw createError({ statusCode: 500, statusMessage: lineError.message })

  setResponseStatus(event, 201)
  return response
}

async function fetchReservation(client: any, workspaceId: string, reservationId: string) {
  const { data: reservation, error } = await client
    .from('pos_reservations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', reservationId)
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!reservation) throw createError({ statusCode: 404, statusMessage: 'reservation not found' })

  const { data: lines, error: lineError } = await client
    .from('pos_reservation_lines')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('reservation_id', reservationId)
    .order('created_at')

  if (lineError) throw createError({ statusCode: 500, statusMessage: lineError.message })
  return { reservation, lines: lines || [] }
}

async function releaseReservationStock(client: any, workspaceId: string, reservation: Record<string, any>, lines: Record<string, any>[]) {
  const releasedAt = new Date().toISOString()
  const releasedLines: any[] = []

  for (const line of lines.filter((item) => item.status === 'active' && item.reserved_qty > 0)) {
    if (!line.product_id || !line.inventory_location_id) continue

    const { error: rpcError } = await client.rpc('upsert_inventory_level', {
      p_workspace_id: workspaceId,
      p_product_id: line.product_id,
      p_variant_id: line.variant_id || null,
      p_location_id: line.inventory_location_id,
      p_quantity_type: 'reserved',
      p_delta: -line.reserved_qty,
      p_movement_type: 'unreservation',
      p_reference_type: 'reservation',
      p_reference_id: reservation.id,
      p_reference_line_id: line.quote_line_id || line.id,
      p_notes: `Released POS reservation ${reservation.id}`,
      p_created_by: null,
    })
    if (rpcError) throw createError({ statusCode: 500, statusMessage: rpcError.message })

    if (line.inventory_reservation_id) {
      const { error: inventoryError } = await client
        .from('inventory_reservations')
        .update({ status: 'released', released_at: releasedAt })
        .eq('workspace_id', workspaceId)
        .eq('id', line.inventory_reservation_id)

      if (inventoryError) throw createError({ statusCode: 500, statusMessage: inventoryError.message })
    }

    if (line.id) {
      const { data: updatedLine, error: lineError } = await client
        .from('pos_reservation_lines')
        .update({ status: 'released', updated_at: releasedAt })
        .eq('workspace_id', workspaceId)
        .eq('id', line.id)
        .select()
        .maybeSingle()

      if (lineError) throw createError({ statusCode: 500, statusMessage: lineError.message })
      releasedLines.push(updatedLine || { ...line, status: 'released', updated_at: releasedAt })
    } else {
      releasedLines.push({ ...line, status: 'released', updated_at: releasedAt })
    }
  }

  return releasedLines
}

async function commitReservationStock(
  client: any,
  workspaceId: string,
  reservationId: string,
  options: { pos_sale_id?: string | null; idempotent?: boolean } = {},
) {
  const { reservation, lines } = await fetchReservation(client, workspaceId, reservationId)
  if (reservation.status === 'committed') return { reservation, lines, duplicate: true }
  if (reservation.status !== 'active') {
    throw createError({ statusCode: 409, statusMessage: `reservation is ${reservation.status}` })
  }
  if (new Date(reservation.expires_at) < new Date()) {
    throw createError({ statusCode: 409, statusMessage: 'reservation has expired' })
  }

  const committedAt = new Date().toISOString()
  const committedLines: any[] = []

  for (const line of lines.filter((item) => item.status === 'active' && item.reserved_qty > 0)) {
    if (!line.product_id || !line.inventory_location_id) continue

    for (const movement of [
      { quantity_type: 'reserved', delta: -line.reserved_qty },
      { quantity_type: 'on_hand', delta: -line.reserved_qty },
    ]) {
      const { error: rpcError } = await client.rpc('upsert_inventory_level', {
        p_workspace_id: workspaceId,
        p_product_id: line.product_id,
        p_variant_id: line.variant_id || null,
        p_location_id: line.inventory_location_id,
        p_quantity_type: movement.quantity_type,
        p_delta: movement.delta,
        p_movement_type: 'sale',
        p_reference_type: options.pos_sale_id ? 'pos_sale' : 'reservation',
        p_reference_id: options.pos_sale_id || reservation.id,
        p_reference_line_id: line.quote_line_id || line.id,
        p_notes: `Committed POS reservation ${reservation.id}`,
        p_created_by: null,
      })
      if (rpcError) throw createError({ statusCode: 500, statusMessage: rpcError.message })
    }

    if (line.inventory_reservation_id) {
      const { error: inventoryError } = await client
        .from('inventory_reservations')
        .update({
          status: 'committed',
          pos_sale_id: options.pos_sale_id || reservation.pos_sale_id || null,
          committed_at: committedAt,
        })
        .eq('workspace_id', workspaceId)
        .eq('id', line.inventory_reservation_id)

      if (inventoryError) throw createError({ statusCode: 500, statusMessage: inventoryError.message })
    }

    const { data: updatedLine, error: lineError } = await client
      .from('pos_reservation_lines')
      .update({ status: 'committed', updated_at: committedAt })
      .eq('workspace_id', workspaceId)
      .eq('id', line.id)
      .select()
      .single()

    if (lineError) throw createError({ statusCode: 500, statusMessage: lineError.message })
    committedLines.push(updatedLine)
  }

  const { data: updatedReservation, error: reservationError } = await client
    .from('pos_reservations')
    .update({
      status: 'committed',
      pos_sale_id: options.pos_sale_id || reservation.pos_sale_id || null,
      committed_at: committedAt,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', reservation.id)
    .select()
    .single()

  if (reservationError) throw createError({ statusCode: 500, statusMessage: reservationError.message })

  if (updatedReservation.quote_id) {
    await client
      .from('pos_basket_quotes')
      .update({ status: 'committed' })
      .eq('workspace_id', workspaceId)
      .eq('id', updatedReservation.quote_id)
  }

  return { reservation: updatedReservation, lines: committedLines, duplicate: false }
}

export async function createReservationFromBody(event: any, body: Record<string, any>) {
  const ctx = await requireApiKey(event, 'pos:write')
  const client = getAdminClient()
  const quoteId = textValue(body.quote_id)
  if (!quoteId) throw createError({ statusCode: 400, statusMessage: 'quote_id is required' })

  const idempotencyKey = textValue(body.idempotency_key)
  if (idempotencyKey) {
    const { data: existing, error } = await client
      .from('pos_reservations')
      .select('*')
      .eq('workspace_id', ctx.workspaceId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    if (existing) {
      const fetched = await fetchReservation(client, ctx.workspaceId, existing.id)
      return { data: fetched, duplicate: true }
    }
  }

  const { data: quote, error: quoteError } = await client
    .from('pos_basket_quotes')
    .select('*')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', quoteId)
    .maybeSingle()

  if (quoteError) throw createError({ statusCode: 500, statusMessage: quoteError.message })
  if (!quote) throw createError({ statusCode: 404, statusMessage: 'quote not found' })
  if (new Date(quote.expires_at) < new Date()) {
    await client.from('pos_basket_quotes').update({ status: 'expired' }).eq('id', quote.id)
    throw createError({ statusCode: 409, statusMessage: 'quote has expired; request a fresh quote' })
  }

  const { data: quoteLines, error: lineError } = await client
    .from('pos_basket_quote_lines')
    .select('*')
    .eq('workspace_id', ctx.workspaceId)
    .eq('quote_id', quote.id)
    .order('created_at')

  if (lineError) throw createError({ statusCode: 500, statusMessage: lineError.message })
  const reservableLines = (quoteLines || []).filter((line: any) => line.product_id && !line.blocked && line.availability?.track_inventory !== false)
  if (reservableLines.length === 0) {
    throw createError({ statusCode: 409, statusMessage: 'quote has no reservable inventory lines' })
  }

  const reservationId = randomUUID()
  const expiresAt = textValue(body.expires_at) || quote.expires_at
  const locationContext = await resolveLocationContext(client, ctx.workspaceId, {
    ...body,
    location_id: body.location_id || quote.location_id,
    inventory_location_id: body.inventory_location_id || quote.inventory_location_id,
    register_id: body.register_id || quote.register_id,
    register_session_id: body.register_session_id || quote.register_session_id,
  })

  const { data: reservation, error: reservationError } = await client
    .from('pos_reservations')
    .insert({
      id: reservationId,
      workspace_id: ctx.workspaceId,
      quote_id: quote.id,
      status: 'active',
      source: textValue(body.source) || 'fran_pos',
      pos_cart_id: textValue(body.pos_cart_id) || textValue(body.cart_id),
      pos_sale_id: uuidOrNull(body.pos_sale_id),
      location_id: locationContext.location_id,
      inventory_location_id: locationContext.inventory_location_id,
      register_id: locationContext.register_id,
      register_session_id: locationContext.register_session_id,
      idempotency_key: idempotencyKey,
      expires_at: expiresAt,
      metadata: {
        quote_revision: quote.quote_revision,
        quote_mode: quote.quote_mode,
        requested_by: 'fran_pos',
      },
    })
    .select()
    .single()

  if (reservationError) throw createError({ statusCode: 500, statusMessage: reservationError.message })

  const createdLines: any[] = []
  const heldLines: any[] = []
  try {
    const availability = await fetchAvailabilityByProductId(
      client,
      ctx.workspaceId,
      compact(reservableLines.map((line: any) => line.product_id)),
      locationContext.inventory_location_id,
    )

    for (const quoteLine of reservableLines) {
      const requestedQty = integerQuantity(quoteLine.requested_quantity, 'reserved quantity')
      const currentAvailability = availability.get(quoteLine.product_id)
      if (!quoteLine.inventory_location_id && !locationContext.inventory_location_id) {
        throw createError({ statusCode: 409, statusMessage: `quote line ${quoteLine.line_id || quoteLine.id} has no inventory location` })
      }
      if (!currentAvailability || currentAvailability.reservable_quantity < requestedQty) {
        throw createError({ statusCode: 409, statusMessage: `insufficient inventory for quote line ${quoteLine.line_id || quoteLine.id}` })
      }

      const inventoryLocationId = quoteLine.inventory_location_id || locationContext.inventory_location_id
      const { error: rpcError } = await client.rpc('upsert_inventory_level', {
        p_workspace_id: ctx.workspaceId,
        p_product_id: quoteLine.product_id,
        p_variant_id: quoteLine.variant_id,
        p_location_id: inventoryLocationId,
        p_quantity_type: 'reserved',
        p_delta: requestedQty,
        p_movement_type: 'reservation',
        p_reference_type: 'reservation',
        p_reference_id: reservation.id,
        p_reference_line_id: quoteLine.id,
        p_notes: `Reserved from quote ${quote.id}`,
        p_created_by: null,
      })

      if (rpcError) throw createError({ statusCode: 500, statusMessage: rpcError.message })

      const heldLine = {
        status: 'active',
        reserved_qty: requestedQty,
        product_id: quoteLine.product_id,
        variant_id: quoteLine.variant_id,
        inventory_location_id: inventoryLocationId,
        inventory_reservation_id: null as string | null,
        quote_line_id: quoteLine.id,
      }
      heldLines.push(heldLine)

      const { data: inventoryReservation, error: inventoryReservationError } = await client
        .from('inventory_reservations')
        .insert({
          workspace_id: ctx.workspaceId,
          product_id: quoteLine.product_id,
          variant_id: quoteLine.variant_id,
          location_id: inventoryLocationId,
          reserved_qty: requestedQty,
          reason_type: reservationReasonType(quote.quote_mode),
          reason_id: reservation.id,
          reason_label: `Fran POS ${quote.quote_mode} quote ${quote.quote_revision}`,
          expires_at: expiresAt,
          notes: `Held from quote ${quote.id}`,
          pos_reservation_id: reservation.id,
          quote_id: quote.id,
          quote_line_id: quoteLine.id,
          pos_cart_id: reservation.pos_cart_id,
          source: reservation.source,
          idempotency_key: idempotencyKey ? `${idempotencyKey}:${quoteLine.id}` : null,
          status: 'active',
          metadata: {
            quote_line_id: quoteLine.id,
            quote_line_key: quoteLine.line_id,
            product_context: quoteLine.product_context,
          },
        })
        .select()
        .single()

      if (inventoryReservationError) throw createError({ statusCode: 500, statusMessage: inventoryReservationError.message })
      heldLine.inventory_reservation_id = inventoryReservation.id

      const { data: reservationLine, error: reservationLineError } = await client
        .from('pos_reservation_lines')
        .insert({
          workspace_id: ctx.workspaceId,
          reservation_id: reservation.id,
          quote_line_id: quoteLine.id,
          inventory_reservation_id: inventoryReservation.id,
          product_id: quoteLine.product_id,
          variant_id: quoteLine.variant_id,
          inventory_location_id: inventoryLocationId,
          requested_qty: requestedQty,
          reserved_qty: requestedQty,
          status: 'active',
          metadata: {
            quote_line_key: quoteLine.line_id,
            sku: quoteLine.sku,
            display_name: quoteLine.display_name,
          },
        })
        .select()
        .single()

      if (reservationLineError) throw createError({ statusCode: 500, statusMessage: reservationLineError.message })
      createdLines.push(reservationLine)
    }
  } catch (error) {
    await releaseReservationStock(client, ctx.workspaceId, reservation, heldLines)
    await client.from('pos_reservations').update({ status: 'cancelled' }).eq('id', reservation.id)
    throw error
  }

  await client.from('pos_basket_quotes').update({ status: 'reserved' }).eq('id', quote.id)
  setResponseStatus(event, 201)
  return { data: { reservation, lines: createdLines } }
}

export async function commitReservationFromBody(event: any, reservationId: string, body: Record<string, any>) {
  const ctx = await requireApiKey(event, 'pos:write')
  const client = getAdminClient()
  const result = await commitReservationStock(client, ctx.workspaceId, reservationId, {
    pos_sale_id: uuidOrNull(body.pos_sale_id) || uuidOrNull(body.sale_id),
  })
  return { data: result, duplicate: result.duplicate }
}

export async function releaseReservationFromBody(event: any, reservationId: string) {
  const ctx = await requireApiKey(event, 'pos:write')
  const client = getAdminClient()
  const { reservation, lines } = await fetchReservation(client, ctx.workspaceId, reservationId)
  if (reservation.status === 'released') return { data: { reservation, lines }, duplicate: true }
  if (reservation.status === 'committed') {
    throw createError({ statusCode: 409, statusMessage: 'committed reservations cannot be released' })
  }

  const releasedLines = await releaseReservationStock(client, ctx.workspaceId, reservation, lines)
  const releasedAt = new Date().toISOString()
  const { data: updatedReservation, error } = await client
    .from('pos_reservations')
    .update({ status: 'released', released_at: releasedAt })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', reservation.id)
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (updatedReservation.quote_id) {
    await client
      .from('pos_basket_quotes')
      .update({ status: 'released' })
      .eq('workspace_id', ctx.workspaceId)
      .eq('id', updatedReservation.quote_id)
  }

  return { data: { reservation: updatedReservation, lines: releasedLines } }
}

async function applyDirectSaleInventoryMovements(client: any, workspaceId: string, sale: Record<string, any>, saleItems: Record<string, any>[], body: Record<string, any>) {
  if (sale.status !== 'completed') return { status: 'skipped', reason: 'sale_not_completed', movements: [] }

  const locationContext = await resolveLocationContext(client, workspaceId, {
    ...body,
    location_id: body.location_id || sale.location_id,
    inventory_location_id: body.inventory_location_id || asRecord(body.metadata).inventory_location_id,
  })
  if (!locationContext.inventory_location_id) return { status: 'skipped', reason: 'inventory_location_missing', movements: [] }

  const productIds = compact(saleItems.map((item) => item.product_id))
  const productTrackInventory = new Map<string, boolean>()
  if (productIds.length > 0) {
    const { data, error } = await client
      .from('products')
      .select('id, track_inventory')
      .eq('workspace_id', workspaceId)
      .in('id', productIds)
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    for (const product of data || []) productTrackInventory.set(product.id, product.track_inventory !== false)
  }

  const movements: any[] = []
  for (const item of saleItems) {
    if (!item.product_id || productTrackInventory.get(item.product_id) === false) continue
    const quantity = integerQuantity(item.quantity, 'sale inventory quantity')
    const isReturn = item.line_type === 'return' || item.line_type === 'exchange_in' || sale.sale_type === 'return'
    const delta = isReturn ? quantity : -quantity
    const movementType = isReturn ? 'return' : 'sale'

    const { error } = await client.rpc('upsert_inventory_level', {
      p_workspace_id: workspaceId,
      p_product_id: item.product_id,
      p_variant_id: item.variant_id || null,
      p_location_id: locationContext.inventory_location_id,
      p_quantity_type: 'on_hand',
      p_delta: delta,
      p_movement_type: movementType,
      p_reference_type: 'pos_sale',
      p_reference_id: sale.id,
      p_reference_line_id: item.id,
      p_notes: `${movementType === 'return' ? 'Returned' : 'Sold'} via POS receipt ${sale.receipt_number}`,
      p_created_by: null,
    })
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    movements.push({ sale_item_id: item.id, product_id: item.product_id, quantity_delta: delta, movement_type: movementType })
  }

  return { status: 'applied', mode: 'direct_sale_movement', inventory_location_id: locationContext.inventory_location_id, movements }
}

export async function commitInventoryForPosSale(client: any, workspaceId: string, sale: Record<string, any>, saleItems: Record<string, any>[], body: Record<string, any>) {
  const metadata = asRecord(body.metadata)
  const franContext = asRecord(metadata.fran_context)
  const reservationId =
    textValue(body.pos_reservation_id) ||
    textValue(body.reservation_id) ||
    textValue(metadata.pos_reservation_id) ||
    textValue(metadata.reservation_id) ||
    textValue(franContext.pos_reservation_id) ||
    textValue(franContext.reservation_id)

  if (reservationId) {
    const result = await commitReservationStock(client, workspaceId, reservationId, { pos_sale_id: sale.id, idempotent: true })
    return {
      status: 'applied',
      mode: 'reservation_commit',
      reservation_id: reservationId,
      duplicate: result.duplicate,
      line_count: result.lines.length,
    }
  }

  return applyDirectSaleInventoryMovements(client, workspaceId, sale, saleItems, body)
}
