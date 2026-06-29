import type {
  InventoryException,
  InventoryExceptionSeverity,
  InventoryExceptionSourceType,
  InventoryExceptionStatus,
  InventoryExceptionType,
  ReceivingLineExceptionType,
  ReceivingLineStatus,
  ReceivingSession,
  ReceivingSessionLine,
  ReceivingSessionStatus,
  StoreOpsPriority,
  StoreReplenishmentOrder,
  StoreReplenishmentOrderLine,
  StoreReplenishmentOrderStatus,
  StoreReplenishmentRequest,
  StoreReplenishmentRequestLine,
  StoreReplenishmentRequestStatus,
  StoreReplenishmentRequestType,
  StoreOpsSourceType,
} from '~/types'

export interface StoreReplenishmentRequestLineInput {
  product_identity_id?: string | null
  trade_unit_id?: string | null
  listing_id?: string | null
  channel_id?: string | null
  sku_assignment_id?: string | null
  identifier_id?: string | null
  product_id?: string | null
  variant_id?: string | null
  sku?: string | null
  requested_qty: number
  approved_qty?: number | null
  reason?: string | null
  metadata?: Record<string, any>
}

export interface StoreReplenishmentRequestInput {
  request_number?: string
  request_type?: StoreReplenishmentRequestType
  status?: StoreReplenishmentRequestStatus
  priority?: StoreOpsPriority
  source_type?: StoreOpsSourceType
  source_ref?: string | null
  idempotency_key?: string | null
  pos_location_id?: string | null
  store_location_id?: string | null
  needed_by?: string | null
  reason?: string | null
  metadata?: Record<string, any>
}

export interface StoreReplenishmentOrderInput {
  order_number?: string
  request_id?: string | null
  connection_id?: string | null
  status?: StoreReplenishmentOrderStatus
  priority?: StoreOpsPriority
  source_location_id?: string | null
  destination_location_id?: string | null
  pos_location_id?: string | null
  expected_delivery_at?: string | null
  metadata?: Record<string, any>
}

export interface ReceivingSessionLineInput {
  replenishment_order_line_id?: string | null
  product_identity_id?: string | null
  trade_unit_id?: string | null
  listing_id?: string | null
  channel_id?: string | null
  sku_assignment_id?: string | null
  identifier_id?: string | null
  product_id?: string | null
  variant_id?: string | null
  sku?: string | null
  expected_qty?: number
  received_qty?: number
  damaged_qty?: number
  overage_qty?: number
  short_qty?: number
  exception_type?: ReceivingLineExceptionType | null
  status?: ReceivingLineStatus
  metadata?: Record<string, any>
}

export interface ReceivingSessionInput {
  session_number?: string
  receipt_type?: 'store_replenishment' | 'transfer' | 'purchase_order' | 'manual'
  status?: ReceivingSessionStatus
  idempotency_key?: string | null
  replenishment_order_id?: string | null
  transfer_id?: string | null
  purchase_order_id?: string | null
  pos_location_id?: string | null
  inventory_location_id?: string | null
  source_ref?: string | null
  received_at?: string | null
  metadata?: Record<string, any>
}

export interface InventoryExceptionInput {
  exception_type?: InventoryExceptionType
  severity?: InventoryExceptionSeverity
  status?: InventoryExceptionStatus
  source_type?: InventoryExceptionSourceType
  source_id?: string | null
  pos_location_id?: string | null
  inventory_location_id?: string | null
  connection_id?: string | null
  product_identity_id?: string | null
  trade_unit_id?: string | null
  listing_id?: string | null
  channel_id?: string | null
  sku_assignment_id?: string | null
  identifier_id?: string | null
  product_id?: string | null
  variant_id?: string | null
  sku?: string | null
  expected_qty?: number | null
  actual_qty?: number | null
  title: string
  summary?: string | null
  evidence?: Record<string, any>
  resolution?: Record<string, any>
}

