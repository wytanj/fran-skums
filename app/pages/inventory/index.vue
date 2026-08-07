<script setup lang="ts">
import type { InventoryLocation, PurchaseOrder, PurchaseOrderLine } from '~/composables/useInventory'

const {
  locations, stockSummary, purchaseOrders, transfers, loading,
  loadLocations, createLocation, seedDefaultLocations,
  loadStockSummary, loadPurchaseOrders, loadPoLines,
  createPurchaseOrder, confirmPo, markPoInTransit, receiveGoods, cancelPo,
  loadTransfers, createTransfer,
  locationTypeBadge, poStatusBadge, transferStatusBadge,
} = useInventory()

const { currentWorkspace } = useWorkspace()

// ── Tabs ───────────────────────────────────────────────────────
const activeTab = ref<'stock' | 'locations' | 'purchase-orders' | 'transfers'>('stock')
const tabs = [
  { key: 'stock',           label: 'Stock' },
  { key: 'locations',       label: 'Locations' },
  { key: 'purchase-orders', label: 'Purchase Orders' },
  { key: 'transfers',       label: 'Transfers' },
]

// ── Toast ──────────────────────────────────────────────────────
// Shared fixed-position feedback (ToastHost) — see useActionFeedback.
const { notify, runAction, isPending } = useActionFeedback()
function showOk(msg: string) { notify.success(msg) }
function showErr(msg: unknown) { notify.error(typeof msg === 'string' ? new Error(msg) : msg) }

// ── Stock tab ──────────────────────────────────────────────────
const expandedProduct = ref<string | null>(null)
const stockSearch = ref('')
const stockFilter = ref<'all' | 'low' | 'out' | 'transit'>('all')

const filteredStock = computed(() => {
  let rows = stockSummary.value
  if (stockSearch.value) {
    const q = stockSearch.value.toLowerCase()
    rows = rows.filter(r =>
      r.product_title?.toLowerCase().includes(q) ||
      r.product_sku?.toLowerCase().includes(q)
    )
  }
  if (stockFilter.value === 'low')     rows = rows.filter(r => r.total_available > 0 && r.total_available <= 10)
  if (stockFilter.value === 'out')     rows = rows.filter(r => r.total_available <= 0)
  if (stockFilter.value === 'transit') rows = rows.filter(r => r.total_in_transit > 0)
  return rows
})

// Summary stat cards
const stockStats = computed(() => ({
  skus:      stockSummary.value.length,
  available: stockSummary.value.reduce((s, r) => s + (r.total_available || 0), 0),
  inTransit: stockSummary.value.reduce((s, r) => s + (r.total_in_transit || 0), 0),
  lowStock:  stockSummary.value.filter(r => r.total_available > 0 && r.total_available <= 10).length,
  outOfStock: stockSummary.value.filter(r => r.total_available <= 0).length,
}))

function toggleExpand(productId: string) {
  expandedProduct.value = expandedProduct.value === productId ? null : productId
}

// ── Locations tab ──────────────────────────────────────────────
const showLocationForm = ref(false)
const locationSaving = ref(false)
const newLocation = ref({
  name: '', code: '', location_type: 'warehouse' as InventoryLocation['location_type'],
  notes: '', is_default: false,
})

async function handleSeedLocations() {
  const { error } = await seedDefaultLocations()
  if (error) showErr(error.message)
  else showOk('Default locations created')
}

async function handleCreateLocation() {
  if (!newLocation.value.name.trim() || !newLocation.value.code.trim()) return
  locationSaving.value = true
  const { error } = await createLocation({
    name: newLocation.value.name,
    code: newLocation.value.code.toUpperCase().replace(/\s+/g, '-'),
    location_type: newLocation.value.location_type,
    notes: newLocation.value.notes || null,
    is_default: newLocation.value.is_default,
    is_active: true,
  })
  locationSaving.value = false
  if (error) return showErr(error.message)
  showOk('Location created')
  showLocationForm.value = false
  newLocation.value = { name: '', code: '', location_type: 'warehouse', notes: '', is_default: false }
}

// ── Purchase Orders tab ────────────────────────────────────────
const showPoForm = ref(false)
const poSaving = ref(false)
const newPo = ref({
  supplier_name: '',
  supplier_ref: '',
  destination_location_id: '',
  currency: 'USD',
  notes: '',
})
const poLines = ref<Array<{ product_id: string; product_label: string; ordered_qty: number; unit_cost: number | null }>>([])

function addPoLine() {
  poLines.value.push({ product_id: '', product_label: '', ordered_qty: 1, unit_cost: null })
}
function removePoLine(i: number) { poLines.value.splice(i, 1) }

