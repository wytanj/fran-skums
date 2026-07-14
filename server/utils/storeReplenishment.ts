/**
 * Store replenishment orchestration (TODO-LOFT Phase B).
 * Request = signal only. HQ decides approve_now | reject | defer_to_wave.
 * Send to Loft is a separate execute_3pl step.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { StoreReplenishmentOrder as OfSOrderPayload } from '../../fulfillment/_types'
import {
  createWorldsyntechStoreReplenishmentOrder,
  stableWorldsyntechHash,
  type WorldsyntechCredentials,
} from '../../fulfillment/worldsyntech-ofs/client'
import { mapWorldsyntechOrderCreateResult } from '../../fulfillment/worldsyntech-ofs/mapping'
import { upsertIntegrationEntityMapping } from './integrationActions'

export type ReplenishmentDecision = 'approve_now' | 'reject' | 'defer_to_wave'

export function waveNumberForDate(waveDate: string | Date): string {
  const d = typeof waveDate === 'string' ? waveDate.slice(0, 10) : waveDate.toISOString().slice(0, 10)
  return `WAVE-${d}`
}

export function orderNumber(prefix = 'RO'): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`
}

/** Notify HQ inbox when a store submits a replenishment request. */
export async function notifyReplenishmentRequestSubmitted(
  client: SupabaseClient,
  params: {
    workspaceId: string
    requestId: string
    requestNumber: string
    priority?: string
    reason?: string | null
    lineCount: number
    storeLabel?: string | null
  },
) {
  const priority = params.priority || 'normal'
  const title = `Store replenishment request ${params.requestNumber}`
  const body = [
    params.storeLabel ? `Store: ${params.storeLabel}` : null,
    `${params.lineCount} line(s)`,
    params.reason ? `Reason: ${params.reason}` : null,
    'Review with baseline/lift (MCP) — approve now, defer to Mon/Thu wave, or reject.',
  ].filter(Boolean).join(' · ')

  const { data: notification, error } = await client
    .from('store_ops_notifications')
    .insert({
      workspace_id: params.workspaceId,
      notification_type: 'replenishment_request_submitted',
      title,
      body,
      priority,
      status: 'unread',
      target_scope: 'store_ops:approve',
      entity_type: 'store_replenishment_request',
      entity_id: params.requestId,
      deep_link: `/store-ops?request=${params.requestId}`,
      payload: {
        request_id: params.requestId,
        request_number: params.requestNumber,
        line_count: params.lineCount,
      },
    })
    .select()
    .single()

  if (error) throw error

  // Durable work queue for HQ (optional product link)
  await client.from('product_attention_items').insert({
    workspace_id: params.workspaceId,
    attention_type: 'store_ops.replenishment_request',
    risk_level: priority === 'critical' || priority === 'urgent' ? 'high' : 'medium',
    status: 'open',
    source_type: 'pos',
    source_app_key: 'fran_pos',
    title,
    summary: body,
    recommended_action: 'review_baseline_lift_and_decide',
    evidence: {
      request_id: params.requestId,
      request_number: params.requestNumber,
    },
    metadata: {
      notification_id: notification.id,
      target_scope: 'store_ops:approve',
    },
    idempotency_key: `store_ops.req.${params.requestId}`,
  }).then(() => {}, () => {})

  return notification
}

export async function ensureWave(
  client: SupabaseClient,
  workspaceId: string,
  waveDate: string,
  createdBy?: string | null,
) {
  const date = waveDate.slice(0, 10)
  const waveNumber = waveNumberForDate(date)

  const { data: existing } = await client
    .from('store_replenishment_waves')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('wave_date', date)
    .maybeSingle()

  if (existing) return existing

  const { data, error } = await client
    .from('store_replenishment_waves')
    .insert({
      workspace_id: workspaceId,
      wave_number: waveNumber,
      wave_date: date,
      status: 'open',
      created_by: createdBy || null,
      metadata: { source: 'ensure_wave' },
    })
    .select()
    .single()

  if (error) {
    // race: re-fetch
    const { data: again } = await client
      .from('store_replenishment_waves')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('wave_date', date)
      .maybeSingle()
    if (again) return again
    throw error
  }
  return data
}

