/**
 * Inventory ATS + product logistics status for MCP / Catalog AI (read-only).
 * product.stock_quantity is NOT the source of truth — inventory_levels is.
 */

const OPEN_INBOUND = [
  'draft',
  'asn_sent',
  'in_transit',
  'loft_receiving',
  'partial_received',
  'fully_received',
  'lise_confirmed',
  'exception',
]

const OPEN_REPLENISH = [
  'approved',
  'queued',
  'sent_to_3pl',
  'acknowledged',
  'shipped',
  'partially_shipped',
  'partially_received',
]

const OPEN_REQUESTS = ['submitted', 'in_review', 'deferred_to_wave', 'approved']

/**
 * Human-readable stage from location codes + open logistics.
 * @param {Array<Record<string, any>>} locations
 * @param {Array<Record<string, any>>} inbound
 * @param {Array<Record<string, any>>} replenish
 */
export function deriveLifecycleStages(locations, inbound, replenish) {
  /** @type {string[]} */
  const stages = []

  for (const loc of locations || []) {
    const code = String(loc.location_code || loc.code || '').toUpperCase()
    const type = String(loc.location_type || '')
    const ats = Number(loc.ats ?? Math.max(0, (loc.on_hand || 0) - (loc.reserved || 0)))
    const onHand = Number(loc.on_hand || 0)
    const inTransitBucket = Number(loc.in_transit || 0)
    const onOrder = Number(loc.on_order || 0)

    if (code === 'LOFT-SG' || type === '3pl') {
      if (ats > 0) stages.push(`in_stock_at_loft (${ats} ATS at ${code || '3pl'})`)
      else if (onHand > 0) stages.push(`at_loft_reserved (${onHand} on_hand, ${loc.reserved || 0} reserved)`)
    } else if (code.includes('XFER') || type === 'in_transit') {
      if (onHand > 0 || inTransitBucket > 0) {
        stages.push(`in_transit_loft_to_store (${onHand || inTransitBucket} at ${code || 'in_transit'})`)
      }
    } else if (type === 'store') {
      if (ats > 0) stages.push(`in_stock_at_store (${ats} ATS at ${code || loc.location_name || 'store'})`)
    } else if (type === 'warehouse' && ats > 0) {
      stages.push(`in_stock_warehouse (${ats} ATS at ${code})`)
    }

    if (onOrder > 0) stages.push(`on_order_bucket (${onOrder} at ${code || type})`)
    if (inTransitBucket > 0 && type !== 'in_transit' && !code.includes('XFER')) {
      stages.push(`location_in_transit_qty (${inTransitBucket} at ${code})`)
    }
  }

  for (const ib of inbound || []) {
    const st = String(ib.status || '')
    const fwd = [ib.offshore_forwarder, ib.local_forwarder].filter(Boolean).join(' → ') || 'forwarder'
    const track = ib.tracking_number ? ` tracking ${ib.tracking_number}` : ''
    const qty = ib.line_qty != null ? ` qty ${ib.line_qty}` : ''
    if (st === 'draft') stages.push(`inbound_draft_asn${qty}${track}`)
    else if (st === 'asn_sent') stages.push(`inbound_asn_sent_to_loft (${fwd})${qty}${track}`)
    else if (st === 'in_transit') stages.push(`inbound_in_transit_to_loft (${fwd})${qty}${track}`)
    else if (st === 'loft_receiving') stages.push(`inbound_loft_receiving${qty}${track}`)
    else if (st === 'partial_received') stages.push(`inbound_partial_at_loft${qty}${track}`)
    else if (st === 'fully_received') stages.push(`inbound_received_awaiting_lise_confirm${qty}${track}`)
    else if (st === 'lise_confirmed') stages.push(`inbound_lise_confirmed_promoting${qty}${track}`)
    else if (st === 'available') stages.push(`inbound_available_at_loft${qty}${track}`)
    else if (st === 'exception') stages.push(`inbound_exception${qty}${track}`)
  }

  for (const ro of replenish || []) {
    const st = String(ro.status || '')
    const qty = ro.line_qty != null ? ` qty ${ro.line_qty}` : ''
    const mode = ro.delivery_mode ? ` ${ro.delivery_mode}` : ''
    if (st === 'sent_to_3pl' || st === 'acknowledged') {
      stages.push(`replenish_at_loft_wms (${st}${mode})${qty}`)
    } else if (st === 'shipped' || st === 'partially_shipped') {
      stages.push(`replenish_shipped_to_store (${st}${mode})${qty}`)
    } else if (st === 'partially_received') {
      stages.push(`replenish_partially_received_at_store${qty}`)
    } else if (['approved', 'queued'].includes(st)) {
      stages.push(`replenish_order_${st}${qty}`)
    }
  }

  if (!stages.length) stages.push('no_inventory_or_open_logistics_found')

  // Primary status: first "strongest" stage
  const priority = [
    'in_stock_at_store',
    'in_transit_loft_to_store',
    'in_stock_at_loft',
    'at_loft_reserved',
    'inbound_loft_receiving',
    'inbound_in_transit_to_loft',
    'inbound_asn_sent_to_loft',
    'inbound_partial_at_loft',
    'replenish_shipped_to_store',
    'replenish_at_loft_wms',
  ]
  let primary = stages[0]
  for (const p of priority) {
    const hit = stages.find((s) => s.startsWith(p))
    if (hit) {
      primary = hit
      break
    }
  }

  return { primary_status: primary, stages }
}

