<script setup lang="ts">
import type { InventoryLocation } from '~/composables/useInventory'
import type {
  InventoryException,
  InventoryExceptionSeverity,
  InventoryExceptionSourceType,
  InventoryExceptionStatus,
  InventoryExceptionType,
  PosLocation,
  ReceivingLineExceptionType,
  StoreOpsPriority,
  StoreReplenishmentOrder,
  StoreReplenishmentOrderStatus,
  StoreReplenishmentRequest,
  StoreReplenishmentRequestStatus,
  StoreReplenishmentRequestType,
} from '~/types'

const client = useSupabaseClient()
const { currentWorkspace } = useWorkspace()
const { locations, loadLocations } = useInventory()
const { setContext, clearContext } = useAssistant()

const {
  requests,
  orders,
  receivingSessions,
  exceptions,
  loading,
  loadStoreOperations,
  loadRequestLines,
  createReplenishmentRequest,
  updateReplenishmentRequestStatus,
  createReplenishmentOrder,
  updateReplenishmentOrderStatus,
  createReceivingSession,
  createInventoryException,
  updateExceptionStatus,
  priorityBadge,
  requestStatusBadge,
  orderStatusBadge,
  exceptionStatusBadge,
} = useStoreOperations()

const activeTab = ref<'queue' | 'orders' | 'inbound' | 'receiving' | 'exceptions' | 'floor' | 'waves'>('queue')
const tabs = [
  { key: 'queue', label: 'Queue' },
  { key: 'orders', label: 'Orders' },
  { key: 'waves', label: 'Waves & calendar' },
  { key: 'inbound', label: 'Inbound ASN' },
  { key: 'receiving', label: 'Receiving' },
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'floor', label: 'Floor adjustments' },
] as const

const waveBundle = ref<{ upcoming: any[]; waves: any[]; cadence_note?: string } | null>(null)
const storeSettings = ref<any>(null)
const deliveryCalendars = ref<any[]>([])
const allocationPreview = ref<any>(null)
const wavesLoading = ref(false)
const wavesSaving = ref(false)
const calendarForm = ref({
  inventory_location_id: '',
  pos_location_id: '',
  preferred_delivery_mode: 'delivery' as 'delivery' | 'self_collect',
  receive_window_start: '08:00',
  receive_window_end: '10:00',
  notes: '',
})

async function loadWavesAndCalendar() {
  if (!currentWorkspace.value?.id) return
  wavesLoading.value = true
  try {
    const [wavesRes, settingsRes, calRes] = await Promise.allSettled([
      $fetch<{ upcoming: any[]; waves: any[]; cadence_note?: string }>('/api/store-ops/waves', {
        query: { workspace_id: currentWorkspace.value.id, ensure: '1', count: 6 },
      }),
      $fetch<{ data: any }>('/api/store-ops/settings', {
        query: { workspace_id: currentWorkspace.value.id },
      }),
      $fetch<{ data: any[] }>('/api/store-ops/delivery-calendars', {
        query: { workspace_id: currentWorkspace.value.id },
      }),
    ])
    if (wavesRes.status === 'fulfilled') waveBundle.value = wavesRes.value
    if (settingsRes.status === 'fulfilled') storeSettings.value = settingsRes.value.data
    if (calRes.status === 'fulfilled') deliveryCalendars.value = calRes.value.data || []

    const firstFail = [wavesRes, settingsRes, calRes].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    if (firstFail) {
      const e = firstFail.reason as any
      // Soft-fail: do not block Queue / New Request if waves APIs error
      console.warn('[store-ops] waves/calendar load failed', e?.data || e?.message || e)
    }
  } catch (e: any) {
    console.warn('[store-ops] waves/calendar unexpected', e)
  } finally {
    wavesLoading.value = false
  }
}

async function saveSettings() {
  if (!currentWorkspace.value?.id || !storeSettings.value) return
  wavesSaving.value = true
  try {
    const res = await $fetch<{ data: any }>('/api/store-ops/settings', {
      method: 'PUT',
      body: {
        workspace_id: currentWorkspace.value.id,
        wave_weekdays: storeSettings.value.wave_weekdays,
        default_delivery_mode: storeSettings.value.default_delivery_mode,
        wave_cutoff_hour_local: storeSettings.value.wave_cutoff_hour_local,
        default_receive_by_local: storeSettings.value.default_receive_by_local,
        wave_include_cutoff_hours: storeSettings.value.wave_include_cutoff_hours,
      },
    })
    storeSettings.value = res.data
    showOk('Wave / delivery settings saved')
    await loadWavesAndCalendar()
  } catch (e: any) {
    showErr(e?.data?.statusMessage || e?.message || 'Save settings failed')
  } finally {
    wavesSaving.value = false
  }
}

async function saveCalendar() {
  if (!currentWorkspace.value?.id || !calendarForm.value.inventory_location_id) {
    return showErr('Pick a store inventory location')
  }
  wavesSaving.value = true
  try {
    await $fetch('/api/store-ops/delivery-calendars', {
      method: 'POST',
      body: {
        workspace_id: currentWorkspace.value.id,
        inventory_location_id: calendarForm.value.inventory_location_id,
        pos_location_id: calendarForm.value.pos_location_id || null,
        preferred_delivery_mode: calendarForm.value.preferred_delivery_mode,
        receive_window_start: calendarForm.value.receive_window_start || null,
        receive_window_end: calendarForm.value.receive_window_end || null,
        notes: calendarForm.value.notes || null,
      },
    })
    showOk('Store delivery calendar saved')
    await loadWavesAndCalendar()
  } catch (e: any) {
    showErr(e?.data?.statusMessage || e?.message || 'Save calendar failed')
  } finally {
    wavesSaving.value = false
  }
}

async function runAllocationPreview(waveId: string, persist = false) {
  if (!currentWorkspace.value?.id) return
  wavesSaving.value = true
  try {
    const res = await $fetch<any>(`/api/store-ops/waves/${waveId}/preview-allocation`, {
      method: 'POST',
      body: { workspace_id: currentWorkspace.value.id, persist },
    })
    allocationPreview.value = res.preview || res
    showOk(persist ? 'Allocation draft saved' : 'Allocation preview ready')
  } catch (e: any) {
    showErr(e?.data?.statusMessage || e?.message || 'Allocation preview failed')
  } finally {
    wavesSaving.value = false
  }
}

function onWaveWeekdaysInput(e: Event) {
  if (!storeSettings.value) return
  const raw = String((e.target as HTMLInputElement).value || '')
  storeSettings.value.wave_weekdays = raw
    .split(/[,\s]+/)
    .map(Number)
    .filter((n) => n >= 1 && n <= 7)
}

const pendingAdjustments = ref<any[]>([])
const floorLoading = ref(false)
const floorActing = ref<string | null>(null)

async function loadFloorAdjustments() {
  if (!currentWorkspace.value?.id) return
  floorLoading.value = true
  try {
    const res = await $fetch<{ data: any[] }>('/api/store-ops/adjustments', {
      query: { workspace_id: currentWorkspace.value.id, status: 'pending,approved', limit: 50 },
    })
    pendingAdjustments.value = res.data || []
  } catch (e: any) {
    showErr(e?.data?.statusMessage || e?.message || 'Failed to load floor adjustments')
  } finally {
    floorLoading.value = false
  }
}

async function applyAdjustment(adj: any) {
  if (!currentWorkspace.value?.id) return
  floorActing.value = adj.id
  try {
    await $fetch(`/api/store-ops/adjustments/${adj.id}/apply`, {
      method: 'POST',
      body: { workspace_id: currentWorkspace.value.id },
    })
    showOk(`Applied ${adj.adjustment_number} → inventory ledger`)
    await loadFloorAdjustments()
    await loadStoreOperations()
  } catch (e: any) {
    showErr(e?.data?.statusMessage || e?.message || 'Apply failed')
  } finally {
    floorActing.value = null
  }
}

