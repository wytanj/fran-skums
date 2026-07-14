/**
 * Store receive + exception verification (TODO-LOFT Phase C).
 * Policy: auto-apply uncontested good qty; exception lines → inventory_exceptions for HQ verify.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type ReceiveExceptionType = 'short' | 'damaged' | 'over' | 'wrong_sku' | 'unexpected_item' | 'unmapped_sku'

export interface ReceiveLineInput {
  sku: string
  product_id?: string | null
  replenishment_order_line_id?: string | null
  expected_qty: number
  received_qty: number
  damaged_qty?: number
  exception_type?: ReceiveExceptionType | null
  note?: string | null
}

function sessionNumber() {
  return `RCV-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 999).toString().padStart(3, '0')}`
}

function mapExceptionType(line: ReceiveLineInput): string | null {
  if (line.exception_type) return line.exception_type
  const damaged = Number(line.damaged_qty || 0)
  const received = Number(line.received_qty || 0)
  const expected = Number(line.expected_qty || 0)
  if (damaged > 0) return 'damaged'
  if (received < expected) return 'short'
  if (received > expected) return 'over'
  return null
}

function inventoryExceptionType(lineEx: string | null): string {
  if (lineEx === 'short') return 'short_receipt'
  if (lineEx === 'damaged') return 'damaged_receipt'
  if (lineEx === 'over') return 'over_receipt'
  if (lineEx === 'wrong_sku') return 'wrong_sku'
  if (lineEx === 'unmapped_sku') return 'unmapped_sku'
  return 'other'
}

/** Orders ready for store POS receive. */
export async function listExpectedDeliveries(
  client: SupabaseClient,
  params: {
    workspaceId: string
    posLocationCode?: string | null
    inventoryLocationId?: string | null
  },
) {
  let posLocationId: string | null = null
  let storeLocationId = params.inventoryLocationId || null

  if (params.posLocationCode) {
    const { data: posLoc } = await client
      .from('pos_locations')
      .select('id, code, inventory_location_id, name')
      .eq('workspace_id', params.workspaceId)
      .ilike('code', params.posLocationCode)
      .maybeSingle()
    if (posLoc) {
      posLocationId = posLoc.id
      storeLocationId = storeLocationId || posLoc.inventory_location_id
    }
  }

  let q = client
    .from('store_replenishment_orders')
    .select('*, lines:store_replenishment_order_lines(*)')
    .eq('workspace_id', params.workspaceId)
    .in('status', ['sent_to_3pl', 'acknowledged', 'shipped', 'partially_shipped', 'partially_received'])
    .order('updated_at', { ascending: false })
    .limit(50)

  if (posLocationId) q = q.eq('pos_location_id', posLocationId)
  else if (storeLocationId) q = q.eq('destination_location_id', storeLocationId)

  const { data, error } = await q
  if (error) throw error

  return (data || []).map((order: any) => {
    const lines = (Array.isArray(order.lines) ? order.lines : []).map((line: any) => {
      const expected = Math.max(0, Number(line.ordered_qty || 0) - Number(line.received_qty || 0))
      return {
        id: line.id,
        sku: line.sku,
        product_id: line.product_id,
        ordered_qty: line.ordered_qty,
        already_received_qty: line.received_qty,
        expected_qty: expected,
        damaged_qty: line.damaged_qty,
        status: line.status,
      }
    }).filter((l: any) => l.expected_qty > 0 || order.status === 'shipped')

    return {
      id: order.id,
      order_number: order.order_number,
      status: order.status,
      delivery_mode: order.delivery_mode,
      external_order_id: order.external_order_id,
      expected_delivery_at: order.expected_delivery_at,
      destination_location_id: order.destination_location_id,
      pos_location_id: order.pos_location_id,
      lines,
    }
  })
}

/**
 * Submit store receive session.
 * Applies good units to store on_hand; opens exceptions for HQ verify.
 */