export async function listUpcomingWaveDates(
  client: SupabaseClient,
  workspaceId: string,
  count = 4,
): Promise<Array<{ wave_date: string; weekday: number }>> {
  const { data, error } = await client.rpc('next_replenishment_wave_dates', {
    p_workspace_id: workspaceId,
    p_from: new Date().toISOString().slice(0, 10),
    p_count: count,
  })
  if (error) {
    // Fallback Mon/Thu without RPC if migration not applied
    return fallbackMonThuDates(count)
  }
  return (data || []).map((row: any) => ({
    wave_date: String(row.wave_date).slice(0, 10),
    weekday: Number(row.weekday),
  }))
}

function fallbackMonThuDates(count: number) {
  const out: Array<{ wave_date: string; weekday: number }> = []
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  while (out.length < count) {
    // JS: 0=Sun … 1=Mon … 4=Thu
    const day = d.getDay()
    const isodow = day === 0 ? 7 : day
    if (isodow === 1 || isodow === 4) {
      out.push({
        wave_date: d.toISOString().slice(0, 10),
        weekday: isodow,
      })
    }
    d.setDate(d.getDate() + 1)
  }
  return out
}

/**
 * HQ decision on a store request. Never calls Loft.
 */
export async function decideReplenishmentRequest(
  client: SupabaseClient,
  params: {
    workspaceId: string
    requestId: string
    decision: ReplenishmentDecision
    decisionReason?: string | null
    waveDate?: string | null
    decidedBy?: string | null
    mcpContext?: Record<string, unknown> | null
    deliveryMode?: 'delivery' | 'self_collect' | null
  },
) {
  const { data: request, error: loadError } = await client
    .from('store_replenishment_requests')
    .select('*, lines:store_replenishment_request_lines(*)')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.requestId)
    .maybeSingle()

  if (loadError) throw loadError
  if (!request) throw Object.assign(new Error('Request not found'), { statusCode: 404 })

  if (!['submitted', 'in_review', 'deferred_to_wave'].includes(request.status)) {
    throw Object.assign(
      new Error(`Request cannot be decided in status ${request.status}`),
      { statusCode: 409 },
    )
  }

  const now = new Date().toISOString()
  let wave: any = null
  let nextStatus = request.status
  let decision = params.decision

  if (decision === 'reject') {
    nextStatus = 'rejected'
  } else if (decision === 'defer_to_wave') {
    const dates = await listUpcomingWaveDates(client, params.workspaceId, 6)
    const waveDate = (params.waveDate || dates[0]?.wave_date || '').slice(0, 10)
    if (!waveDate) throw Object.assign(new Error('wave_date is required for defer_to_wave'), { statusCode: 400 })
    wave = await ensureWave(client, params.workspaceId, waveDate, params.decidedBy)
    nextStatus = 'deferred_to_wave'
  } else if (decision === 'approve_now') {
    nextStatus = 'approved'
  }

  const { data: updated, error: updateError } = await client
    .from('store_replenishment_requests')
    .update({
      status: nextStatus,
      decision,
      decision_reason: params.decisionReason || null,
      decided_by: params.decidedBy || null,
      decided_at: now,
      approved_by: decision === 'approve_now' ? params.decidedBy || null : request.approved_by,
      approved_at: decision === 'approve_now' ? now : request.approved_at,
      wave_id: wave?.id || null,
      wave_date: wave?.wave_date || params.waveDate || null,
      mcp_context: params.mcpContext || request.mcp_context || {},
      metadata: {
        ...(request.metadata || {}),
        last_decision: decision,
        delivery_mode: params.deliveryMode || (request.metadata as any)?.delivery_mode || null,
      },
    })
    .eq('id', params.requestId)
    .select()
    .single()

  if (updateError) throw updateError

  // Archive related notifications
  await client
    .from('store_ops_notifications')
    .update({ status: 'archived' })
    .eq('workspace_id', params.workspaceId)
    .eq('entity_type', 'store_replenishment_request')
    .eq('entity_id', params.requestId)
    .eq('status', 'unread')

  let order: any = null
  if (decision === 'approve_now') {
    order = await convertRequestToOrder(client, {
      workspaceId: params.workspaceId,
      requestId: params.requestId,
      approvedBy: params.decidedBy,
      deliveryMode: params.deliveryMode || 'delivery',
      waveId: null,
    })
  }

  return { request: updated, wave, order }
}