async function rejectAdjustment(adj: any) {
  if (!currentWorkspace.value?.id) return
  floorActing.value = adj.id
  try {
    await $fetch(`/api/store-ops/adjustments/${adj.id}/reject`, {
      method: 'POST',
      body: { workspace_id: currentWorkspace.value.id, note: 'Rejected from Store Ops floor queue' },
    })
    showOk(`Rejected ${adj.adjustment_number}`)
    await loadFloorAdjustments()
  } catch (e: any) {
    showErr(e?.data?.statusMessage || e?.message || 'Reject failed')
  } finally {
    floorActing.value = null
  }
}

function adjustmentVariance(adj: any) {
  const lines = Array.isArray(adj.lines) ? adj.lines : []
  return lines.reduce((sum: number, line: any) => {
    const sys = line.system_qty == null ? 0 : Number(line.system_qty)
    return sum + (Number(line.counted_qty || 0) - sys)
  }, 0)
}

const inboundShipments = ref<any[]>([])
const inboundLoading = ref(false)
const inboundSaving = ref(false)
const showInboundForm = ref(false)
const inboundForm = ref({
  tracking_number: '',
  date_estimate: '',
  reference_no: '',
  offshore_forwarder: '',
  palletization: 'mixed' as string,
  carton_count: '',
  pallet_count: '',
  notes: '',
  connection_id: '',
})
const inboundLines = ref<Array<{ sku: string; quantity: number; product_name: string }>>([
  { sku: '', quantity: 1, product_name: '' },
])

async function loadInbound() {
  if (!currentWorkspace.value?.id) return
  inboundLoading.value = true
  try {
    const res = await $fetch<{ data: any[] }>('/api/store-ops/inbound', {
      query: { workspace_id: currentWorkspace.value.id, limit: 50 },
    })
    inboundShipments.value = res.data || []
  } catch (e: any) {
    showErr(e?.data?.statusMessage || e?.message || 'Failed to load inbound')
  } finally {
    inboundLoading.value = false
  }
}

async function createInboundAsn() {
  if (!currentWorkspace.value?.id) return
  const lines = inboundLines.value.filter(l => l.sku.trim() && l.quantity > 0)
  if (!inboundForm.value.tracking_number || !inboundForm.value.date_estimate || !lines.length) {
    return showErr('Tracking, ETA, and at least one line required')
  }
  inboundSaving.value = true
  try {
    await $fetch('/api/store-ops/inbound', {
      method: 'POST',
      body: {
        workspace_id: currentWorkspace.value.id,
        tracking_number: inboundForm.value.tracking_number,
        date_estimate: inboundForm.value.date_estimate,
        reference_no: inboundForm.value.reference_no || null,
        offshore_forwarder: inboundForm.value.offshore_forwarder || null,
        local_forwarder: 'M&P',
        palletization: inboundForm.value.palletization || null,
        carton_count: inboundForm.value.carton_count ? Number(inboundForm.value.carton_count) : null,
        pallet_count: inboundForm.value.pallet_count ? Number(inboundForm.value.pallet_count) : null,
        notes: inboundForm.value.notes || null,
        connection_id: inboundForm.value.connection_id || null,
        lines,
      },
    })
    showOk('ASN draft created (not sent to Loft yet)')
    showInboundForm.value = false
    inboundForm.value = {
      tracking_number: '',
      date_estimate: '',
      reference_no: '',
      offshore_forwarder: '',
      palletization: 'mixed',
      carton_count: '',
      pallet_count: '',
      notes: '',
      connection_id: '',
    }
    inboundLines.value = [{ sku: '', quantity: 1, product_name: '' }]
    await loadInbound()
  } catch (e: any) {
    showErr(e?.data?.statusMessage || e?.message || 'Create ASN failed')
  } finally {
    inboundSaving.value = false
  }
}

async function confirmInbound(shipment: any) {
  if (!currentWorkspace.value?.id) return
  try {
    const res = await $fetch<{ message?: string }>(`/api/store-ops/inbound/${shipment.id}/confirm`, {
      method: 'POST',
      body: {
        workspace_id: currentWorkspace.value.id,
        force: true,
        line_updates: (shipment.lines || []).map((l: any) => ({
          line_id: l.id,
          quantity_received: l.quantity_received > 0 ? l.quantity_received : l.quantity,
        })),
      },
    })
    showOk(res.message || 'Confirmed and promoted to LOFT-SG')
    await loadInbound()
  } catch (e: any) {
    showErr(e?.data?.statusMessage || e?.message || 'Confirm failed')
  }
}

const toast = ref('')
const toastError = ref('')
function showOk(message: string) {
  toast.value = message
  toastError.value = ''
  setTimeout(() => (toast.value = ''), 3500)
}
function showErr(message: string) {
  toastError.value = message
  toast.value = ''
}

const posLocations = ref<PosLocation[]>([])

async function loadPosLocations() {
  if (!currentWorkspace.value?.id) return
  const { data, error } = await client
    .from('pos_locations')
    .select('*')
    .eq('workspace_id', currentWorkspace.value.id)
    .eq('is_active', true)
    .order('name')

  if (error) {
    showErr(error.message)
    return
  }
  posLocations.value = (data || []) as PosLocation[]
}

async function refreshAll() {
  await Promise.all([
    loadLocations(),
    loadPosLocations(),
    loadStoreOperations(),
    loadInbound(),
    loadFloorAdjustments(),
    loadWavesAndCalendar(),
  ])
  setContext(
    'store_ops',
    currentWorkspace.value?.id || 'store-ops',
    {
      openRequests: queueRequests.value.length,
      activeOrders: activeOrders.value.length,
      openExceptions: openExceptions.value.length,
      pendingAdjustments: pendingAdjustments.value.length,
    },
    'Store Ops',
  )
}

const sourceLocations = computed(() =>
  locations.value.filter(location => ['3pl', 'warehouse'].includes(location.location_type)),
)

const storeLocations = computed(() =>
  locations.value.filter(location => ['store', 'warehouse', '3pl'].includes(location.location_type)),
)

const defaultSourceLocation = computed(() =>
  sourceLocations.value.find(location => location.location_type === '3pl') ||
  sourceLocations.value.find(location => location.location_type === 'warehouse') ||
  null,
)

const defaultStoreLocation = computed(() =>
  storeLocations.value.find(location => location.location_type === 'store') ||
  storeLocations.value[0] ||
  null,
)

const queueRequests = computed(() =>
  requests.value.filter(request =>
    ['submitted', 'in_review', 'approved', 'deferred_to_wave'].includes(request.status),
  ),
)

const decideSaving = ref<string | null>(null)

async function decideRequest(
  request: StoreReplenishmentRequest,
  decision: 'approve_now' | 'reject' | 'defer_to_wave',
) {
  if (!currentWorkspace.value?.id) return
  decideSaving.value = request.id
  try {
    await $fetch(`/api/store-ops/requests/${request.id}/decide`, {
      method: 'POST',
      body: {
        workspace_id: currentWorkspace.value.id,
        decision,
        decision_reason: decision === 'defer_to_wave'
          ? 'Deferred to next Mon/Thu wave'
          : decision === 'approve_now'
            ? 'HQ approved for lift now'
            : 'HQ rejected',
      },
    })
    showOk(
      decision === 'approve_now'
        ? 'Approved — order created (send to Loft is a separate step)'
        : decision === 'defer_to_wave'
          ? 'Deferred to Mon/Thu wave'
          : 'Request rejected',
    )
    await loadStoreOperations()
  } catch (e: any) {
    showErr(e?.data?.statusMessage || e?.message || 'Decision failed')
  } finally {
    decideSaving.value = null
  }
}