async function handleCreatePo() {
  if (!newPo.value.supplier_name.trim() || !newPo.value.destination_location_id) return
  const validLines = poLines.value.filter(l => l.product_id && l.ordered_qty > 0)
  if (!validLines.length) return showErr('Add at least one product line')
  poSaving.value = true
  const { error } = await createPurchaseOrder(newPo.value, validLines)
  poSaving.value = false
  if (error) return showErr(error.message)
  showOk('Purchase order created')
  showPoForm.value = false
  newPo.value = { supplier_name: '', supplier_ref: '', destination_location_id: '', currency: 'USD', notes: '' }
  poLines.value = []
}

async function handleConfirmPo(poId: string) {
  const { error } = await confirmPo(poId)
  if (error) showErr(error.message)
  else showOk('PO confirmed — on-order quantities updated')
}

async function handleCancelPo(poId: string) {
  if (!confirm('Cancel this purchase order?')) return
  const { error } = await cancelPo(poId)
  if (error) showErr(error.message)
  else showOk('PO cancelled')
}

// Ship modal
const shipModal = ref<PurchaseOrder | null>(null)
const shipLines = ref<PurchaseOrderLine[]>([])
const shipForm = ref({ carrier: '', tracking_number: '', shipping_method: 'sea_freight', expected_arrival: '' })
const shipSaving = ref(false)

async function openShipModal(po: PurchaseOrder) {
  shipModal.value = po
  shipForm.value = { carrier: po.carrier || '', tracking_number: po.tracking_number || '', shipping_method: po.shipping_method || 'sea_freight', expected_arrival: po.expected_arrival || '' }
}

async function handleMarkShipped() {
  if (!shipModal.value) return
  shipSaving.value = true
  const { error } = await markPoInTransit(shipModal.value.id, shipForm.value)
  shipSaving.value = false
  if (error) return showErr(error.message)
  showOk('PO marked in transit — in-transit quantities updated')
  shipModal.value = null
}

// Receive modal
const receiveModal = ref<PurchaseOrder | null>(null)
const receiveLines = ref<PurchaseOrderLine[]>([])
const receiveQtys = ref<Record<string, number>>({})
const receiveSaving = ref(false)

async function openReceiveModal(po: PurchaseOrder) {
  receiveModal.value = po
  receiveLines.value = await loadPoLines(po.id)
  receiveQtys.value = Object.fromEntries(
    receiveLines.value.map(l => [l.id, l.ordered_qty - l.received_qty])
  )
}

async function handleReceiveGoods() {
  if (!receiveModal.value) return
  const receipts = receiveLines.value
    .map(l => ({ line_id: l.id, qty: receiveQtys.value[l.id] || 0 }))
    .filter(r => r.qty > 0)
  if (!receipts.length) return showErr('Enter at least one quantity to receive')
  receiveSaving.value = true
  const { error } = await receiveGoods(receiveModal.value.id, receipts)
  receiveSaving.value = false
  if (error) return showErr(error.message)
  showOk('Goods received — on-hand quantities updated')
  receiveModal.value = null
}

// ── Transfers tab ──────────────────────────────────────────────
const showTransferForm = ref(false)
const transferSaving = ref(false)
const newTransfer = ref({ from_location_id: '', to_location_id: '', expected_arrival: '' })
// Simplified: no inline line builder for v1 — user creates transfer then adds lines
async function handleCreateTransfer() {
  if (!newTransfer.value.from_location_id || !newTransfer.value.to_location_id) return
  if (newTransfer.value.from_location_id === newTransfer.value.to_location_id)
    return showErr('From and To locations must be different')
  transferSaving.value = true
  const { error } = await createTransfer(newTransfer.value, [])
  transferSaving.value = false
  if (error) return showErr(error.message)
  showOk('Transfer created')
  showTransferForm.value = false
  newTransfer.value = { from_location_id: '', to_location_id: '', expected_arrival: '' }
}

// ── Init ───────────────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([
    loadLocations(),
    loadStockSummary(),
    loadPurchaseOrders(),
    loadTransfers(),
  ])
})