/**
 * Resolve product ids from sku list and/or product_ids.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {string} workspaceId
 * @param {{ skus?: string[], product_ids?: string[], q?: string | null }} opts
 */
export async function resolveProducts(db, workspaceId, opts) {
  /** @type {Map<string, { id: string, title: string, sku: string | null }>} */
  const byId = new Map()

  const productIds = (opts.product_ids || []).map(String).filter(Boolean)
  if (productIds.length) {
    const { data, error } = await db
      .from('products')
      .select('id, title, sku')
      .eq('workspace_id', workspaceId)
      .in('id', productIds.slice(0, 50))
    if (error) throw new Error(error.message)
    for (const p of data || []) byId.set(p.id, p)
  }

  const skus = (opts.skus || []).map((s) => String(s).trim()).filter(Boolean)
  if (skus.length) {
    const { data, error } = await db
      .from('products')
      .select('id, title, sku')
      .eq('workspace_id', workspaceId)
      .in('sku', skus.slice(0, 50))
    if (error) throw new Error(error.message)
    for (const p of data || []) byId.set(p.id, p)
  }

  if (opts.q && !byId.size) {
    const q = String(opts.q).replace(/[%_,]/g, ' ').trim().slice(0, 120)
    if (q) {
      const { data, error } = await db
        .from('products')
        .select('id, title, sku')
        .eq('workspace_id', workspaceId)
        .or(`title.ilike.%${q}%,sku.ilike.%${q}%`)
        .limit(15)
      if (error) throw new Error(error.message)
      for (const p of data || []) byId.set(p.id, p)
    }
  }

  return [...byId.values()]
}

/**
 * ATS by location for one or more products.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{
 *   workspace_id: string,
 *   skus?: string[],
 *   product_ids?: string[],
 *   q?: string | null,
 *   location_codes?: string[] | null,
 * }} opts
 */