async function verifyException(
  exception: InventoryException,
  action: 'confirm' | 'reject' | 'escalate',
) {
  if (!currentWorkspace.value?.id) return
  try {
    await $fetch(`/api/store-ops/exceptions/${exception.id}/verify`, {
      method: 'POST',
      body: {
        workspace_id: currentWorkspace.value.id,
        action,
        note: action === 'escalate' ? 'Escalated to Loft ops' : null,
      },
    })
    showOk(
      action === 'confirm'
        ? 'POS claim confirmed'
        : action === 'escalate'
          ? 'Escalated'
          : 'POS claim rejected',
    )
    await loadStoreOperations()
  } catch (e: any) {
    showErr(e?.data?.statusMessage || e?.message || 'Verify failed')
  }
}

const activeOrders = computed(() =>
  orders.value.filter(order => !['received', 'cancelled', 'failed'].includes(order.status)),
)

const openExceptions = computed(() =>
  exceptions.value.filter(exception => ['open', 'in_review', 'escalated'].includes(exception.status)),
)

const stats = computed(() => [
  { label: 'Open requests', value: queueRequests.value.length, sub: 'Store replenishment asks' },
  { label: 'Active orders', value: activeOrders.value.length, sub: 'Awaiting 3PL or receipt' },
  {
    label: 'Pending receipts',
    value: orders.value.filter(order => ['shipped', 'partially_received'].includes(order.status)).length,
    sub: 'Needs store confirmation',
  },
  {
    label: 'Floor adjustments',
    value: pendingAdjustments.value.length,
    sub: 'Damage / found / count → ledger',
  },
])

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function locationLabel(location: InventoryLocation) {
  return `${location.name} (${location.code})`
}

function posLocationLabel(location: PosLocation) {
  return `${location.name} (${location.code})`
}

function qtyLabel(value: number | null | undefined) {
  return Number(value || 0).toLocaleString()
}

const requestSaving = ref(false)
const showRequestForm = ref(false)
const requestForm = ref({
  request_type: 'manual' as StoreReplenishmentRequestType,
  priority: 'normal' as StoreOpsPriority,
  pos_location_id: '',
  store_location_id: '',
  needed_by: '',
  reason: '',
})
const requestLines = ref<Array<{ sku: string; requested_qty: number; reason: string }>>([
  { sku: '', requested_qty: 1, reason: '' },
])

function addRequestLine() {
  requestLines.value.push({ sku: '', requested_qty: 1, reason: '' })
}

function removeRequestLine(index: number) {
  requestLines.value.splice(index, 1)
  if (!requestLines.value.length) addRequestLine()
}

function resetRequestForm() {
  requestForm.value = {
    request_type: 'manual',
    priority: 'normal',
    pos_location_id: '',
    store_location_id: '',
    needed_by: '',
    reason: '',
  }
  requestLines.value = [{ sku: '', requested_qty: 1, reason: '' }]
}

async function handleCreateRequest() {
  if (!currentWorkspace.value?.id) return showErr('No workspace selected')
  const validLines = requestLines.value.filter(line => line.sku.trim() && Number(line.requested_qty) > 0)
  if (!validLines.length) return showErr('Add at least one SKU line')

  requestSaving.value = true
  try {
    // Server API: scope-checked + service-role write (avoids RLS RETURNING failures)
    await $fetch('/api/store-ops/requests', {
      method: 'POST',
      body: {
        workspace_id: currentWorkspace.value.id,
        request_type: requestForm.value.request_type,
        priority: requestForm.value.priority,
        source_type: 'skums',
        pos_location_id: requestForm.value.pos_location_id || null,
        store_location_id: requestForm.value.store_location_id || defaultStoreLocation.value?.id || null,
        needed_by: requestForm.value.needed_by || null,
        reason: requestForm.value.reason || null,
        metadata: { entry_surface: 'store_ops' },
        lines: validLines.map(line => ({
          sku: line.sku.trim(),
          requested_qty: Number(line.requested_qty),
          reason: line.reason || null,
        })),
      },
    })
    showOk('Request submitted to HQ queue (not sent to Loft)')
    showRequestForm.value = false
    resetRequestForm()
    await loadStoreOperations()
  } catch (e: any) {
    const msg =
      e?.data?.statusMessage
      || e?.data?.message
      || e?.statusMessage
      || e?.message
      || 'Failed to create request'
    showErr(msg)
  } finally {
    requestSaving.value = false
  }
}

async function setRequestStatus(request: StoreReplenishmentRequest, status: StoreReplenishmentRequestStatus) {
  const { error } = await updateReplenishmentRequestStatus(request.id, status)
  if (error) showErr(error.message)
  else showOk(`Request ${status.replace('_', ' ')}`)
}

async function convertRequestToOrder(request: StoreReplenishmentRequest) {
  const { data: lines, error: lineError } = await loadRequestLines(request.id)
  if (lineError) return showErr(lineError.message)
  if (!lines.length) return showErr('Request has no lines')

  const { error } = await createReplenishmentOrder(
    {
      request_id: request.id,
      status: 'approved',
      priority: request.priority,
      source_location_id: defaultSourceLocation.value?.id || null,
      destination_location_id: request.store_location_id || defaultStoreLocation.value?.id || null,
      pos_location_id: request.pos_location_id,
      metadata: { created_from: 'store_replenishment_request', request_number: request.request_number },
    },
    lines.map(line => ({
      product_identity_id: line.product_identity_id,
      trade_unit_id: line.trade_unit_id,
      listing_id: line.listing_id,
      channel_id: line.channel_id,
      sku_assignment_id: line.sku_assignment_id,
      identifier_id: line.identifier_id,
      product_id: line.product_id,
      variant_id: line.variant_id,
      sku: line.sku,
      requested_qty: line.requested_qty,
      approved_qty: line.approved_qty ?? line.requested_qty,
      metadata: line.metadata,
    })),
  )

  if (error) return showErr(error.message)
  showOk('Replenishment order created')
}

async function setOrderStatus(order: StoreReplenishmentOrder, status: StoreReplenishmentOrderStatus) {
  const { error } = await updateReplenishmentOrderStatus(order.id, status)
  if (error) showErr(error.message)
  else showOk(`Order ${status.replaceAll('_', ' ')}`)
}

const receivingSaving = ref(false)
const showReceivingForm = ref(false)
const receivingForm = ref({
  replenishment_order_id: '',
  pos_location_id: '',
  inventory_location_id: '',
  source_ref: '',
})

type ReceiptLineDraft = {
  sku: string
  expected_qty: number
  received_qty: number
  damaged_qty: number
  short_qty: number
  overage_qty: number
  exception_type: ReceivingLineExceptionType | ''
}

const receiptLines = ref<ReceiptLineDraft[]>([
  { sku: '', expected_qty: 0, received_qty: 0, damaged_qty: 0, short_qty: 0, overage_qty: 0, exception_type: '' },
])

const selectedReceivingOrder = computed(() =>
  orders.value.find(order => order.id === receivingForm.value.replenishment_order_id) || null,
)

watch(selectedReceivingOrder, (order) => {
  if (!order) return
  receivingForm.value.pos_location_id = order.pos_location_id || ''
  receivingForm.value.inventory_location_id = order.destination_location_id || ''
})

function addReceiptLine() {
  receiptLines.value.push({
    sku: '',
    expected_qty: 0,
    received_qty: 0,
    damaged_qty: 0,
    short_qty: 0,
    overage_qty: 0,
    exception_type: '',
  })
}