export async function convertRequestToOrder(
  client: SupabaseClient,
  params: {
    workspaceId: string
    requestId: string
    approvedBy?: string | null
    deliveryMode?: 'delivery' | 'self_collect'
    deliveryMethodId?: string | number | null
    connectionId?: string | null
    waveId?: string | null
    sourceLocationId?: string | null
  },
) {
  const { data: request, error } = await client
    .from('store_replenishment_requests')
    .select('*, lines:store_replenishment_request_lines(*)')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.requestId)
    .maybeSingle()

  if (error) throw error
  if (!request) throw Object.assign(new Error('Request not found'), { statusCode: 404 })

  const lines = Array.isArray(request.lines) ? request.lines : []
  if (!lines.length) throw Object.assign(new Error('Request has no lines'), { statusCode: 400 })

  const now = new Date().toISOString()
  const { data: order, error: orderError } = await client
    .from('store_replenishment_orders')
    .insert({
      workspace_id: params.workspaceId,
      order_number: orderNumber('RO'),
      request_id: request.id,
      connection_id: params.connectionId || null,
      status: 'approved',
      priority: request.priority || 'normal',
      source_location_id: params.sourceLocationId || null,
      destination_location_id: request.store_location_id,
      pos_location_id: request.pos_location_id,
      delivery_mode: params.deliveryMode || 'delivery',
      delivery_method_id: params.deliveryMethodId != null ? String(params.deliveryMethodId) : null,
      wave_id: params.waveId || request.wave_id || null,
      approved_by: params.approvedBy || null,
      approved_at: now,
      metadata: {
        from_request: request.request_number,
        decision: request.decision,
      },
    })
    .select()
    .single()

  if (orderError) throw orderError

  const orderLines = lines.map((line: any) => ({
    order_id: order.id,
    workspace_id: params.workspaceId,
    request_line_id: line.id,
    product_id: line.product_id,
    variant_id: line.variant_id,
    product_identity_id: line.product_identity_id,
    trade_unit_id: line.trade_unit_id,
    sku: line.sku,
    ordered_qty: line.approved_qty != null && line.approved_qty > 0 ? line.approved_qty : line.requested_qty,
    status: 'ordered',
    metadata: line.metadata || {},
  }))

  const { error: lineError } = await client
    .from('store_replenishment_order_lines')
    .insert(orderLines)
  if (lineError) throw lineError

  await client
    .from('store_replenishment_requests')
    .update({ status: 'converted' })
    .eq('id', request.id)

  await client
    .from('store_replenishment_request_lines')
    .update({ status: 'converted' })
    .eq('request_id', request.id)

  return order
}

/**
 * Convert deferred requests on a wave into orders (still no Loft send).
 */
export async function convertWaveRequestsToOrders(
  client: SupabaseClient,
  params: {
    workspaceId: string
    waveId: string
    approvedBy?: string | null
    deliveryMode?: 'delivery' | 'self_collect'
    connectionId?: string | null
    sourceLocationId?: string | null
  },
) {
  const { data: requests, error } = await client
    .from('store_replenishment_requests')
    .select('id')
    .eq('workspace_id', params.workspaceId)
    .eq('wave_id', params.waveId)
    .eq('status', 'deferred_to_wave')

  if (error) throw error
  const orders = []
  for (const req of requests || []) {
    const order = await convertRequestToOrder(client, {
      workspaceId: params.workspaceId,
      requestId: req.id,
      approvedBy: params.approvedBy,
      deliveryMode: params.deliveryMode || 'delivery',
      connectionId: params.connectionId,
      waveId: params.waveId,
      sourceLocationId: params.sourceLocationId,
    })
    orders.push(order)
  }
  return orders
}