export function useStoreOperations() {
  const client = useSupabaseClient()
  const { currentWorkspace } = useWorkspace()

  const requests = ref<StoreReplenishmentRequest[]>([])
  const orders = ref<StoreReplenishmentOrder[]>([])
  const receivingSessions = ref<ReceivingSession[]>([])
  const exceptions = ref<InventoryException[]>([])
  const loading = ref(false)

  function wsId() {
    return currentWorkspace.value?.id
  }

  function newNumber(prefix: string) {
    return `${prefix}-${Date.now().toString(36).toUpperCase()}`
  }

  async function loadRequests() {
    if (!wsId()) return
    const { data, error } = await client
      .from('v_store_replenishment_requests')
      .select('*')
      .eq('workspace_id', wsId()!)
      .order('created_at', { ascending: false })
    if (!error) requests.value = (data || []) as StoreReplenishmentRequest[]
    return { data, error }
  }

  async function loadRequestLines(requestId: string) {
    const { data, error } = await client
      .from('store_replenishment_request_lines')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at')
    return { data: (data || []) as StoreReplenishmentRequestLine[], error }
  }

  async function createReplenishmentRequest(
    request: StoreReplenishmentRequestInput,
    lines: StoreReplenishmentRequestLineInput[],
  ) {
    if (!wsId()) throw new Error('No workspace selected')
    const { data, error } = await client
      .from('store_replenishment_requests')
      .insert({
        workspace_id: wsId()!,
        request_number: request.request_number || newNumber('SRR'),
        request_type: request.request_type || 'manual',
        status: request.status || 'submitted',
        priority: request.priority || 'normal',
        source_type: request.source_type || 'skums',
        source_ref: request.source_ref || null,
        idempotency_key: request.idempotency_key || null,
        pos_location_id: request.pos_location_id || null,
        store_location_id: request.store_location_id || null,
        needed_by: request.needed_by || null,
        reason: request.reason || null,
        metadata: request.metadata || {},
      })
      .select()
      .single()

    if (error) return { data: null, error }

    const lineRows = lines
      .filter(line => Number(line.requested_qty || 0) > 0)
      .map(line => ({
        workspace_id: wsId()!,
        request_id: data.id,
        product_identity_id: line.product_identity_id || null,
        trade_unit_id: line.trade_unit_id || null,
        listing_id: line.listing_id || null,
        channel_id: line.channel_id || null,
        sku_assignment_id: line.sku_assignment_id || null,
        identifier_id: line.identifier_id || null,
        product_id: line.product_id || null,
        variant_id: line.variant_id || null,
        sku: line.sku || null,
        requested_qty: Math.max(1, Math.floor(Number(line.requested_qty || 0))),
        approved_qty: line.approved_qty ?? null,
        status: 'requested',
        reason: line.reason || null,
        metadata: line.metadata || {},
      }))

    if (lineRows.length) {
      const { error: lineError } = await client.from('store_replenishment_request_lines').insert(lineRows)
      if (lineError) return { data: null, error: lineError }
    }

    await loadRequests()
    return { data: data as StoreReplenishmentRequest, error: null }
  }

  async function updateReplenishmentRequestStatus(id: string, status: StoreReplenishmentRequestStatus) {
    const patch: Record<string, any> = { status }
    if (status === 'approved') patch.approved_at = new Date().toISOString()

    const { data, error } = await client
      .from('store_replenishment_requests')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (!error) await loadRequests()
    return { data: data as StoreReplenishmentRequest | null, error }
  }

  async function loadOrders() {
    if (!wsId()) return
    const { data, error } = await client
      .from('v_store_replenishment_orders')
      .select('*')
      .eq('workspace_id', wsId()!)
      .order('created_at', { ascending: false })
    if (!error) orders.value = (data || []) as StoreReplenishmentOrder[]
    return { data, error }
  }

  async function loadOrderLines(orderId: string) {
    const { data, error } = await client
      .from('store_replenishment_order_lines')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at')
    return { data: (data || []) as StoreReplenishmentOrderLine[], error }
  }

  async function createReplenishmentOrder(
    order: StoreReplenishmentOrderInput,
    lines: StoreReplenishmentRequestLineInput[],
  ) {
    if (!wsId()) throw new Error('No workspace selected')
    const { data, error } = await client
      .from('store_replenishment_orders')
      .insert({
        workspace_id: wsId()!,
        order_number: order.order_number || newNumber('SRO'),
        request_id: order.request_id || null,
        connection_id: order.connection_id || null,
        status: order.status || 'approved',
        priority: order.priority || 'normal',
        source_location_id: order.source_location_id || null,
        destination_location_id: order.destination_location_id || null,
        pos_location_id: order.pos_location_id || null,
        expected_delivery_at: order.expected_delivery_at || null,
        approved_at: order.status === 'approved' || !order.status ? new Date().toISOString() : null,
        metadata: order.metadata || {},
      })
      .select()
      .single()

    if (error) return { data: null, error }

    const lineRows = lines
      .filter(line => Number(line.approved_qty ?? line.requested_qty ?? 0) > 0)
      .map(line => ({
        workspace_id: wsId()!,
        order_id: data.id,
        product_identity_id: line.product_identity_id || null,
        trade_unit_id: line.trade_unit_id || null,
        listing_id: line.listing_id || null,
        channel_id: line.channel_id || null,
        sku_assignment_id: line.sku_assignment_id || null,
        identifier_id: line.identifier_id || null,
        product_id: line.product_id || null,
        variant_id: line.variant_id || null,
        sku: line.sku || null,
        ordered_qty: Math.max(1, Math.floor(Number(line.approved_qty ?? line.requested_qty))),
        status: 'ordered',
        metadata: line.metadata || {},
      }))

    if (lineRows.length) {
      const { error: lineError } = await client.from('store_replenishment_order_lines').insert(lineRows)
      if (lineError) return { data: null, error: lineError }
    }

    if (order.request_id) {
      await client.from('store_replenishment_requests').update({ status: 'converted' }).eq('id', order.request_id)
    }

    await Promise.all([loadRequests(), loadOrders()])
    return { data: data as StoreReplenishmentOrder, error: null }
  }

  async function updateReplenishmentOrderStatus(id: string, status: StoreReplenishmentOrderStatus) {
    const patch: Record<string, any> = { status }
    if (status === 'sent_to_3pl') patch.sent_at = new Date().toISOString()
    if (status === 'received') patch.delivered_at = new Date().toISOString()

    const { data, error } = await client
      .from('store_replenishment_orders')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (!error) await loadOrders()
    return { data: data as StoreReplenishmentOrder | null, error }
  }

  async function loadReceivingSessions() {
    if (!wsId()) return
    const { data, error } = await client
      .from('receiving_sessions')
      .select('*')
      .eq('workspace_id', wsId()!)
      .order('created_at', { ascending: false })
    if (!error) receivingSessions.value = (data || []) as ReceivingSession[]
    return { data, error }
  }

  async function createReceivingSession(
    session: ReceivingSessionInput,
    lines: ReceivingSessionLineInput[],
  ) {
    if (!wsId()) throw new Error('No workspace selected')
    const { data, error } = await client
      .from('receiving_sessions')
      .insert({
        workspace_id: wsId()!,
        session_number: session.session_number || newNumber('RCV'),
        receipt_type: session.receipt_type || 'store_replenishment',
        status: session.status || 'submitted',
        idempotency_key: session.idempotency_key || null,
        replenishment_order_id: session.replenishment_order_id || null,
        transfer_id: session.transfer_id || null,
        purchase_order_id: session.purchase_order_id || null,
        pos_location_id: session.pos_location_id || null,
        inventory_location_id: session.inventory_location_id || null,
        source_ref: session.source_ref || null,
        received_at: session.received_at || new Date().toISOString(),
        submitted_at: new Date().toISOString(),
        metadata: session.metadata || {},
      })
      .select()
      .single()

    if (error) return { data: null, error }

    const lineRows = lines.map(line => ({
      workspace_id: wsId()!,
      session_id: data.id,
      replenishment_order_line_id: line.replenishment_order_line_id || null,
      product_identity_id: line.product_identity_id || null,
      trade_unit_id: line.trade_unit_id || null,
      listing_id: line.listing_id || null,
      channel_id: line.channel_id || null,
      sku_assignment_id: line.sku_assignment_id || null,
      identifier_id: line.identifier_id || null,
      product_id: line.product_id || null,
      variant_id: line.variant_id || null,
      sku: line.sku || null,
      expected_qty: Math.max(0, Math.floor(Number(line.expected_qty || 0))),
      received_qty: Math.max(0, Math.floor(Number(line.received_qty || 0))),
      damaged_qty: Math.max(0, Math.floor(Number(line.damaged_qty || 0))),
      overage_qty: Math.max(0, Math.floor(Number(line.overage_qty || 0))),
      short_qty: Math.max(0, Math.floor(Number(line.short_qty || 0))),
      exception_type: line.exception_type || null,
      status: line.status || (line.exception_type ? 'exception' : 'matched'),
      metadata: line.metadata || {},
    }))

    if (lineRows.length) {
      const { error: lineError } = await client.from('receiving_session_lines').insert(lineRows)
      if (lineError) return { data: null, error: lineError }
    }

    await loadReceivingSessions()
    return { data: data as ReceivingSession, error: null }
  }

  async function loadExceptions() {
    if (!wsId()) return
    const { data, error } = await client
      .from('inventory_exceptions')
      .select('*')
      .eq('workspace_id', wsId()!)
      .order('created_at', { ascending: false })
    if (!error) exceptions.value = (data || []) as InventoryException[]
    return { data, error }
  }

  async function createInventoryException(exception: InventoryExceptionInput) {
    if (!wsId()) throw new Error('No workspace selected')
    const { data, error } = await client
      .from('inventory_exceptions')
      .insert({
        workspace_id: wsId()!,
        exception_type: exception.exception_type || 'other',
        severity: exception.severity || 'medium',
        status: exception.status || 'open',
        source_type: exception.source_type || 'manual',
        source_id: exception.source_id || null,
        pos_location_id: exception.pos_location_id || null,
        inventory_location_id: exception.inventory_location_id || null,
        connection_id: exception.connection_id || null,
        product_identity_id: exception.product_identity_id || null,
        trade_unit_id: exception.trade_unit_id || null,
        listing_id: exception.listing_id || null,
        channel_id: exception.channel_id || null,
        sku_assignment_id: exception.sku_assignment_id || null,
        identifier_id: exception.identifier_id || null,
        product_id: exception.product_id || null,
        variant_id: exception.variant_id || null,
        sku: exception.sku || null,
        expected_qty: exception.expected_qty ?? null,
        actual_qty: exception.actual_qty ?? null,
        title: exception.title,
        summary: exception.summary || null,
        evidence: exception.evidence || {},
        resolution: exception.resolution || {},
      })
      .select()
      .single()
    if (!error) await loadExceptions()
    return { data: data as InventoryException | null, error }
  }

  async function updateExceptionStatus(id: string, status: InventoryExceptionStatus, resolution?: Record<string, any>) {
    const resolved = status === 'resolved' || status === 'dismissed'
    const { data, error } = await client
      .from('inventory_exceptions')
      .update({
        status,
        resolution: resolution || {},
        resolved_at: resolved ? new Date().toISOString() : null,
      })
      .eq('id', id)
      .select()
      .single()
    if (!error) await loadExceptions()
    return { data: data as InventoryException | null, error }
  }

  async function loadStoreOperations() {
    loading.value = true
    await Promise.all([loadRequests(), loadOrders(), loadReceivingSessions(), loadExceptions()])
    loading.value = false
  }

  function priorityBadge(priority: StoreOpsPriority) {
    const map: Record<string, { label: string; cls: string }> = {
      low: { label: 'Low', cls: 'bg-gray-500/10 text-gray-400' },
      normal: { label: 'Normal', cls: 'bg-blue-500/10 text-blue-300' },
      urgent: { label: 'Urgent', cls: 'bg-amber-500/10 text-amber-300' },
      critical: { label: 'Critical', cls: 'bg-red-500/10 text-red-300' },
    }
    return map[priority] ?? map.normal
  }

  function requestStatusBadge(status: StoreReplenishmentRequestStatus) {
    const map: Record<string, { label: string; cls: string }> = {
      draft: { label: 'Draft', cls: 'bg-gray-500/10 text-gray-400' },
      submitted: { label: 'Submitted', cls: 'bg-blue-500/10 text-blue-300' },
      in_review: { label: 'In review', cls: 'bg-amber-500/10 text-amber-300' },
      approved: { label: 'Approved', cls: 'bg-emerald-500/10 text-emerald-300' },
      rejected: { label: 'Rejected', cls: 'bg-red-500/10 text-red-300' },
      converted: { label: 'Converted', cls: 'bg-cyan-500/10 text-cyan-300' },
      cancelled: { label: 'Cancelled', cls: 'bg-gray-500/10 text-gray-400' },
    }
    return map[status] ?? map.submitted
  }

  function orderStatusBadge(status: StoreReplenishmentOrderStatus) {
    const map: Record<string, { label: string; cls: string }> = {
      draft: { label: 'Draft', cls: 'bg-gray-500/10 text-gray-400' },
      approved: { label: 'Approved', cls: 'bg-emerald-500/10 text-emerald-300' },
      queued: { label: 'Queued', cls: 'bg-blue-500/10 text-blue-300' },
      sent_to_3pl: { label: 'Sent to 3PL', cls: 'bg-cyan-500/10 text-cyan-300' },
      acknowledged: { label: 'Acknowledged', cls: 'bg-indigo-500/10 text-indigo-300' },
      partially_shipped: { label: 'Partial ship', cls: 'bg-amber-500/10 text-amber-300' },
      shipped: { label: 'Shipped', cls: 'bg-amber-500/10 text-amber-300' },
      partially_received: { label: 'Partial receipt', cls: 'bg-orange-500/10 text-orange-300' },
      received: { label: 'Received', cls: 'bg-emerald-500/10 text-emerald-300' },
      exception: { label: 'Exception', cls: 'bg-red-500/10 text-red-300' },
      cancelled: { label: 'Cancelled', cls: 'bg-gray-500/10 text-gray-400' },
      failed: { label: 'Failed', cls: 'bg-red-500/10 text-red-300' },
    }
    return map[status] ?? map.draft
  }

  function exceptionStatusBadge(status: InventoryExceptionStatus) {
    const map: Record<string, { label: string; cls: string }> = {
      open: { label: 'Open', cls: 'bg-red-500/10 text-red-300' },
      in_review: { label: 'In review', cls: 'bg-amber-500/10 text-amber-300' },
      resolved: { label: 'Resolved', cls: 'bg-emerald-500/10 text-emerald-300' },
      dismissed: { label: 'Dismissed', cls: 'bg-gray-500/10 text-gray-400' },
      escalated: { label: 'Escalated', cls: 'bg-purple-500/10 text-purple-300' },
    }
    return map[status] ?? map.open
  }

  return {
    requests,
    orders,
    receivingSessions,
    exceptions,
    loading,
    loadStoreOperations,
    loadRequests,
    loadRequestLines,
    createReplenishmentRequest,
    updateReplenishmentRequestStatus,
    loadOrders,
    loadOrderLines,
    createReplenishmentOrder,
    updateReplenishmentOrderStatus,
    loadReceivingSessions,
    createReceivingSession,
    loadExceptions,
    createInventoryException,
    updateExceptionStatus,
    priorityBadge,
    requestStatusBadge,
    orderStatusBadge,
    exceptionStatusBadge,
  }
}