function removeReceiptLine(index: number) {
  receiptLines.value.splice(index, 1)
  if (!receiptLines.value.length) addReceiptLine()
}

function resetReceivingForm() {
  receivingForm.value = {
    replenishment_order_id: '',
    pos_location_id: '',
    inventory_location_id: '',
    source_ref: '',
  }
  receiptLines.value = [
    { sku: '', expected_qty: 0, received_qty: 0, damaged_qty: 0, short_qty: 0, overage_qty: 0, exception_type: '' },
  ]
}

async function handleCreateReceivingSession() {
  const validLines = receiptLines.value.filter(line =>
    line.sku.trim() ||
    Number(line.expected_qty) > 0 ||
    Number(line.received_qty) > 0 ||
    Number(line.damaged_qty) > 0 ||
    Number(line.short_qty) > 0 ||
    Number(line.overage_qty) > 0,
  )
  if (!validLines.length) return showErr('Add at least one receipt line')

  receivingSaving.value = true
  const { error } = await createReceivingSession(
    {
      status: validLines.some(line => line.exception_type || Number(line.damaged_qty) > 0 || Number(line.short_qty) > 0 || Number(line.overage_qty) > 0)
        ? 'exception'
        : 'submitted',
      replenishment_order_id: receivingForm.value.replenishment_order_id || null,
      pos_location_id: receivingForm.value.pos_location_id || null,
      inventory_location_id: receivingForm.value.inventory_location_id || null,
      source_ref: receivingForm.value.source_ref || null,
      metadata: { entry_surface: 'store_ops' },
    },
    validLines.map(line => {
      const hasException = line.exception_type || Number(line.damaged_qty) > 0 || Number(line.short_qty) > 0 || Number(line.overage_qty) > 0
      return {
        sku: line.sku.trim() || null,
        expected_qty: Number(line.expected_qty || 0),
        received_qty: Number(line.received_qty || 0),
        damaged_qty: Number(line.damaged_qty || 0),
        short_qty: Number(line.short_qty || 0),
        overage_qty: Number(line.overage_qty || 0),
        exception_type: line.exception_type || null,
        status: hasException ? 'exception' : 'matched',
      }
    }),
  )
  receivingSaving.value = false

  if (error) return showErr(error.message)
  if (receivingForm.value.replenishment_order_id) {
    await updateReplenishmentOrderStatus(receivingForm.value.replenishment_order_id, 'partially_received')
  }
  showOk('Receiving session recorded')
  showReceivingForm.value = false
  resetReceivingForm()
}

const exceptionSaving = ref(false)
const showExceptionForm = ref(false)
const exceptionForm = ref({
  exception_type: 'stock_variance' as InventoryExceptionType,
  severity: 'medium' as InventoryExceptionSeverity,
  source_type: 'manual' as InventoryExceptionSourceType,
  title: '',
  summary: '',
  sku: '',
  expected_qty: null as number | null,
  actual_qty: null as number | null,
  pos_location_id: '',
  inventory_location_id: '',
})

function resetExceptionForm() {
  exceptionForm.value = {
    exception_type: 'stock_variance',
    severity: 'medium',
    source_type: 'manual',
    title: '',
    summary: '',
    sku: '',
    expected_qty: null,
    actual_qty: null,
    pos_location_id: '',
    inventory_location_id: '',
  }
}

async function handleCreateException() {
  if (!exceptionForm.value.title.trim()) return showErr('Title is required')

  exceptionSaving.value = true
  const { error } = await createInventoryException({
    exception_type: exceptionForm.value.exception_type,
    severity: exceptionForm.value.severity,
    source_type: exceptionForm.value.source_type,
    title: exceptionForm.value.title.trim(),
    summary: exceptionForm.value.summary || null,
    sku: exceptionForm.value.sku || null,
    expected_qty: exceptionForm.value.expected_qty,
    actual_qty: exceptionForm.value.actual_qty,
    pos_location_id: exceptionForm.value.pos_location_id || null,
    inventory_location_id: exceptionForm.value.inventory_location_id || null,
    evidence: { entry_surface: 'store_ops' },
  })
  exceptionSaving.value = false

  if (error) return showErr(error.message)
  showOk('Exception logged')
  showExceptionForm.value = false
  resetExceptionForm()
}

async function setExceptionStatus(exception: InventoryException, status: InventoryExceptionStatus) {
  const { error } = await updateExceptionStatus(exception.id, status, {
    updated_from: 'store_ops',
    status,
  })
  if (error) showErr(error.message)
  else showOk(`Exception ${status.replace('_', ' ')}`)
}

onMounted(refreshAll)
onUnmounted(() => clearContext())