watch(() => currentWorkspace.value?.id, async () => {
  await Promise.all([loadLocations(), loadStockSummary(), loadPurchaseOrders(), loadTransfers()])
})
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-bold text-ink">Inventory</h1>
        <p class="mt-1 text-sm text-muted">Track stock across all locations — warehouse, in transit, and channel reservations.</p>
      </div>
    </div>

    <!-- Toast -->

    <!-- Tabs -->
    <div class="flex gap-1 rounded-lg border border-line bg-white p-1">
      <button
        v-for="tab in tabs" :key="tab.key"
        :class="['flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all',
          activeTab === tab.key ? 'bg-surface-sunken text-ink shadow-sm' : 'text-muted hover:text-ink']"
        @click="activeTab = tab.key as any"
      >{{ tab.label }}</button>
    </div>

    <!-- ═══════════════════════════════════════════════════════
         STOCK TAB
    ═══════════════════════════════════════════════════════ -->
    <div v-show="activeTab === 'stock'" class="space-y-6">

      <!-- Stat cards -->
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div class="card p-4">
          <p class="text-xs uppercase tracking-wide text-muted">SKUs Tracked</p>
          <p class="mt-1 text-2xl font-bold text-ink">{{ stockStats.skus }}</p>
        </div>
        <div class="card p-4">
          <p class="text-xs uppercase tracking-wide text-muted">Available to Sell</p>
          <p class="mt-1 text-2xl font-bold text-success">{{ stockStats.available.toLocaleString() }}</p>
          <p class="text-xs text-muted">units</p>
        </div>
        <div class="card p-4">
          <p class="text-xs uppercase tracking-wide text-muted">In Transit</p>
          <p class="mt-1 text-2xl font-bold text-warning">{{ stockStats.inTransit.toLocaleString() }}</p>
          <p class="text-xs text-muted">incoming</p>
        </div>
        <div class="card p-4">
          <p class="text-xs uppercase tracking-wide text-muted">Low Stock</p>
          <p class="mt-1 text-2xl font-bold" :class="stockStats.lowStock > 0 ? 'text-warning' : 'text-ink'">
            {{ stockStats.lowStock }}
          </p>
          <p class="text-xs text-muted">≤ 10 units ATS</p>
        </div>
        <div class="card p-4">
          <p class="text-xs uppercase tracking-wide text-muted">Out of Stock</p>
          <p class="mt-1 text-2xl font-bold" :class="stockStats.outOfStock > 0 ? 'text-danger' : 'text-ink'">
            {{ stockStats.outOfStock }}
          </p>
          <p class="text-xs text-muted">0 ATS</p>
        </div>
      </div>

      <!-- Filter bar -->
      <div class="flex flex-wrap items-center gap-3">
        <input
          v-model="stockSearch"
          class="input-field w-56"
          placeholder="Search SKU or product…"
        />
        <div class="flex rounded-lg border border-line overflow-hidden text-sm">
          <button
            v-for="f in [{ key: 'all', label: 'All' }, { key: 'low', label: 'Low Stock' }, { key: 'out', label: 'Out of Stock' }, { key: 'transit', label: 'In Transit' }]"
            :key="f.key"
            :class="['px-3 py-1.5 font-medium transition-colors',
              stockFilter === f.key ? 'bg-line text-ink' : 'text-muted hover:text-ink']"
            @click="stockFilter = f.key as any"
          >{{ f.label }}</button>
        </div>
      </div>

      <!-- Stock table -->
      <div class="card overflow-hidden">
        <!-- Quantity legend -->
        <div class="flex flex-wrap gap-4 border-b border-line px-5 py-3 text-xs text-muted">
          <span><span class="font-semibold text-ink">On Hand</span> — physically present</span>
          <span><span class="font-semibold text-danger">Reserved</span> — locked (orders, channels)</span>
          <span><span class="font-semibold text-success">Available</span> — on hand − reserved (ATS)</span>
          <span><span class="font-semibold text-warning">In Transit</span> — en route, not yet received</span>
          <span><span class="font-semibold text-brown">On Order</span> — confirmed PO, not shipped yet</span>
        </div>

        <div v-if="loading" class="py-12 text-center text-sm text-muted">Loading…</div>

        <div v-else-if="filteredStock.length === 0" class="py-12 text-center text-sm text-muted">
          <p>No stock records yet.</p>
          <p class="mt-1">Set up your locations then add inventory via Purchase Orders or Adjustments.</p>
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th class="px-5 py-3">Product</th>
                <th class="px-4 py-3 text-right">On Hand</th>
                <th class="px-4 py-3 text-right text-danger">Reserved</th>
                <th class="px-4 py-3 text-right text-success font-bold">Available</th>
                <th class="px-4 py-3 text-right text-warning">In Transit</th>
                <th class="px-4 py-3 text-right text-brown">On Order</th>
                <th class="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in filteredStock" :key="row.product_id + (row.variant_id || '')">
                <!-- Summary row -->
                <tr
                  class="border-b border-line transition-colors hover:bg-surface-sunken/40 cursor-pointer"
                  :class="{ 'bg-red-950/20': row.total_available <= 0, 'bg-yellow-950/10': row.total_available > 0 && row.total_available <= 10 }"
                  @click="toggleExpand(row.product_id)"
                >
                  <td class="px-5 py-3">
                    <p class="font-medium text-ink">{{ row.product_title }}</p>
                    <p class="text-xs text-muted font-mono">{{ row.product_sku || '—' }}</p>
                  </td>
                  <td class="px-4 py-3 text-right text-ink-soft">{{ row.total_on_hand.toLocaleString() }}</td>
                  <td class="px-4 py-3 text-right" :class="row.total_reserved > 0 ? 'text-danger' : 'text-muted'">
                    {{ row.total_reserved.toLocaleString() }}
                  </td>
                  <td class="px-4 py-3 text-right font-semibold" :class="row.total_available <= 0 ? 'text-danger' : row.total_available <= 10 ? 'text-warning' : 'text-success'">
                    {{ row.total_available.toLocaleString() }}
                  </td>
                  <td class="px-4 py-3 text-right" :class="row.total_in_transit > 0 ? 'text-warning' : 'text-muted'">
                    {{ row.total_in_transit.toLocaleString() }}
                  </td>
                  <td class="px-4 py-3 text-right" :class="row.total_on_order > 0 ? 'text-brown' : 'text-muted'">
                    {{ row.total_on_order.toLocaleString() }}
                  </td>
                  <td class="px-4 py-3 text-right">
                    <svg class="h-4 w-4 text-muted inline transition-transform" :class="{ 'rotate-90': expandedProduct === row.product_id }" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </td>
                </tr>

                <!-- Expanded location breakdown -->
                <tr v-if="expandedProduct === row.product_id" class="border-b border-line bg-white/60">
                  <td colspan="7" class="px-8 py-3">
                    <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">By Location</p>
                    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <div
                        v-for="loc in row.by_location" :key="loc.location_id"
                        class="rounded-lg border border-line bg-surface-sunken/60 px-4 py-3"
                      >
                        <div class="flex items-center gap-2 mb-2">
                          <span class="text-sm font-medium text-ink">{{ loc.location_name }}</span>
                          <span :class="['rounded-full px-2 py-0.5 text-[10px] font-medium', locationTypeBadge(loc.location_type as any).cls]">
                            {{ locationTypeBadge(loc.location_type as any).label }}
                          </span>
                        </div>
                        <div class="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <p class="text-muted">On Hand</p>
                            <p class="font-semibold text-ink">{{ loc.on_hand }}</p>
                          </div>
                          <div>
                            <p class="text-danger/80">Reserved</p>
                            <p class="font-semibold" :class="loc.reserved > 0 ? 'text-danger' : 'text-muted'">{{ loc.reserved }}</p>
                          </div>
                          <div>
                            <p class="text-success/80">Available</p>
                            <p class="font-semibold" :class="loc.available <= 0 ? 'text-danger' : 'text-success'">{{ loc.available }}</p>
                          </div>
                          <div v-if="loc.in_transit > 0">
                            <p class="text-warning/80">In Transit</p>
                            <p class="font-semibold text-warning">{{ loc.in_transit }}</p>
                          </div>
                          <div v-if="loc.on_order > 0">
                            <p class="text-brown/80">On Order</p>
                            <p class="font-semibold text-brown">{{ loc.on_order }}</p>
                          </div>
                        </div>
                        <!-- Virtual location explanation chips -->
                        <div v-if="loc.location_type === 'virtual'" class="mt-2">
                          <span v-if="loc.location_code === 'READY-SHIP'" class="text-[10px] text-warning/70">
                            Picked &amp; packed — awaiting carrier
                          </span>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════
         LOCATIONS TAB
    ═══════════════════════════════════════════════════════ -->
    <div v-show="activeTab === 'locations'" class="space-y-4">
      <div class="card p-6">
        <div class="flex items-start justify-between mb-4">
          <div>
            <h2 class="text-lg font-semibold text-ink">Locations</h2>
            <p class="mt-1 text-sm text-muted">
              Physical and virtual places where stock lives.
              <span class="text-muted">Channel locks (Shopify, Amazon) are reservations — not locations.</span>
            </p>
          </div>
          <div class="flex gap-2">
            <button v-if="locations.length === 0" class="btn-secondary text-xs" @click="handleSeedLocations">
              Seed Defaults
            </button>
            <button class="btn-primary" @click="showLocationForm = !showLocationForm">
              {{ showLocationForm ? 'Cancel' : '+ New Location' }}
            </button>
          </div>
        </div>

        <!-- Create form -->
        <div v-if="showLocationForm" class="mb-6 rounded-lg border border-line bg-surface-sunken p-4 space-y-3">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label-field">Name *</label>
              <input v-model="newLocation.name" class="input-field" placeholder="e.g. Sydney Warehouse" />
            </div>
            <div>
              <label class="label-field">Code * (short ID)</label>
              <input v-model="newLocation.code" class="input-field" placeholder="e.g. WH-SYD" @input="newLocation.code = newLocation.code.toUpperCase().replace(/\s+/g, '-')" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label-field">Type</label>
              <select v-model="newLocation.location_type" class="input-field">
                <option value="warehouse">Warehouse</option>
                <option value="store">Store / Retail</option>
                <option value="in_transit">In Transit (virtual)</option>
                <option value="fba">Amazon FBA</option>
                <option value="3pl">3PL / Fulfilment Centre</option>
                <option value="damaged">Damaged / Quarantine</option>
                <option value="returns">Returns</option>
                <option value="virtual">Virtual / Other</option>
              </select>
            </div>
            <div class="flex items-end">
              <label class="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
                <input v-model="newLocation.is_default" type="checkbox" class="rounded" />
                Set as default pick location
              </label>
            </div>
          </div>
          <div>
            <label class="label-field">Notes</label>
            <textarea v-model="newLocation.notes" class="input-field" rows="2" />
          </div>
          <button class="btn-primary" :disabled="!newLocation.name.trim() || !newLocation.code.trim() || locationSaving" @click="handleCreateLocation">
            {{ locationSaving ? 'Creating…' : 'Create Location' }}
          </button>
        </div>

        <!-- Location list -->
        <div v-if="locations.length > 0" class="grid gap-3 sm:grid-cols-2">
          <div
            v-for="loc in locations" :key="loc.id"
            class="rounded-lg border border-line bg-surface-sunken/40 p-4"
          >
            <div class="flex items-start justify-between">
              <div>
                <div class="flex items-center gap-2">
                  <p class="font-medium text-ink">{{ loc.name }}</p>
                  <span v-if="loc.is_default" class="rounded-full bg-yellow-deep/10 px-2 py-0.5 text-[10px] font-medium text-brown">Default</span>
                </div>
                <p class="mt-0.5 font-mono text-xs text-muted">{{ loc.code }}</p>
              </div>
              <span :class="['rounded-full px-2.5 py-1 text-xs font-medium', locationTypeBadge(loc.location_type).cls]">
                {{ locationTypeBadge(loc.location_type).label }}
              </span>
            </div>
            <p v-if="loc.notes" class="mt-2 text-xs text-muted leading-relaxed">{{ loc.notes }}</p>

            <!-- Virtual location explanation -->
            <div v-if="loc.location_type === 'virtual' || loc.location_type === 'in_transit'" class="mt-2 rounded bg-white/60 px-3 py-2 text-xs text-muted">
              <span v-if="loc.code === 'READY-SHIP'">
                Stock here has been picked &amp; packed. It's still counted as <span class="text-ink">on hand</span> at this location until the carrier collects.
              </span>
              <span v-else-if="loc.code === 'IN-TRANSIT'">
                Stock here is physically en route. Appears in the <span class="text-warning">In Transit</span> column of the stock table.
              </span>
              <span v-else>
                Virtual locations hold stock logically — useful for channel staging or accounting.
              </span>
            </div>

            <div v-if="loc.location_type === 'warehouse' && loc.code === 'WH-MAIN'" class="mt-2 rounded bg-white/60 px-3 py-2 text-xs text-muted">
              Channel locks (Shopify reserved, Amazon allocated) appear as <span class="text-danger">Reserved</span> on this location's stock.
              <span class="text-success">Available = On Hand − Reserved.</span>
            </div>
          </div>
        </div>

        <p v-else class="py-8 text-center text-sm text-muted">
          No locations yet.
          <button class="text-brown hover:text-brown" @click="handleSeedLocations">Seed defaults</button>
          or create one above.
        </p>
      </div>

      <!-- Quantity model explainer -->
      <div class="card p-5">
        <h3 class="mb-3 text-sm font-semibold text-ink">How quantities work</h3>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
          <div class="rounded-lg border border-line p-3">
            <p class="font-semibold text-ink">On Hand</p>
            <p class="mt-1 text-muted">Physically present at a location. Includes stock that's reserved (locked).</p>
          </div>
          <div class="rounded-lg border border-red-900/40 bg-red-950/10 p-3">
            <p class="font-semibold text-danger">Reserved</p>
            <p class="mt-1 text-muted">Locked portion of on-hand stock. Examples: Shopify pending orders, Amazon channel allocation, manual holds.</p>
          </div>
          <div class="rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3">
            <p class="font-semibold text-success">Available to Sell (ATS)</p>
            <p class="mt-1 text-muted">= On Hand − Reserved. What you can actually sell right now across all channels.</p>
          </div>
          <div class="rounded-lg border border-amber-900/40 bg-amber-950/10 p-3">
            <p class="font-semibold text-warning">In Transit</p>
            <p class="mt-1 text-muted">Stock en route — either from a supplier PO marked as shipped, or a transfer between locations.</p>
          </div>
          <div class="rounded-lg border border-line bg-yellow-soft/40 p-3">
            <p class="font-semibold text-brown">On Order</p>
            <p class="mt-1 text-muted">Open PO lines confirmed with your supplier but not yet shipped.</p>
          </div>
          <div class="rounded-lg border border-line p-3">
            <p class="font-semibold text-ink">Total Owned</p>
            <p class="mt-1 text-muted">= On Hand + In Transit + On Order. Everything you own or expect to receive.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════
         PURCHASE ORDERS TAB
    ═══════════════════════════════════════════════════════ -->
    <div v-show="activeTab === 'purchase-orders'" class="space-y-4">
      <div class="card p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-semibold text-ink">Purchase Orders</h2>
            <p class="mt-1 text-sm text-muted">
              Warehouse inbound stock from suppliers. Confirm → mark shipped (ASN) → receive goods.
            </p>
            <p class="mt-2 text-xs text-muted">
              Looking for agent / decision-layer POs (MCP drafts, approvals)?
              <NuxtLink to="/actions" class="text-brown hover:underline">Open Actions →</NuxtLink>
            </p>
          </div>
          <button class="btn-primary" @click="showPoForm = !showPoForm">
            {{ showPoForm ? 'Cancel' : '+ New PO' }}
          </button>
        </div>

        <!-- Create PO form -->
        <div v-if="showPoForm" class="mb-6 rounded-lg border border-line bg-surface-sunken p-4 space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label-field">Supplier Name *</label>
              <input v-model="newPo.supplier_name" class="input-field" placeholder="e.g. Acme Wholesalers" />
            </div>
            <div>
              <label class="label-field">Supplier Reference</label>
              <input v-model="newPo.supplier_ref" class="input-field" placeholder="Their invoice / SO number" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label-field">Destination Location *</label>
              <select v-model="newPo.destination_location_id" class="input-field">
                <option value="" disabled>Select location…</option>
                <option v-for="loc in locations.filter(l => ['warehouse','store','3pl','fba'].includes(l.location_type))" :key="loc.id" :value="loc.id">
                  {{ loc.name }} ({{ loc.code }})
                </option>
              </select>
            </div>
            <div>
              <label class="label-field">Currency</label>
              <select v-model="newPo.currency" class="input-field">
                <option>USD</option><option>AUD</option><option>GBP</option><option>EUR</option>
              </select>
            </div>
          </div>

          <!-- Lines -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="label-field mb-0">Product Lines</label>
              <button class="text-xs text-brown hover:text-brown" @click="addPoLine">+ Add Line</button>
            </div>
            <div v-if="poLines.length === 0" class="rounded-lg border border-dashed border-line py-4 text-center text-xs text-muted">
              No lines yet. Click "+ Add Line".
            </div>
            <div class="space-y-2">
              <div v-for="(line, i) in poLines" :key="i" class="flex items-end gap-2">
                <div class="flex-1">
                  <label class="label-field">Product ID</label>
                  <input v-model="line.product_id" class="input-field font-mono text-xs" placeholder="product UUID" />
                </div>
                <div class="w-24">
                  <label class="label-field">Qty</label>
                  <input v-model.number="line.ordered_qty" type="number" min="1" class="input-field" />
                </div>
                <div class="w-28">
                  <label class="label-field">Unit Cost</label>
                  <input v-model.number="line.unit_cost" type="number" step="0.01" class="input-field" placeholder="0.00" />
                </div>
                <button class="mb-0.5 text-xs text-danger hover:text-danger" @click="removePoLine(i)">Remove</button>
              </div>
            </div>
          </div>

          <div>
            <label class="label-field">Notes</label>
            <textarea v-model="newPo.notes" class="input-field" rows="2" />
          </div>
          <button class="btn-primary" :disabled="!newPo.supplier_name.trim() || !newPo.destination_location_id || poSaving" @click="handleCreatePo">
            {{ poSaving ? 'Creating…' : 'Create Purchase Order' }}
          </button>
        </div>

        <!-- PO list -->
        <div v-if="purchaseOrders.length > 0" class="space-y-2">
          <div
            v-for="po in purchaseOrders" :key="po.id"
            class="rounded-lg border border-line px-4 py-3 hover:border-line transition-colors"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <p class="font-medium text-ink font-mono text-sm">{{ po.po_number }}</p>
                  <span :class="['rounded-full px-2.5 py-0.5 text-xs font-medium', poStatusBadge(po.status).cls]">
                    {{ poStatusBadge(po.status).label }}
                  </span>
                </div>
                <p class="mt-0.5 text-xs text-muted">
                  {{ po.supplier_name }}
                  <span v-if="po.supplier_ref" class="text-muted"> · {{ po.supplier_ref }}</span>
                  <span class="text-muted"> · {{ po.destination_name }}</span>
                </p>
                <p class="mt-0.5 text-xs text-muted">
                  {{ po.line_count }} line{{ po.line_count !== 1 ? 's' : '' }}
                  · {{ po.total_ordered }} ordered
                  · {{ po.total_received }} received
                  <span v-if="po.tracking_number" class="ml-2 text-warning/80">📦 {{ po.tracking_number }}</span>
                  <span v-if="po.expected_arrival" class="ml-2 text-muted">ETA {{ po.expected_arrival }}</span>
                </p>
              </div>

              <!-- Actions -->
              <div class="flex shrink-0 items-center gap-2 text-xs">
                <button
                  v-if="po.status === 'draft' || po.status === 'submitted'"
                  class="rounded px-2.5 py-1 bg-yellow-soft text-brown hover:bg-yellow/30 transition-colors"
                  @click="handleConfirmPo(po.id)"
                >Confirm</button>

                <button
                  v-if="po.status === 'confirmed'"
                  class="rounded px-2.5 py-1 bg-amber-600/20 text-warning hover:bg-amber-600/30 transition-colors"
                  @click="openShipModal(po)"
                >Mark Shipped</button>

                <button
                  v-if="po.status === 'in_transit' || po.status === 'partially_received'"
                  class="rounded px-2.5 py-1 bg-success-soft text-success hover:bg-emerald-600/30 transition-colors"
                  @click="openReceiveModal(po)"
                >Receive Goods</button>

                <button
                  v-if="!['received', 'cancelled'].includes(po.status)"
                  class="rounded px-2.5 py-1 text-danger hover:text-danger transition-colors"
                  @click="handleCancelPo(po.id)"
                >Cancel</button>
              </div>
            </div>
          </div>
        </div>
        <p v-else class="py-8 text-center text-sm text-muted">No purchase orders yet.</p>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════
         TRANSFERS TAB
    ═══════════════════════════════════════════════════════ -->
    <div v-show="activeTab === 'transfers'" class="space-y-4">
      <div class="card p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-semibold text-ink">Transfers</h2>
            <p class="mt-1 text-sm text-muted">Move stock between locations — e.g. warehouse → Ready to Ship, or warehouse → store.</p>
          </div>
          <button class="btn-primary" @click="showTransferForm = !showTransferForm">
            {{ showTransferForm ? 'Cancel' : '+ New Transfer' }}
          </button>
        </div>

        <!-- Create form -->
        <div v-if="showTransferForm" class="mb-6 rounded-lg border border-line bg-surface-sunken p-4 space-y-3">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label-field">From Location *</label>
              <select v-model="newTransfer.from_location_id" class="input-field">
                <option value="" disabled>Select…</option>
                <option v-for="loc in locations" :key="loc.id" :value="loc.id">{{ loc.name }} ({{ loc.code }})</option>
              </select>
            </div>
            <div>
              <label class="label-field">To Location *</label>
              <select v-model="newTransfer.to_location_id" class="input-field">
                <option value="" disabled>Select…</option>
                <option v-for="loc in locations.filter(l => l.id !== newTransfer.from_location_id)" :key="loc.id" :value="loc.id">{{ loc.name }} ({{ loc.code }})</option>
              </select>
            </div>
          </div>
          <div class="w-48">
            <label class="label-field">Expected Arrival</label>
            <input v-model="newTransfer.expected_arrival" type="date" class="input-field" />
          </div>
          <button
            class="btn-primary"
            :disabled="!newTransfer.from_location_id || !newTransfer.to_location_id || transferSaving"
            @click="handleCreateTransfer"
          >{{ transferSaving ? 'Creating…' : 'Create Transfer' }}</button>
        </div>

        <!-- Transfer list -->
        <div v-if="transfers.length > 0" class="space-y-2">
          <div
            v-for="tr in transfers" :key="tr.id"
            class="rounded-lg border border-line px-4 py-3 hover:border-line transition-colors"
          >
            <div class="flex items-start justify-between">
              <div>
                <div class="flex items-center gap-2">
                  <p class="font-medium text-ink font-mono text-sm">{{ tr.transfer_number }}</p>
                  <span :class="['rounded-full px-2.5 py-0.5 text-xs font-medium', transferStatusBadge(tr.status).cls]">
                    {{ transferStatusBadge(tr.status).label }}
                  </span>
                </div>
                <p class="mt-0.5 text-xs text-muted">
                  {{ tr.from_location_name }} → {{ tr.to_location_name }}
                  <span v-if="tr.tracking_number" class="ml-2 text-warning/80">📦 {{ tr.tracking_number }}</span>
                  <span v-if="tr.expected_arrival" class="ml-2 text-muted">ETA {{ tr.expected_arrival }}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
        <p v-else class="py-8 text-center text-sm text-muted">No transfers yet.</p>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════
         MODAL: Mark as Shipped
    ═══════════════════════════════════════════════════════ -->
    <Teleport to="body">
      <div v-if="shipModal" class="fixed inset-0 z-50 flex items-center justify-center bg-brown/40 p-4" @click.self="shipModal = null">
        <div class="w-full max-w-md rounded-xl border border-line bg-white p-6 shadow-2xl">
          <h3 class="text-lg font-semibold text-ink mb-1">Mark as Shipped</h3>
          <p class="text-sm text-muted mb-4">{{ shipModal.po_number }} — {{ shipModal.supplier_name }}</p>
          <p class="text-xs text-muted mb-4 rounded bg-amber-950/30 border border-amber-900/30 px-3 py-2 text-warning/80">
            This will move all unshipped quantities from <strong>On Order → In Transit</strong> at {{ shipModal.destination_name }}.
          </p>

          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label-field">Carrier</label>
                <input v-model="shipForm.carrier" class="input-field" placeholder="e.g. DHL, Maersk" />
              </div>
              <div>
                <label class="label-field">Tracking Number</label>
                <input v-model="shipForm.tracking_number" class="input-field" placeholder="Tracking / AWB" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label-field">Shipping Method</label>
                <select v-model="shipForm.shipping_method" class="input-field">
                  <option value="sea_freight">Sea Freight</option>
                  <option value="air_freight">Air Freight</option>
                  <option value="road">Road / Truck</option>
                  <option value="courier">Courier</option>
                  <option value="express">Express</option>
                </select>
              </div>
              <div>
                <label class="label-field">Expected Arrival</label>
                <input v-model="shipForm.expected_arrival" type="date" class="input-field" />
              </div>
            </div>
          </div>

          <div class="mt-5 flex justify-end gap-3">
            <button class="btn-secondary" @click="shipModal = null">Cancel</button>
            <button class="btn-primary" :disabled="shipSaving" @click="handleMarkShipped">
              {{ shipSaving ? 'Updating…' : 'Confirm — Mark In Transit' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ═══════════════════════════════════════════════════════
         MODAL: Receive Goods
    ═══════════════════════════════════════════════════════ -->
    <Teleport to="body">
      <div v-if="receiveModal" class="fixed inset-0 z-50 flex items-center justify-center bg-brown/40 p-4" @click.self="receiveModal = null">
        <div class="w-full max-w-2xl rounded-xl border border-line bg-white p-6 shadow-2xl">
          <h3 class="text-lg font-semibold text-ink mb-1">Receive Goods</h3>
          <p class="text-sm text-muted mb-1">{{ receiveModal.po_number }} — {{ receiveModal.supplier_name }}</p>
          <p class="text-xs text-muted mb-4 rounded bg-emerald-950/30 border border-emerald-900/30 px-3 py-2 text-success/80">
            Received quantities will move <strong>In Transit → On Hand</strong> at {{ receiveModal.destination_name }}.
            Adjust quantities for partial receipts.
          </p>

          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th class="pb-2 pr-4">Product</th>
                  <th class="pb-2 pr-4 text-right">Ordered</th>
                  <th class="pb-2 pr-4 text-right">Already Received</th>
                  <th class="pb-2 text-right">Receive Now</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="line in receiveLines" :key="line.id" class="border-b border-line">
                  <td class="py-2.5 pr-4">
                    <p class="text-ink font-medium">{{ line.product_title || line.product_id }}</p>
                    <p class="text-xs text-muted font-mono">{{ line.product_sku || '' }}</p>
                  </td>
                  <td class="py-2.5 pr-4 text-right text-ink-soft">{{ line.ordered_qty }}</td>
                  <td class="py-2.5 pr-4 text-right text-muted">{{ line.received_qty }}</td>
                  <td class="py-2.5 text-right">
                    <input
                      v-model.number="receiveQtys[line.id]"
                      type="number"
                      min="0"
                      :max="line.ordered_qty - line.received_qty"
                      class="input-field w-24 text-right"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mt-5 flex justify-end gap-3">
            <button class="btn-secondary" @click="receiveModal = null">Cancel</button>
            <button class="btn-primary" :disabled="receiveSaving" @click="handleReceiveGoods">
              {{ receiveSaving ? 'Processing…' : 'Confirm Receipt' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