export async function submitStoreReceive(
  client: SupabaseClient,
  params: {
    workspaceId: string
    orderId: string
    idempotencyKey: string
    receivedByRef?: string | null
    receivedAt?: string | null
    posLocationCode?: string | null
    collectorName?: string | null
    collectorNote?: string | null
    lines: ReceiveLineInput[]
  },
) {
  if (params.idempotencyKey) {
    const { data: existing } = await client
      .from('receiving_sessions')
      .select('*, lines:receiving_session_lines(*)')
      .eq('workspace_id', params.workspaceId)
      .eq('idempotency_key', params.idempotencyKey)
      .maybeSingle()
    if (existing) {
      return { session: existing, duplicate: true, exceptions: [], applied: [] as any[] }
    }
  }

  const { data: order, error: orderError } = await client
    .from('store_replenishment_orders')
    .select('*, lines:store_replenishment_order_lines(*)')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.orderId)
    .maybeSingle()

  if (orderError) throw orderError
  if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 })

  const storeLocationId = order.destination_location_id
  if (!storeLocationId) {
    throw Object.assign(new Error('Order has no destination store location'), { statusCode: 400 })
  }

  // Resolve transit location if present
  const { data: transitLoc } = await client
    .from('inventory_locations')
    .select('id')
    .eq('workspace_id', params.workspaceId)
    .eq('code', 'XFER-LOFT-STORE')
    .maybeSingle()

  const now = params.receivedAt || new Date().toISOString()
  const { data: session, error: sessionError } = await client
    .from('receiving_sessions')
    .insert({
      workspace_id: params.workspaceId,
      session_number: sessionNumber(),
      receipt_type: 'store_replenishment',
      status: 'submitted',
      idempotency_key: params.idempotencyKey,
      replenishment_order_id: order.id,
      pos_location_id: order.pos_location_id,
      inventory_location_id: storeLocationId,
      source_ref: order.order_number,
      received_at: now,
      submitted_at: now,
      metadata: {
        received_by_ref: params.receivedByRef || null,
        pos_location_code: params.posLocationCode || null,
        collector_name: params.collectorName || null,
        collector_note: params.collectorNote || null,
        delivery_mode: order.delivery_mode,
      },
    })
    .select()
    .single()

  if (sessionError) throw sessionError

  const orderLinesById = new Map(
    (Array.isArray(order.lines) ? order.lines : []).map((l: any) => [l.id, l]),
  )
  const orderLinesBySku = new Map(
    (Array.isArray(order.lines) ? order.lines : []).map((l: any) => [String(l.sku || '').toUpperCase(), l]),
  )

  const applied: any[] = []
  const exceptionRows: any[] = []
  const sessionLines: any[] = []
  let hasException = false

  for (const input of params.lines) {
    const sku = String(input.sku || '').trim()
    const orderLine = (input.replenishment_order_line_id && orderLinesById.get(input.replenishment_order_line_id))
      || orderLinesBySku.get(sku.toUpperCase())
      || null

    const expected = Number(input.expected_qty || 0)
    const received = Number(input.received_qty || 0)
    const damaged = Number(input.damaged_qty || 0)
    const goodQty = Math.max(0, received - damaged)
    const shortQty = Math.max(0, expected - received)
    const overageQty = Math.max(0, received - expected)
    const lineEx = mapExceptionType({
      ...input,
      expected_qty: expected,
      received_qty: received,
      damaged_qty: damaged,
    })
    const lineStatus = lineEx ? 'exception' : 'matched'
    if (lineEx) hasException = true

    let productId = input.product_id || orderLine?.product_id || null
    if (!productId && sku) {
      const { data: product } = await client
        .from('products')
        .select('id')
        .eq('workspace_id', params.workspaceId)
        .eq('sku', sku)
        .maybeSingle()
      productId = product?.id || null
    }

    sessionLines.push({
      session_id: session.id,
      workspace_id: params.workspaceId,
      replenishment_order_line_id: orderLine?.id || null,
      product_id: productId,
      sku,
      expected_qty: expected,
      received_qty: received,
      damaged_qty: damaged,
      overage_qty: overageQty,
      short_qty: shortQty,
      exception_type: lineEx,
      status: lineStatus,
      metadata: { note: input.note || null },
    })

    // Apply good qty to store on_hand
    if (goodQty > 0 && productId) {
      await client.rpc('upsert_inventory_level', {
        p_workspace_id: params.workspaceId,
        p_product_id: productId,
        p_variant_id: orderLine?.variant_id || null,
        p_location_id: storeLocationId,
        p_quantity_type: 'on_hand',
        p_delta: goodQty,
        p_movement_type: 'transfer_in',
        p_reference_type: 'receiving_session',
        p_reference_id: session.id,
        p_notes: `Store receive ${order.order_number} ${sku}`,
      })
      if (transitLoc?.id) {
        await client.rpc('upsert_inventory_level', {
          p_workspace_id: params.workspaceId,
          p_product_id: productId,
          p_variant_id: orderLine?.variant_id || null,
          p_location_id: transitLoc.id,
          p_quantity_type: 'in_transit',
          p_delta: -goodQty,
          p_movement_type: 'transfer_out',
          p_reference_type: 'receiving_session',
          p_reference_id: session.id,
          p_notes: `Clear transit for ${order.order_number} ${sku}`,
        }).then(() => {}, () => {})
      }
      applied.push({ sku, product_id: productId, good_qty: goodQty })
    }

    // Update order line received totals
    if (orderLine?.id) {
      const newReceived = Number(orderLine.received_qty || 0) + received
      const newDamaged = Number(orderLine.damaged_qty || 0) + damaged
      const newShort = Number(orderLine.short_qty || 0) + shortQty
      const ordered = Number(orderLine.ordered_qty || 0)
      let lineOrderStatus = orderLine.status
      if (newReceived + newDamaged >= ordered) lineOrderStatus = lineEx ? 'exception' : 'received'
      else if (newReceived > 0) lineOrderStatus = 'partially_received'

      await client
        .from('store_replenishment_order_lines')
        .update({
          received_qty: newReceived,
          damaged_qty: newDamaged,
          short_qty: newShort,
          status: lineOrderStatus,
        })
        .eq('id', orderLine.id)
    }

    if (lineEx) {
      exceptionRows.push({
        workspace_id: params.workspaceId,
        exception_type: inventoryExceptionType(lineEx),
        severity: lineEx === 'damaged' || lineEx === 'wrong_sku' ? 'high' : 'medium',
        status: 'open',
        source_type: 'receiving_session',
        source_id: session.id,
        pos_location_id: order.pos_location_id,
        inventory_location_id: storeLocationId,
        product_id: productId,
        sku,
        expected_qty: expected,
        actual_qty: received,
        title: `Receive ${lineEx}: ${sku} on ${order.order_number}`,
        summary: input.note || `POS reported ${lineEx} (expected ${expected}, received ${received}, damaged ${damaged})`,
        evidence: {
          session_id: session.id,
          order_id: order.id,
          line_exception: lineEx,
          damaged_qty: damaged,
          short_qty: shortQty,
          overage_qty: overageQty,
          received_by_ref: params.receivedByRef,
          pending_verification: true,
          note: input.note || null,
        },
      })
    }
  }

  if (sessionLines.length) {
    const { error: lineInsErr } = await client.from('receiving_session_lines').insert(sessionLines)
    if (lineInsErr) throw lineInsErr
  }

  let exceptions: any[] = []
  if (exceptionRows.length) {
    const { data: exData, error: exErr } = await client
      .from('inventory_exceptions')
      .insert(exceptionRows)
      .select()
    if (exErr) throw exErr
    exceptions = exData || []
  }

  // Order status
  const { data: refreshedLines } = await client
    .from('store_replenishment_order_lines')
    .select('ordered_qty, received_qty, status')
    .eq('order_id', order.id)

  const allReceived = (refreshedLines || []).every(
    (l: any) => Number(l.received_qty || 0) >= Number(l.ordered_qty || 0),
  )
  const anyReceived = (refreshedLines || []).some((l: any) => Number(l.received_qty || 0) > 0)
  let orderStatus = order.status
  if (allReceived && !hasException) orderStatus = 'received'
  else if (allReceived && hasException) orderStatus = 'exception'
  else if (anyReceived) orderStatus = 'partially_received'

  await client
    .from('store_replenishment_orders')
    .update({
      status: orderStatus,
      delivered_at: orderStatus === 'received' ? now : order.delivered_at,
    })
    .eq('id', order.id)

  await client
    .from('receiving_sessions')
    .update({
      status: hasException ? 'exception' : 'submitted',
    })
    .eq('id', session.id)

  return {
    session,
    duplicate: false,
    exceptions,
    applied,
    order_status: orderStatus,
    message: hasException
      ? 'Receive submitted. Exceptions reported to HQ for verification.'
      : 'Receive submitted. Good units applied to store stock.',
  }
}