/** B.4: block send when SKUMS knows only short-dated expiry stock for a SKU (default 9 months). */
export async function checkNearExpiryGate(
  client: SupabaseClient,
  params: {
    workspaceId: string
    productIds: string[]
    minRemainingMonths?: number
    allowOverride?: boolean
  },
): Promise<{ ok: boolean; blocked: Array<{ product_id: string; days_until_expiry: number; expiry_date: string }>; min_days: number }> {
  const minMonths = params.minRemainingMonths ?? 9
  const minDays = Math.floor(minMonths * 30.44)
  const blocked: Array<{ product_id: string; days_until_expiry: number; expiry_date: string }> = []
  const ids = [...new Set(params.productIds.filter(Boolean))]
  if (!ids.length) return { ok: true, blocked, min_days: minDays }

  const { data: items } = await client
    .from('expiry_items')
    .select('product_id, expiry_year, expiry_month, expiry_day, remaining_qty, status')
    .eq('workspace_id', params.workspaceId)
    .eq('status', 'in_stock')
    .in('product_id', ids)

  const byProduct = new Map<string, number>() // max days remaining among in-stock lots
  for (const item of items || []) {
    if (!item.product_id || Number(item.remaining_qty || 0) <= 0) continue
    const day = item.expiry_day || 1
    const exp = new Date(Date.UTC(item.expiry_year, item.expiry_month - 1, day))
    const days = Math.floor((exp.getTime() - Date.now()) / (86400 * 1000))
    const prev = byProduct.get(item.product_id)
    if (prev === undefined || days > prev) byProduct.set(item.product_id, days)
  }

  for (const [productId, days] of byProduct) {
    if (days < minDays) {
      const expDate = new Date(Date.now() + days * 86400 * 1000)
      blocked.push({
        product_id: productId,
        days_until_expiry: days,
        expiry_date: expDate.toISOString().slice(0, 10),
      })
    }
  }

  if (blocked.length && !params.allowOverride) {
    return { ok: false, blocked, min_days: minDays }
  }
  return { ok: true, blocked, min_days: minDays }
}

/**
 * Send an approved/queued order to WorldSyntech OFS.
 */
export async function sendOrderToLoft(
  client: SupabaseClient,
  params: {
    workspaceId: string
    orderId: string
    credentials: WorldsyntechCredentials
    connectionId: string
    shippingAddress: OfSOrderPayload['shipping_address']
    externalProductIdBySku?: Record<string, string | number>
    /** Requires inventory:override_expiry when true */
    overrideExpiry?: boolean
    overrideExpiryReason?: string | null
    overrideBy?: string | null
  },
) {
  const { data: order, error } = await client
    .from('store_replenishment_orders')
    .select('*, lines:store_replenishment_order_lines(*)')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.orderId)
    .maybeSingle()

  if (error) throw error
  if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 })
  if (!['approved', 'queued', 'failed'].includes(order.status)) {
    throw Object.assign(new Error(`Order cannot be sent in status ${order.status}`), { statusCode: 409 })
  }

  const lines = Array.isArray(order.lines) ? order.lines : []
  const productIds = lines.map((l: any) => l.product_id).filter(Boolean)
  const expiryGate = await checkNearExpiryGate(client, {
    workspaceId: params.workspaceId,
    productIds,
    allowOverride: Boolean(params.overrideExpiry),
  })
  if (!expiryGate.ok) {
    throw Object.assign(
      new Error(
        `Near-expiry gate blocked send (${expiryGate.blocked.length} SKU(s) under ${expiryGate.min_days} days shelf life). Pass override_expiry with inventory:override_expiry scope.`,
      ),
      { statusCode: 409, data: { gate: 'near_expiry', blocked: expiryGate.blocked } },
    )
  }

  const payload: OfSOrderPayload = {
    reference_no: order.order_number,
    destination_store_code: undefined,
    delivery_method_id: order.delivery_method_id || params.credentials.default_delivery_method_id,
    shipping_address: params.shippingAddress,
    comment: `Store replenishment ${order.order_number}${order.delivery_mode === 'self_collect' ? ' (self collect)' : ''}`,
    lines: lines.map((line: any) => ({
      sku: line.sku,
      quantity: line.ordered_qty,
      external_product_id: params.externalProductIdBySku?.[line.sku]
        || line.metadata?.external_product_id
        || undefined,
    })),
    metadata: {
      source_channel: 'retail_replenishment',
      source_order_id: order.id,
      delivery_mode: order.delivery_mode,
    },
  }

  const result = await createWorldsyntechStoreReplenishmentOrder(params.credentials, payload)
  const mapped = mapWorldsyntechOrderCreateResult(result.data)

  const now = new Date().toISOString()
  await client
    .from('store_replenishment_orders')
    .update({
      status: 'sent_to_3pl',
      connection_id: params.connectionId,
      external_order_id: mapped.external_id || null,
      external_status: mapped.status || 'created',
      sent_at: now,
      metadata: {
        ...(order.metadata || {}),
        loft_response: mapped.raw,
        near_expiry_gate: {
          blocked_count: expiryGate.blocked.length,
          overridden: Boolean(params.overrideExpiry && expiryGate.blocked.length),
          override_reason: params.overrideExpiryReason || null,
          override_by: params.overrideBy || null,
          min_days: expiryGate.min_days,
        },
      },
    })
    .eq('id', order.id)

  if (mapped.external_id) {
    await upsertIntegrationEntityMapping(client, {
      workspace_id: params.workspaceId,
      connection_id: params.connectionId,
      entity_type: 'order',
      local_entity_type: 'store_replenishment',
      local_entity_id: order.id,
      external_id: mapped.external_id,
      external_secondary_id: order.order_number,
      external_data: {
        source: 'worldsyntech_ofs',
        order: payload,
        response: result.data,
      },
      remote_hash: stableWorldsyntechHash(result.data),
    })
  }

  return { order_id: order.id, result: mapped, credentials: result.credentials }
}