export async function inventoryAts(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')

  const products = await resolveProducts(db, workspace_id, {
    skus: opts.skus,
    product_ids: opts.product_ids,
    q: opts.q,
  })

  if (!products.length) {
    return {
      products: [],
      locations: [],
      rows: [],
      note: 'No matching products. Provide sku, product_id, or q.',
      agent_hint: 'product.stock_quantity on catalog rows is not ledger ATS. Use this tool for real levels.',
    }
  }

  const ids = products.map((p) => p.id)

  let locQuery = db
    .from('inventory_locations')
    .select('id, code, name, location_type, is_active')
    .eq('workspace_id', workspace_id)
    .eq('is_active', true)
  if (opts.location_codes?.length) {
    locQuery = locQuery.in('code', opts.location_codes.map((c) => String(c).toUpperCase()))
  }
  const { data: locations, error: locErr } = await locQuery
  if (locErr) throw new Error(locErr.message)

  const { data: levels, error: levErr } = await db
    .from('inventory_levels')
    .select('product_id, location_id, on_hand, reserved, on_order, in_transit, updated_at')
    .eq('workspace_id', workspace_id)
    .in('product_id', ids)
  if (levErr) throw new Error(levErr.message)

  const locMap = new Map((locations || []).map((l) => [l.id, l]))

  const rows = []
  for (const level of levels || []) {
    const loc = locMap.get(level.location_id)
    if (!loc) continue // filtered out inactive / code filter
    const on_hand = Number(level.on_hand || 0)
    const reserved = Number(level.reserved || 0)
    const ats = Math.max(0, on_hand - reserved)
    const product = products.find((p) => p.id === level.product_id)
    rows.push({
      product_id: level.product_id,
      sku: product?.sku || null,
      title: product?.title || null,
      location_id: level.location_id,
      location_code: loc.code,
      location_name: loc.name,
      location_type: loc.location_type,
      on_hand,
      reserved,
      ats,
      on_order: Number(level.on_order || 0),
      in_transit: Number(level.in_transit || 0),
      updated_at: level.updated_at,
    })
  }

  // Totals by product
  const by_product = products.map((p) => {
    const prow = rows.filter((r) => r.product_id === p.id)
    const loft = prow.filter((r) => r.location_code === 'LOFT-SG' || r.location_type === '3pl')
    const stores = prow.filter((r) => r.location_type === 'store')
    const xfer = prow.filter((r) => r.location_type === 'in_transit' || String(r.location_code).includes('XFER'))
    const sumAts = (arr) => arr.reduce((s, r) => s + r.ats, 0)
    return {
      product_id: p.id,
      sku: p.sku,
      title: p.title,
      loft_ats: sumAts(loft),
      store_ats: sumAts(stores),
      in_transit_ats: sumAts(xfer),
      total_ats: sumAts(prow),
      locations: prow,
    }
  })

  return {
    products: by_product,
    row_count: rows.length,
    location_filter: opts.location_codes || null,
    note: 'ATS = on_hand - reserved from inventory_levels. Catalog stock_quantity is ignored.',
    agent_hint:
      'LOFT-SG = warehouse after inbound confirm. XFER-* / in_transit = loft→store leg. store type = sellable at store after receive. Empty rows mean no ledger movements yet (common after cost-only import).',
    deep_links: { inventory: '/inventory', store_ops: '/store-ops', inbound: '/store-ops' },
  }
}

/**
 * Full product logistics status: levels + open inbound ASN + open replenishment + pending floor adj.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{
 *   workspace_id: string,
 *   sku?: string | null,
 *   product_id?: string | null,
 *   q?: string | null,
 * }} opts
 */