export async function verifyInventoryException(
  client: SupabaseClient,
  params: {
    workspaceId: string
    exceptionId: string
    action: 'confirm' | 'reject' | 'adjust' | 'escalate'
    verifiedBy?: string | null
    note?: string | null
    adjustActualQty?: number | null
  },
) {
  const { data: ex, error } = await client
    .from('inventory_exceptions')
    .select('*')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.exceptionId)
    .maybeSingle()

  if (error) throw error
  if (!ex) throw Object.assign(new Error('Exception not found'), { statusCode: 404 })

  const now = new Date().toISOString()
  let status = ex.status
  const resolution = {
    ...(ex.resolution || {}),
    verification: {
      action: params.action,
      by: params.verifiedBy || null,
      at: now,
      note: params.note || null,
    },
  }

  if (params.action === 'confirm') status = 'resolved'
  else if (params.action === 'reject') status = 'dismissed'
  else if (params.action === 'escalate') status = 'escalated'
  else if (params.action === 'adjust') {
    status = 'resolved'
    if (params.adjustActualQty != null && ex.product_id && ex.inventory_location_id) {
      const delta = Number(params.adjustActualQty) - Number(ex.actual_qty || 0)
      if (delta !== 0) {
        await client.rpc('upsert_inventory_level', {
          p_workspace_id: params.workspaceId,
          p_product_id: ex.product_id,
          p_variant_id: null,
          p_location_id: ex.inventory_location_id,
          p_quantity_type: 'on_hand',
          p_delta: delta,
          p_movement_type: 'adjustment',
          p_reference_type: 'inventory_exception',
          p_reference_id: ex.id,
          p_notes: params.note || `HQ adjust after POS receive exception`,
          p_created_by: params.verifiedBy || null,
        })
      }
      resolution.adjusted_actual_qty = params.adjustActualQty
    }
  }

  const { data: updated, error: upErr } = await client
    .from('inventory_exceptions')
    .update({
      status,
      resolution,
      resolved_by: params.verifiedBy || ex.resolved_by,
      resolved_at: ['resolved', 'dismissed'].includes(status) ? now : ex.resolved_at,
      actual_qty: params.adjustActualQty != null ? params.adjustActualQty : ex.actual_qty,
    })
    .eq('id', ex.id)
    .select()
    .single()

  if (upErr) throw upErr
  return updated
}