/**
 * Read-only baseline/lift recommendation label for MCP / HQ UI.
 * Does not mutate state.
 */
export async function recommendReplenishmentDecision(
  client: SupabaseClient,
  params: { workspaceId: string; requestId: string },
): Promise<{
  recommendation: ReplenishmentDecision
  reasons: string[]
  baseline: Record<string, unknown>
  lift: Record<string, unknown>
  next_wave_dates: Array<{ wave_date: string; weekday: number }>
}> {
  const { data: request } = await client
    .from('store_replenishment_requests')
    .select('*, lines:store_replenishment_request_lines(*)')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.requestId)
    .maybeSingle()

  if (!request) {
    return {
      recommendation: 'reject',
      reasons: ['Request not found'],
      baseline: {},
      lift: {},
      next_wave_dates: [],
    }
  }

  const lines = Array.isArray(request.lines) ? request.lines : []
  const waves = await listUpcomingWaveDates(client, params.workspaceId, 4)
  const reasons: string[] = []
  let score = 0

  if (request.priority === 'critical') {
    score += 3
    reasons.push('Priority is critical')
  } else if (request.priority === 'urgent') {
    score += 2
    reasons.push('Priority is urgent')
  } else {
    reasons.push('Priority is normal/low — weekly wave may be enough')
  }

  if (request.needed_by) {
    const needed = new Date(request.needed_by)
    const nextWave = waves[0]?.wave_date ? new Date(waves[0].wave_date) : null
    if (nextWave && needed < nextWave) {
      score += 2
      reasons.push(`needed_by ${request.needed_by} is before next wave ${waves[0].wave_date}`)
    } else {
      reasons.push('needed_by is on/after next scheduled wave')
    }
  }

  // Simple stockout proxy: compare requested qty vs store on_hand when location known
  let lowStockLines = 0
  if (request.store_location_id && lines.length) {
    for (const line of lines) {
      if (!line.product_id) continue
      const { data: level } = await client
        .from('inventory_levels')
        .select('on_hand, reserved')
        .eq('workspace_id', params.workspaceId)
        .eq('location_id', request.store_location_id)
        .eq('product_id', line.product_id)
        .maybeSingle()
      const available = Math.max(0, Number(level?.on_hand || 0) - Number(level?.reserved || 0))
      if (available < Number(line.requested_qty || 0)) {
        lowStockLines += 1
      }
    }
  }
  if (lowStockLines > 0) {
    score += 1
    reasons.push(`${lowStockLines} line(s) appear below requested qty at store`)
  }

  let recommendation: ReplenishmentDecision = 'defer_to_wave'
  if (score >= 3) recommendation = 'approve_now'
  else if (score <= 0 && request.priority === 'low') recommendation = 'defer_to_wave'

  return {
    recommendation,
    reasons,
    baseline: {
      next_wave_dates: waves,
      cadence: 'Monday + Thursday (workspace default unless store_ops_settings overrides)',
      line_count: lines.length,
    },
    lift: {
      priority: request.priority,
      needed_by: request.needed_by,
      low_stock_lines: lowStockLines,
      score,
    },
    next_wave_dates: waves,
  }
}
