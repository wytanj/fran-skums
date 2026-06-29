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

const activeTab = ref<'queue' | 'orders' | 'receiving' | 'exceptions'>('queue')
const tabs = [
  { key: 'queue', label: 'Queue' },
  { key: 'orders', label: 'Orders' },
  { key: 'receiving', label: 'Receiving' },
  { key: 'exceptions', label: 'Exceptions' },
] as const

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
  ])
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
  requests.value.filter(request => ['submitted', 'in_review', 'approved'].includes(request.status)),
)

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
  { label: 'Open exceptions', value: openExceptions.value.length, sub: 'Needs SKUMS review' },
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
  const validLines = requestLines.value.filter(line => line.sku.trim() && Number(line.requested_qty) > 0)
  if (!validLines.length) return showErr('Add at least one SKU line')

  requestSaving.value = true
  const { error } = await createReplenishmentRequest(
    {
      request_type: requestForm.value.request_type,
      priority: requestForm.value.priority,
      source_type: 'skums',
      pos_location_id: requestForm.value.pos_location_id || null,
      store_location_id: requestForm.value.store_location_id || defaultStoreLocation.value?.id || null,
      needed_by: requestForm.value.needed_by || null,
      reason: requestForm.value.reason || null,
      metadata: { entry_surface: 'store_ops' },
    },
    validLines.map(line => ({
      sku: line.sku.trim(),
      requested_qty: Number(line.requested_qty),
      reason: line.reason || null,
    })),
  )
  requestSaving.value = false

  if (error) return showErr(error.message)
  showOk('Replenishment request created')
  showRequestForm.value = false
  resetRequestForm()
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
            <button v-if="request.status === 'submitted'" class="btn-secondary !px-3 !py-1.5 text-xs" @click="setRequestStatus(request, 'in_review')">
              Review
            </button>
            <button v-if="request.status !== 'approved'" class="btn-secondary !px-3 !py-1.5 text-xs" @click="setRequestStatus(request, 'approved')">
              Approve
            </button>
            <button class="btn-primary !px-3 !py-1.5 text-xs" @click="convertRequestToOrder(request)">
              Create order
            </button>
            <button class="rounded-lg px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10" @click="setRequestStatus(request, 'rejected')">
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
              <button v-if="exception.status === 'open'" class="btn-secondary !px-3 !py-1.5 text-xs" @click="setExceptionStatus(exception, 'in_review')">
                Review
              </button>
              <button class="btn-secondary !px-3 !py-1.5 text-xs" @click="setExceptionStatus(exception, 'resolved')">
                Resolve
              </button>
              <button class="rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white" @click="setExceptionStatus(exception, 'dismissed')">
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