watch(() => currentWorkspace.value?.id, refreshAll)
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-white">Store Ops</h1>
        <p class="mt-1 text-sm text-gray-400">Replenishment, receiving, and inventory exceptions across POS, SKUMS, and fulfillment partners.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-secondary" :disabled="loading" @click="refreshAll">
          Refresh
        </button>
        <button class="btn-primary" @click="showRequestForm = !showRequestForm">
          New Request
        </button>
      </div>
    </div>

    <div v-if="toast" class="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">{{ toast }}</div>
    <div v-if="toastError" class="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{{ toastError }}</div>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="item in stats" :key="item.label" class="card p-4">
        <p class="text-xs font-medium uppercase text-gray-500">{{ item.label }}</p>
        <p class="mt-2 text-2xl font-bold text-white">{{ item.value }}</p>
        <p class="mt-1 text-xs text-gray-500">{{ item.sub }}</p>
      </div>
    </div>

    <div class="flex gap-1 rounded-lg border border-gray-800 bg-gray-900 p-1">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :class="[
          'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all',
          activeTab === tab.key ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white',
        ]"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <form v-if="showRequestForm" class="card space-y-4 p-5" @submit.prevent="handleCreateRequest">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h2 class="text-base font-semibold text-white">Replenishment request</h2>
          <p class="text-sm text-gray-400">Create a SKUMS-side request for store stock movement.</p>
        </div>
        <button type="button" class="text-sm text-gray-400 hover:text-white" @click="showRequestForm = false">
          Close
        </button>
      </div>

      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label>
          <span class="label-field">Request type</span>
          <select v-model="requestForm.request_type" class="input-field">
            <option value="manual">Manual</option>
            <option value="low_stock">Low stock</option>
            <option value="cycle_count">Cycle count</option>
            <option value="campaign">Campaign</option>
            <option value="system_suggested">System suggested</option>
            <option value="pos_requested">POS requested</option>
          </select>
        </label>
        <label>
          <span class="label-field">Priority</span>
          <select v-model="requestForm.priority" class="input-field">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label>
          <span class="label-field">POS store</span>
          <select v-model="requestForm.pos_location_id" class="input-field">
            <option value="">Unassigned</option>
            <option v-for="location in posLocations" :key="location.id" :value="location.id">
              {{ posLocationLabel(location) }}
            </option>
          </select>
        </label>
        <label>
          <span class="label-field">Inventory location</span>
          <select v-model="requestForm.store_location_id" class="input-field">
            <option value="">Default store</option>
            <option v-for="location in storeLocations" :key="location.id" :value="location.id">
              {{ locationLabel(location) }}
            </option>
          </select>
        </label>
        <label>
          <span class="label-field">Needed by</span>
          <input v-model="requestForm.needed_by" type="date" class="input-field" />
        </label>
        <label class="md:col-span-2 xl:col-span-3">
          <span class="label-field">Reason</span>
          <input v-model="requestForm.reason" class="input-field" placeholder="Campaign, shelf gap, count variance" />
        </label>
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <span class="label-field mb-0">Lines</span>
          <button type="button" class="text-sm text-indigo-400 hover:text-indigo-300" @click="addRequestLine">
            Add line
          </button>
        </div>
        <div
          v-for="(line, index) in requestLines"
          :key="index"
          class="grid gap-3 rounded-lg border border-gray-800 bg-gray-950/40 p-3 md:grid-cols-[1fr_120px_1fr_auto]"
        >
          <input v-model="line.sku" class="input-field font-mono text-sm" placeholder="SKU / barcode" />
          <input v-model.number="line.requested_qty" type="number" min="1" class="input-field" />
          <input v-model="line.reason" class="input-field" placeholder="Line reason" />
          <button type="button" class="rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white" @click="removeRequestLine(index)">
            Remove
          </button>
        </div>
      </div>

      <div class="flex justify-end">
        <button class="btn-primary" :disabled="requestSaving">
          Create request
        </button>
      </div>
    </form>

    <div v-show="activeTab === 'queue'" class="card overflow-hidden">
      <div class="border-b border-gray-800 px-5 py-4">
        <h2 class="text-base font-semibold text-white">Request queue</h2>
        <p class="mt-1 text-sm text-gray-400">Review POS and SKUMS-originated replenishment demand before creating operational orders.</p>
      </div>
      <div v-if="queueRequests.length === 0" class="px-5 py-10 text-center text-sm text-gray-500">
        No open replenishment requests.
      </div>
      <div v-else class="divide-y divide-gray-800">
        <div v-for="request in queueRequests" :key="request.id" class="grid gap-4 px-5 py-4 xl:grid-cols-[1.5fr_1fr_1fr_auto] xl:items-center">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium text-white">{{ request.request_number }}</p>
              <span :class="['rounded-full px-2 py-0.5 text-xs font-medium', requestStatusBadge(request.status).cls]">
                {{ requestStatusBadge(request.status).label }}
              </span>
              <span :class="['rounded-full px-2 py-0.5 text-xs font-medium', priorityBadge(request.priority).cls]">
                {{ priorityBadge(request.priority).label }}
              </span>
            </div>
            <p class="mt-1 text-sm text-gray-400">{{ request.reason || request.request_type.replace('_', ' ') }}</p>
          </div>
          <div class="text-sm">
            <p class="text-gray-300">{{ request.pos_location_name || request.store_location_name || 'No location' }}</p>
            <p class="text-xs text-gray-500">Needed {{ formatDate(request.needed_by) }}</p>
          </div>
          <div class="text-sm">
            <p class="text-gray-300">{{ qtyLabel(request.total_requested_qty) }} units</p>
            <p class="text-xs text-gray-500">{{ request.line_count || 0 }} lines</p>
          </div>
          <div class="flex flex-wrap gap-2 xl:justify-end">
            <button
              v-if="['submitted', 'in_review'].includes(request.status)"
              class="btn-primary !px-3 !py-1.5 text-xs"
              :disabled="decideSaving === request.id"
              @click="decideRequest(request, 'approve_now')"
            >
              Lift now
            </button>
            <button
              v-if="['submitted', 'in_review'].includes(request.status)"
              class="btn-secondary !px-3 !py-1.5 text-xs"
              :disabled="decideSaving === request.id"
              @click="decideRequest(request, 'defer_to_wave')"
            >
              Defer Mon/Thu
            </button>
            <button
              v-if="request.status === 'deferred_to_wave'"
              class="btn-secondary !px-3 !py-1.5 text-xs"
              @click="convertRequestToOrder(request)"
            >
              Convert (legacy)
            </button>
            <button
              v-if="['submitted', 'in_review', 'deferred_to_wave'].includes(request.status)"
              class="rounded-lg px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
              :disabled="decideSaving === request.id"
              @click="decideRequest(request, 'reject')"
            >
              Reject
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-show="activeTab === 'orders'" class="card overflow-hidden">
      <div class="flex flex-col gap-3 border-b border-gray-800 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 class="text-base font-semibold text-white">Replenishment orders</h2>
          <p class="mt-1 text-sm text-gray-400">Operational movement records that can later be sent to Loft or another 3PL connector.</p>
        </div>
      </div>
      <div v-if="orders.length === 0" class="px-5 py-10 text-center text-sm text-gray-500">
        No replenishment orders yet.
      </div>
      <div v-else class="divide-y divide-gray-800">
        <div v-for="order in orders" :key="order.id" class="grid gap-4 px-5 py-4 xl:grid-cols-[1.4fr_1fr_1fr_auto] xl:items-center">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium text-white">{{ order.order_number }}</p>
              <span :class="['rounded-full px-2 py-0.5 text-xs font-medium', orderStatusBadge(order.status).cls]">
                {{ orderStatusBadge(order.status).label }}
              </span>
              <span :class="['rounded-full px-2 py-0.5 text-xs font-medium', priorityBadge(order.priority).cls]">
                {{ priorityBadge(order.priority).label }}
              </span>
            </div>
            <p class="mt-1 text-sm text-gray-400">{{ order.connection_name || order.integration_slug || 'Unassigned connector' }}</p>
          </div>
          <div class="text-sm">
            <p class="text-gray-300">{{ order.source_location_name || 'Source pending' }}</p>
            <p class="text-xs text-gray-500">To {{ order.destination_location_name || order.pos_location_name || 'destination pending' }}</p>
          </div>
          <div class="text-sm">
            <p class="text-gray-300">{{ qtyLabel(order.total_ordered_qty) }} ordered</p>
            <p class="text-xs text-gray-500">{{ qtyLabel(order.total_received_qty) }} received</p>
          </div>
          <div class="flex flex-wrap gap-2 xl:justify-end">
            <button v-if="order.status === 'approved'" class="btn-secondary !px-3 !py-1.5 text-xs" @click="setOrderStatus(order, 'queued')">
              Queue
            </button>
            <button v-if="['approved', 'queued'].includes(order.status)" class="btn-secondary !px-3 !py-1.5 text-xs" @click="setOrderStatus(order, 'sent_to_3pl')">
              Sent
            </button>
            <button v-if="order.status === 'sent_to_3pl'" class="btn-secondary !px-3 !py-1.5 text-xs" @click="setOrderStatus(order, 'acknowledged')">
              Ack
            </button>
            <button v-if="['acknowledged', 'sent_to_3pl'].includes(order.status)" class="btn-secondary !px-3 !py-1.5 text-xs" @click="setOrderStatus(order, 'shipped')">
              Shipped
            </button>
            <button class="rounded-lg px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10" @click="setOrderStatus(order, 'exception')">
              Exception
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-show="activeTab === 'inbound'" class="space-y-5">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-sm text-gray-400">
          KR/HK → M&amp;P → Loft ASN. Draft locally, send to OFS, confirm to promote LOFT-SG stock. POS does not see this.
        </p>
        <button class="btn-primary" @click="showInboundForm = !showInboundForm">
          {{ showInboundForm ? 'Close' : 'New ASN' }}
        </button>
      </div>

      <form v-if="showInboundForm" class="card space-y-4 p-5" @submit.prevent="createInboundAsn">
        <h2 class="text-base font-semibold text-white">Inbound ASN (draft)</h2>
        <div class="grid gap-3 md:grid-cols-2">
          <label class="text-xs text-gray-400">
            Tracking number
            <input v-model="inboundForm.tracking_number" required class="input mt-1 w-full" />
          </label>
          <label class="text-xs text-gray-400">
            ETA
            <input v-model="inboundForm.date_estimate" type="date" required class="input mt-1 w-full" />
          </label>
          <label class="text-xs text-gray-400">
            Reference
            <input v-model="inboundForm.reference_no" class="input mt-1 w-full" placeholder="PO / booking" />
          </label>
          <label class="text-xs text-gray-400">
            Offshore forwarder
            <input v-model="inboundForm.offshore_forwarder" class="input mt-1 w-full" />
          </label>
          <label class="text-xs text-gray-400">
            Palletization
            <select v-model="inboundForm.palletization" class="input mt-1 w-full">
              <option value="full_pallet">Full pallet</option>
              <option value="partial_pallet">Partial pallet</option>
              <option value="loose">Loose</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <label class="text-xs text-gray-400">
            Carton / pallet count
            <div class="mt-1 flex gap-2">
              <input v-model="inboundForm.carton_count" type="number" min="0" class="input w-full" placeholder="Cartons" />
              <input v-model="inboundForm.pallet_count" type="number" min="0" class="input w-full" placeholder="Pallets" />
            </div>
          </label>
        </div>
        <div class="space-y-2">
          <p class="text-xs font-medium text-gray-400">Lines</p>
          <div v-for="(line, idx) in inboundLines" :key="idx" class="flex flex-wrap gap-2">
            <input v-model="line.sku" class="input flex-1" placeholder="SKU" required />
            <input v-model.number="line.quantity" type="number" min="1" class="input w-24" />
            <input v-model="line.product_name" class="input flex-1" placeholder="Name (optional)" />
          </div>
          <button type="button" class="text-xs text-cyan-400" @click="inboundLines.push({ sku: '', quantity: 1, product_name: '' })">
            + Add line
          </button>
        </div>
        <div class="flex justify-end">
          <button type="submit" class="btn-primary" :disabled="inboundSaving">
            {{ inboundSaving ? 'Saving…' : 'Create draft ASN' }}
          </button>
        </div>
      </form>

      <div class="card overflow-hidden">
        <div class="border-b border-gray-800 px-5 py-4">
          <h2 class="text-base font-semibold text-white">Inbound shipments</h2>
        </div>
        <div v-if="inboundLoading" class="px-5 py-8 text-sm text-gray-500">Loading…</div>
        <div v-else-if="inboundShipments.length === 0" class="px-5 py-10 text-center text-sm text-gray-500">
          No inbound ASNs yet.
        </div>
        <div v-else class="divide-y divide-gray-800">
          <div
            v-for="ship in inboundShipments"
            :key="ship.id"
            class="grid gap-3 px-5 py-4 xl:grid-cols-[1.4fr_1fr_1fr_auto] xl:items-center"
          >
            <div>
              <p class="font-medium text-white">{{ ship.shipment_number }}</p>
              <p class="text-xs text-gray-500">
                {{ ship.tracking_number }} · {{ ship.status }}
                <span v-if="ship.palletization"> · {{ ship.palletization }}</span>
              </p>
              <p class="text-xs text-gray-500">M&amp;P · {{ ship.offshore_forwarder || 'offshore TBD' }}</p>
            </div>
            <div class="text-sm text-gray-300">
              ETA {{ formatDate(ship.date_estimate) }}
              <p class="text-xs text-gray-500">{{ (ship.lines || []).length }} line(s)</p>
            </div>
            <div class="text-xs text-gray-500">
              <span v-if="ship.external_stock_incoming_main_id">OFS main {{ ship.external_stock_incoming_main_id }}</span>
              <span v-else>Not sent to Loft</span>
            </div>
            <div class="flex flex-wrap gap-2 xl:justify-end">
              <button
                v-if="['partial_received', 'fully_received', 'loft_receiving', 'asn_sent', 'in_transit', 'draft'].includes(ship.status)"
                class="btn-primary !px-3 !py-1.5 text-xs"
                @click="confirmInbound(ship)"
              >
                LISE confirm → LOFT-SG
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-show="activeTab === 'receiving'" class="space-y-5">
      <div class="flex justify-end">
        <button class="btn-primary" @click="showReceivingForm = !showReceivingForm">
          New Receipt
        </button>
      </div>

      <form v-if="showReceivingForm" class="card space-y-4 p-5" @submit.prevent="handleCreateReceivingSession">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h2 class="text-base font-semibold text-white">Store receiving</h2>
            <p class="text-sm text-gray-400">Capture what arrived at the store and surface mismatches for SKUMS review.</p>
          </div>
          <button type="button" class="text-sm text-gray-400 hover:text-white" @click="showReceivingForm = false">
            Close
          </button>
        </div>

        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label>
            <span class="label-field">Order</span>
            <select v-model="receivingForm.replenishment_order_id" class="input-field">
              <option value="">Manual receipt</option>
              <option v-for="order in activeOrders" :key="order.id" :value="order.id">
                {{ order.order_number }}
              </option>
            </select>
          </label>
          <label>
            <span class="label-field">POS store</span>
            <select v-model="receivingForm.pos_location_id" class="input-field">
              <option value="">Unassigned</option>
              <option v-for="location in posLocations" :key="location.id" :value="location.id">
                {{ posLocationLabel(location) }}
              </option>
            </select>
          </label>
          <label>
            <span class="label-field">Inventory location</span>
            <select v-model="receivingForm.inventory_location_id" class="input-field">
              <option value="">Unassigned</option>
              <option v-for="location in storeLocations" :key="location.id" :value="location.id">
                {{ locationLabel(location) }}
              </option>
            </select>
          </label>
          <label>
            <span class="label-field">Source ref</span>
            <input v-model="receivingForm.source_ref" class="input-field" placeholder="Packing slip / dispatch ID" />
          </label>
        </div>

        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="label-field mb-0">Receipt lines</span>
            <button type="button" class="text-sm text-indigo-400 hover:text-indigo-300" @click="addReceiptLine">
              Add line
            </button>
          </div>
          <div
            v-for="(line, index) in receiptLines"
            :key="index"
            class="grid gap-3 rounded-lg border border-gray-800 bg-gray-950/40 p-3 lg:grid-cols-[1fr_repeat(5,96px)_140px_auto]"
          >
            <input v-model="line.sku" class="input-field font-mono text-sm" placeholder="SKU / barcode" />
            <input v-model.number="line.expected_qty" type="number" min="0" class="input-field" placeholder="Expected" />
            <input v-model.number="line.received_qty" type="number" min="0" class="input-field" placeholder="Received" />
            <input v-model.number="line.damaged_qty" type="number" min="0" class="input-field" placeholder="Damaged" />
            <input v-model.number="line.short_qty" type="number" min="0" class="input-field" placeholder="Short" />
            <input v-model.number="line.overage_qty" type="number" min="0" class="input-field" placeholder="Over" />
            <select v-model="line.exception_type" class="input-field">
              <option value="">No exception</option>
              <option value="short">Short</option>
              <option value="damaged">Damaged</option>
              <option value="over">Over</option>
              <option value="wrong_sku">Wrong SKU</option>
              <option value="unexpected_item">Unexpected</option>
              <option value="unmapped_sku">Unmapped</option>
            </select>
            <button type="button" class="rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white" @click="removeReceiptLine(index)">
              Remove
            </button>
          </div>
        </div>

        <div class="flex justify-end">
          <button class="btn-primary" :disabled="receivingSaving">
            Record receipt
          </button>
        </div>
      </form>

      <div class="card overflow-hidden">
        <div class="border-b border-gray-800 px-5 py-4">
          <h2 class="text-base font-semibold text-white">Receiving sessions</h2>
        </div>
        <div v-if="receivingSessions.length === 0" class="px-5 py-10 text-center text-sm text-gray-500">
          No receiving sessions yet.
        </div>
        <div v-else class="divide-y divide-gray-800">
          <div v-for="session in receivingSessions" :key="session.id" class="grid gap-4 px-5 py-4 md:grid-cols-[1fr_1fr_1fr] md:items-center">
            <div>
              <p class="font-medium text-white">{{ session.session_number }}</p>
              <p class="text-sm text-gray-400">{{ session.receipt_type.replace('_', ' ') }}</p>
            </div>
            <div class="text-sm text-gray-300">{{ session.status.replace('_', ' ') }}</div>
            <div class="text-sm text-gray-500 md:text-right">{{ formatDate(session.received_at || session.created_at) }}</div>
          </div>
        </div>
      </div>
    </div>

    <div v-show="activeTab === 'exceptions'" class="space-y-5">
      <div class="flex justify-end">
        <button class="btn-primary" @click="showExceptionForm = !showExceptionForm">
          New Exception
        </button>
      </div>

      <form v-if="showExceptionForm" class="card space-y-4 p-5" @submit.prevent="handleCreateException">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h2 class="text-base font-semibold text-white">Inventory exception</h2>
            <p class="text-sm text-gray-400">Log variances that need SKUMS review or 3PL follow-up.</p>
          </div>
          <button type="button" class="text-sm text-gray-400 hover:text-white" @click="showExceptionForm = false">
            Close
          </button>
        </div>

        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label class="md:col-span-2">
            <span class="label-field">Title</span>
            <input v-model="exceptionForm.title" class="input-field" placeholder="Short receipt, damaged item, stock variance" />
          </label>
          <label>
            <span class="label-field">Type</span>
            <select v-model="exceptionForm.exception_type" class="input-field">
              <option value="short_receipt">Short receipt</option>
              <option value="damaged_receipt">Damaged receipt</option>
              <option value="over_receipt">Over receipt</option>
              <option value="wrong_sku">Wrong SKU</option>
              <option value="unmapped_sku">Unmapped SKU</option>
              <option value="stock_variance">Stock variance</option>
              <option value="3pl_error">3PL error</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            <span class="label-field">Severity</span>
            <select v-model="exceptionForm.severity" class="input-field">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>
            <span class="label-field">Source</span>
            <select v-model="exceptionForm.source_type" class="input-field">
              <option value="manual">Manual</option>
              <option value="pos_inventory_event">POS event</option>
              <option value="receiving_session">Receiving</option>
              <option value="replenishment_order">Replenishment</option>
              <option value="integration">Integration</option>
            </select>
          </label>
          <label>
            <span class="label-field">SKU</span>
            <input v-model="exceptionForm.sku" class="input-field font-mono text-sm" placeholder="SKU / barcode" />
          </label>
          <label>
            <span class="label-field">Expected</span>
            <input v-model.number="exceptionForm.expected_qty" type="number" class="input-field" />
          </label>
          <label>
            <span class="label-field">Actual</span>
            <input v-model.number="exceptionForm.actual_qty" type="number" class="input-field" />
          </label>
          <label>
            <span class="label-field">POS store</span>
            <select v-model="exceptionForm.pos_location_id" class="input-field">
              <option value="">Unassigned</option>
              <option v-for="location in posLocations" :key="location.id" :value="location.id">
                {{ posLocationLabel(location) }}
              </option>
            </select>
          </label>
          <label>
            <span class="label-field">Inventory location</span>
            <select v-model="exceptionForm.inventory_location_id" class="input-field">
              <option value="">Unassigned</option>
              <option v-for="location in locations" :key="location.id" :value="location.id">
                {{ locationLabel(location) }}
              </option>
            </select>
          </label>
          <label class="md:col-span-2">
            <span class="label-field">Summary</span>
            <input v-model="exceptionForm.summary" class="input-field" placeholder="What should the manager know?" />
          </label>
        </div>

        <div class="flex justify-end">
          <button class="btn-primary" :disabled="exceptionSaving">
            Log exception
          </button>
        </div>
      </form>

      <div class="card overflow-hidden">
        <div class="border-b border-gray-800 px-5 py-4">
          <h2 class="text-base font-semibold text-white">Exception queue</h2>
        </div>
        <div v-if="exceptions.length === 0" class="px-5 py-10 text-center text-sm text-gray-500">
          No inventory exceptions.
        </div>
        <div v-else class="divide-y divide-gray-800">
          <div v-for="exception in exceptions" :key="exception.id" class="grid gap-4 px-5 py-4 xl:grid-cols-[1.5fr_1fr_1fr_auto] xl:items-center">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-medium text-white">{{ exception.title }}</p>
                <span :class="['rounded-full px-2 py-0.5 text-xs font-medium', exceptionStatusBadge(exception.status).cls]">
                  {{ exceptionStatusBadge(exception.status).label }}
                </span>
              </div>
              <p class="mt-1 text-sm text-gray-400">{{ exception.summary || exception.exception_type.replace('_', ' ') }}</p>
            </div>
            <div class="text-sm">
              <p class="font-mono text-gray-300">{{ exception.sku || 'No SKU' }}</p>
              <p class="text-xs text-gray-500">{{ exception.source_type.replace('_', ' ') }}</p>
            </div>
            <div class="text-sm">
              <p class="text-gray-300">Expected {{ qtyLabel(exception.expected_qty) }}</p>
              <p class="text-xs text-gray-500">Actual {{ qtyLabel(exception.actual_qty) }}</p>
            </div>
            <div class="flex flex-wrap gap-2 xl:justify-end">
              <button
                v-if="['open', 'in_review'].includes(exception.status)"
                class="btn-primary !px-3 !py-1.5 text-xs"
                @click="verifyException(exception, 'confirm')"
              >
                Confirm claim
              </button>
              <button
                v-if="['open', 'in_review'].includes(exception.status)"
                class="btn-secondary !px-3 !py-1.5 text-xs"
                @click="verifyException(exception, 'escalate')"
              >
                Escalate Loft
              </button>
              <button
                class="rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
                @click="verifyException(exception, 'reject')"
              >
                Reject claim
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-show="activeTab === 'waves'" class="space-y-5">
      <div class="card p-5 space-y-4">
        <div>
          <h2 class="text-base font-semibold text-white">Wave cadence & cutoffs</h2>
          <p class="mt-1 text-sm text-gray-400">
            Default Mon + Thu waves. Cutoff hours control when deferrals lock into the next wave.
            Per-store receive windows sit on top for door delivery vs self-collect.
          </p>
        </div>
        <div v-if="storeSettings" class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label>
            <span class="label-field">Wave weekdays (ISO 1=Mon…7=Sun)</span>
            <input
              class="input-field font-mono text-sm"
              :value="(storeSettings.wave_weekdays || []).join(',')"
              @change="onWaveWeekdaysInput"
            >
            <span class="mt-1 block text-xs text-gray-500">e.g. 1,4 for Monday + Thursday</span>
          </label>
          <label>
            <span class="label-field">Include cutoff (hours before wave day)</span>
            <input v-model.number="storeSettings.wave_include_cutoff_hours" type="number" min="0" max="168" class="input-field" >
          </label>
          <label>
            <span class="label-field">Default receive-by (local)</span>
            <input v-model="storeSettings.default_receive_by_local" class="input-field" placeholder="10:00" >
          </label>
          <label>
            <span class="label-field">Default delivery mode</span>
            <select v-model="storeSettings.default_delivery_mode" class="input-field">
              <option value="delivery">Loft delivery</option>
              <option value="self_collect">Self-collect</option>
            </select>
          </label>
        </div>
        <div class="flex justify-end">
          <button class="btn-primary" :disabled="wavesSaving" @click="saveSettings">
            Save settings
          </button>
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="border-b border-gray-800 px-5 py-4">
          <h2 class="text-base font-semibold text-white">Upcoming waves</h2>
          <p class="text-xs text-gray-500">{{ waveBundle?.cadence_note }}</p>
        </div>
        <div v-if="wavesLoading" class="px-5 py-8 text-sm text-gray-500">Loading waves…</div>
        <div v-else class="divide-y divide-gray-800">
          <div
            v-for="w in (waveBundle?.waves || [])"
            :key="w.id"
            class="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
          >
            <div>
              <p class="font-medium text-white">{{ w.wave_number }} · {{ w.wave_date }}</p>
              <p class="text-xs text-gray-500">{{ w.status }}</p>
            </div>
            <div class="flex gap-2">
              <button class="btn-secondary !px-3 !py-1.5 text-xs" :disabled="wavesSaving" @click="runAllocationPreview(w.id, false)">
                Preview allocation
              </button>
              <button class="btn-primary !px-3 !py-1.5 text-xs" :disabled="wavesSaving" @click="runAllocationPreview(w.id, true)">
                Save allocation draft
              </button>
            </div>
          </div>
          <div v-if="!(waveBundle?.waves || []).length" class="px-5 py-8 text-sm text-gray-500">
            No wave rows yet — refresh ensures the next Mon/Thu dates.
          </div>
        </div>
      </div>

      <div v-if="allocationPreview" class="card p-5 space-y-3">
        <h2 class="text-base font-semibold text-white">Allocation preview (Loft ATS)</h2>
        <p class="text-xs text-gray-500">
          {{ allocationPreview.note || allocationPreview.preview?.note }}
          · Short SKUs: {{ allocationPreview.summary?.short_skus ?? allocationPreview.preview?.summary?.short_skus ?? '—' }}
        </p>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="text-xs text-gray-500">
              <tr>
                <th class="py-2 pr-3">SKU</th>
                <th class="py-2 pr-3">Loft ATS</th>
                <th class="py-2 pr-3">Requested</th>
                <th class="py-2 pr-3">Allocated</th>
                <th class="py-2">Shortfall</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in (allocationPreview.allocations || allocationPreview.preview?.allocations || [])"
                :key="row.sku"
                class="border-t border-gray-800"
              >
                <td class="py-2 pr-3 font-mono text-gray-200">{{ row.sku }}</td>
                <td class="py-2 pr-3 text-gray-300">{{ row.loft_available_qty }}</td>
                <td class="py-2 pr-3 text-gray-300">{{ row.total_requested_qty }}</td>
                <td class="py-2 pr-3 text-emerald-300">{{ row.total_allocated_qty }}</td>
                <td class="py-2" :class="row.shortfall > 0 ? 'text-red-300' : 'text-gray-500'">{{ row.shortfall }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card p-5 space-y-4">
        <h2 class="text-base font-semibold text-white">Per-store receive window</h2>
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label>
            <span class="label-field">Inventory location (store)</span>
            <select v-model="calendarForm.inventory_location_id" class="input-field">
              <option value="">Select…</option>
              <option v-for="loc in storeLocations" :key="loc.id" :value="loc.id">
                {{ locationLabel(loc) }}
              </option>
            </select>
          </label>
          <label>
            <span class="label-field">POS location (optional)</span>
            <select v-model="calendarForm.pos_location_id" class="input-field">
              <option value="">None</option>
              <option v-for="loc in posLocations" :key="loc.id" :value="loc.id">
                {{ posLocationLabel(loc) }}
              </option>
            </select>
          </label>
          <label>
            <span class="label-field">Preferred mode</span>
            <select v-model="calendarForm.preferred_delivery_mode" class="input-field">
              <option value="delivery">Delivery</option>
              <option value="self_collect">Self-collect</option>
            </select>
          </label>
          <label>
            <span class="label-field">Window start</span>
            <input v-model="calendarForm.receive_window_start" class="input-field" placeholder="08:00" >
          </label>
          <label>
            <span class="label-field">Window end (e.g. before 10:00)</span>
            <input v-model="calendarForm.receive_window_end" class="input-field" placeholder="10:00" >
          </label>
          <label>
            <span class="label-field">Notes</span>
            <input v-model="calendarForm.notes" class="input-field" placeholder="Prime receive before 10:00" >
          </label>
        </div>
        <div class="flex justify-end">
          <button class="btn-primary" :disabled="wavesSaving" @click="saveCalendar">
            Save store calendar
          </button>
        </div>
        <div v-if="deliveryCalendars.length" class="divide-y divide-gray-800 border-t border-gray-800 pt-3">
          <div v-for="cal in deliveryCalendars" :key="cal.id" class="py-2 text-sm">
            <span class="text-white">{{ cal.location?.name || cal.inventory_location_id }}</span>
            <span class="text-gray-500"> · {{ cal.preferred_delivery_mode }} · window {{ cal.receive_window_start || '—' }}–{{ cal.receive_window_end || '—' }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-show="activeTab === 'floor'" class="space-y-5">
      <div class="card p-5">
        <h2 class="text-base font-semibold text-white">Floor adjustments → inventory ledger</h2>
        <p class="mt-1 text-sm text-gray-400">
          POS damage, found stock, and cycle counts land here as pending adjustments.
          Apply writes <span class="font-mono text-gray-300">inventory_ledger</span> (quantity truth);
          reject leaves stock unchanged. Requires <span class="font-mono text-gray-300">inventory:write</span>.
        </p>
      </div>

      <div class="card overflow-hidden">
        <div class="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <h2 class="text-base font-semibold text-white">Pending queue</h2>
          <button class="btn-secondary !px-3 !py-1.5 text-xs" :disabled="floorLoading" @click="loadFloorAdjustments">
            Refresh
          </button>
        </div>
        <div v-if="floorLoading" class="px-5 py-10 text-center text-sm text-gray-500">
          Loading adjustments…
        </div>
        <div v-else-if="pendingAdjustments.length === 0" class="px-5 py-10 text-center text-sm text-gray-500">
          No pending floor adjustments.
        </div>
        <div v-else class="divide-y divide-gray-800">
          <div
            v-for="adj in pendingAdjustments"
            :key="adj.id"
            class="grid gap-4 px-5 py-4 xl:grid-cols-[1.4fr_1fr_1fr_auto] xl:items-center"
          >
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-medium text-white">{{ adj.adjustment_number }}</p>
                <span class="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
                  {{ adj.adjustment_type }}
                </span>
                <span class="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                  {{ adj.status }}
                </span>
              </div>
              <p class="mt-1 text-sm text-gray-400">
                {{ adj.location?.name || adj.location_id }}
                <span v-if="adj.location?.code" class="font-mono text-gray-500">({{ adj.location.code }})</span>
              </p>
              <p v-if="adj.notes" class="mt-1 text-xs text-gray-500">{{ adj.notes }}</p>
            </div>
            <div class="text-sm space-y-1">
              <div v-for="line in (adj.lines || [])" :key="line.id" class="text-gray-300">
                <span class="font-mono">{{ line.product?.sku || line.product_id?.slice?.(0, 8) }}</span>
                <span class="text-gray-500"> · sys {{ line.system_qty ?? '—' }} → count {{ line.counted_qty }}</span>
              </div>
            </div>
            <div class="text-sm">
              <p :class="adjustmentVariance(adj) < 0 ? 'text-red-300' : adjustmentVariance(adj) > 0 ? 'text-emerald-300' : 'text-gray-300'">
                Variance {{ adjustmentVariance(adj) > 0 ? '+' : '' }}{{ adjustmentVariance(adj) }}
              </p>
              <p class="text-xs text-gray-500">Ledger on apply only</p>
            </div>
            <div class="flex flex-wrap gap-2 xl:justify-end">
              <button
                class="btn-primary !px-3 !py-1.5 text-xs"
                :disabled="floorActing === adj.id"
                @click="applyAdjustment(adj)"
              >
                Apply to ledger
              </button>
              <button
                class="rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
                :disabled="floorActing === adj.id"
                @click="rejectAdjustment(adj)"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