export async function productInventoryStatus(db, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('workspace_id required')
  if (!opts.sku && !opts.product_id && !opts.q) {
    throw new Error('Provide sku, product_id, or q')
  }

  const products = await resolveProducts(db, workspace_id, {
    skus: opts.sku ? [opts.sku] : [],
    product_ids: opts.product_id ? [opts.product_id] : [],
    q: opts.q || null,
  })

  if (!products.length) {
    return {
      found: false,
      product: null,
      lifecycle: { primary_status: 'not_found', stages: ['product_not_in_catalog'] },
      agent_hint: 'No catalog match. Check SKU spelling or search with q.',
    }
  }

  if (products.length > 1 && !opts.product_id && !opts.sku) {
    return {
      found: false,
      ambiguous: products.slice(0, 10),
      lifecycle: { primary_status: 'ambiguous', stages: ['multiple_products_matched'] },
      agent_hint: 'Multiple matches — call again with exact sku or product_id.',
    }
  }

  const product = products[0]
  const sku = product.sku

  // Levels
  const ats = await inventoryAts(db, {
    workspace_id,
    product_ids: [product.id],
  })
  const levelRows = ats.products[0]?.locations || []

  // Catalog snapshot (for pos_enabled / cost — not stock truth)
  const { data: fullProd } = await db
    .from('products')
    .select('id, title, sku, status, retail_price, cost_price, currency, stock_quantity, product_data, brand:brand_id(name)')
    .eq('workspace_id', workspace_id)
    .eq('id', product.id)
    .maybeSingle()

  const pd = fullProd?.product_data && typeof fullProd.product_data === 'object' ? fullProd.product_data : {}

  // Open inbound lines for this SKU / product
  let inbound = []
  {
    // Fetch lines by product/sku, then join open shipments client-side (nested filters are picky)
    const { data: lines, error } = await db
      .from('inbound_shipment_lines')
      .select(`
        id, sku, product_id, quantity, quantity_received, quantity_spoil, shipment_id
      `)
      .or(
        [
          product.id ? `product_id.eq.${product.id}` : null,
          sku ? `sku.eq.${sku}` : null,
        ]
          .filter(Boolean)
          .join(','),
      )
      .limit(40)

    if (error) {
      // table may not exist on old DB — soft fail
      inbound = []
    } else if (lines?.length) {
      const shipIds = [...new Set(lines.map((l) => l.shipment_id).filter(Boolean))]
      const { data: ships } = await db
        .from('inbound_shipments')
        .select(
          'id, shipment_number, status, tracking_number, date_estimate, local_forwarder, offshore_forwarder, external_status, workspace_id',
        )
        .eq('workspace_id', workspace_id)
        .in('id', shipIds)
      const shipMap = new Map((ships || []).map((s) => [s.id, s]))
      inbound = lines
        .map((l) => {
          const s = shipMap.get(l.shipment_id)
          if (!s || !OPEN_INBOUND.includes(s.status) || s.status === 'available') return null
          if (s.status === 'available') return null
          return {
            shipment_id: s.id,
            shipment_number: s.shipment_number,
            status: s.status,
            tracking_number: s.tracking_number,
            date_estimate: s.date_estimate,
            local_forwarder: s.local_forwarder,
            offshore_forwarder: s.offshore_forwarder,
            external_status: s.external_status,
            line_qty: l.quantity,
            quantity_received: l.quantity_received,
            sku: l.sku,
          }
        })
        .filter(Boolean)
        .filter((x) => x.status !== 'available')
    }
  }

  // Open replenishment order lines
  let replenish = []
  {
    const { data: lines, error } = await db
      .from('store_replenishment_order_lines')
      .select('id, sku, product_id, ordered_qty, received_qty, status, order_id')
      .or(
        [
          product.id ? `product_id.eq.${product.id}` : null,
          sku ? `sku.eq.${sku}` : null,
        ]
          .filter(Boolean)
          .join(','),
      )
      .limit(40)

    if (!error && lines?.length) {
      const orderIds = [...new Set(lines.map((l) => l.order_id).filter(Boolean))]
      const { data: orders } = await db
        .from('store_replenishment_orders')
        .select('id, order_number, status, delivery_mode, external_order_id, workspace_id')
        .eq('workspace_id', workspace_id)
        .in('id', orderIds)
      const omap = new Map((orders || []).map((o) => [o.id, o]))
      replenish = lines
        .map((l) => {
          const o = omap.get(l.order_id)
          if (!o || !OPEN_REPLENISH.includes(o.status)) return null
          return {
            order_id: o.id,
            order_number: o.order_number,
            status: o.status,
            delivery_mode: o.delivery_mode,
            external_order_id: o.external_order_id,
            line_qty: l.ordered_qty,
            received_qty: l.received_qty,
            sku: l.sku,
          }
        })
        .filter(Boolean)
    }
  }

  // Open store requests
  let requests = []
  {
    const { data: lines } = await db
      .from('store_replenishment_request_lines')
      .select('id, sku, product_id, requested_qty, status, request_id')
      .or(
        [
          product.id ? `product_id.eq.${product.id}` : null,
          sku ? `sku.eq.${sku}` : null,
        ]
          .filter(Boolean)
          .join(','),
      )
      .limit(40)

    if (lines?.length) {
      const rids = [...new Set(lines.map((l) => l.request_id).filter(Boolean))]
      const { data: reqs } = await db
        .from('store_replenishment_requests')
        .select('id, request_number, status, priority, workspace_id')
        .eq('workspace_id', workspace_id)
        .in('id', rids)
      const rmap = new Map((reqs || []).map((r) => [r.id, r]))
      requests = lines
        .map((l) => {
          const r = rmap.get(l.request_id)
          if (!r || !OPEN_REQUESTS.includes(r.status)) return null
          return {
            request_id: r.id,
            request_number: r.request_number,
            status: r.status,
            priority: r.priority,
            requested_qty: l.requested_qty,
            sku: l.sku,
          }
        })
        .filter(Boolean)
    }
  }

  // Pending floor adjustments
  let pending_adjustments = []
  {
    const { data: adjLines } = await db
      .from('inventory_adjustment_lines')
      .select('id, product_id, system_qty, counted_qty, reason, adjustment_id')
      .eq('product_id', product.id)
      .limit(20)

    if (adjLines?.length) {
      const aids = [...new Set(adjLines.map((l) => l.adjustment_id))]
      const { data: adjs } = await db
        .from('inventory_adjustments')
        .select('id, adjustment_number, adjustment_type, status, workspace_id')
        .eq('workspace_id', workspace_id)
        .in('id', aids)
        .in('status', ['pending', 'approved', 'draft'])
      const amap = new Map((adjs || []).map((a) => [a.id, a]))
      pending_adjustments = adjLines
        .map((l) => {
          const a = amap.get(l.adjustment_id)
          if (!a) return null
          return {
            adjustment_id: a.id,
            adjustment_number: a.adjustment_number,
            adjustment_type: a.adjustment_type,
            status: a.status,
            system_qty: l.system_qty,
            counted_qty: l.counted_qty,
            reason: l.reason,
          }
        })
        .filter(Boolean)
    }
  }

  const lifecycle = deriveLifecycleStages(levelRows, inbound, replenish)

  // Narrative path for forwarder → loft → store
  const path_summary = []
  if (inbound.some((i) => ['asn_sent', 'in_transit', 'draft'].includes(i.status))) {
    path_summary.push('supplier/forwarder → Loft (inbound ASN open)')
  }
  if (inbound.some((i) => ['loft_receiving', 'partial_received', 'fully_received', 'lise_confirmed'].includes(i.status))) {
    path_summary.push('arriving / receiving at Loft')
  }
  if ((ats.products[0]?.loft_ats || 0) > 0) path_summary.push('available at LOFT-SG')
  if (replenish.some((r) => ['sent_to_3pl', 'acknowledged', 'shipped'].includes(r.status))) {
    path_summary.push('Loft → store replenishment in progress')
  }
  if ((ats.products[0]?.in_transit_ats || 0) > 0) path_summary.push('in transit to store')
  if ((ats.products[0]?.store_ats || 0) > 0) path_summary.push('sellable at store')
  if (!path_summary.length) path_summary.push('no open logistics path; check levels or raise request/ASN')

  return {
    found: true,
    product: {
      id: product.id,
      title: fullProd?.title || product.title,
      sku: product.sku,
      status: fullProd?.status || null,
      brand: fullProd?.brand?.name || null,
      retail_price: fullProd?.retail_price ?? null,
      cost_price: fullProd?.cost_price ?? null,
      currency: fullProd?.currency || null,
      catalog_stock_quantity_field: fullProd?.stock_quantity ?? null,
      pos_enabled: pd.pos_enabled ?? pd.sellable_in_pos ?? null,
    },
    inventory: {
      loft_ats: ats.products[0]?.loft_ats || 0,
      store_ats: ats.products[0]?.store_ats || 0,
      in_transit_ats: ats.products[0]?.in_transit_ats || 0,
      total_ats: ats.products[0]?.total_ats || 0,
      by_location: levelRows,
    },
    logistics: {
      inbound_asn: inbound,
      replenishment_orders: replenish,
      store_requests: requests,
      pending_floor_adjustments: pending_adjustments,
    },
    lifecycle,
    path_summary,
    note: 'Ledger ATS is authoritative. catalog stock_quantity is often 0 after cost-only import.',
    agent_hint:
      'Answer “status of product X” with lifecycle.primary_status + path_summary. Mention LOFT-SG vs store vs inbound forwarder legs. Do not use catalog stock_quantity as in-stock truth.',
    deep_links: {
      inventory: '/inventory',
      store_ops: '/store-ops',
      product: `/products/${product.id}`,
    },
  }
}
