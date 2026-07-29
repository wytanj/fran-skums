<script setup lang="ts">
import type { AlertLevel, ForecastResult } from '~/types'

useHead({ title: 'Forecasting — SKUMS' })

const {
  reorderAlerts, expiryRisks, forecastEvents, demandVelocity,
  loading, error,
  loadReorderAlerts, loadExpiryRisks, loadForecastEvents, loadDemandVelocity,
  getAIForecast, pathHint,
  alertLevelColor, alertLevelLabel, dsrColor,
  criticalCount, overstockCount, expiryRiskCount, nextEvent,
} = useForecasting()

const { setContext, clearContext } = useAssistant()

const activeTab = ref<'reorder' | 'expiry' | 'events' | 'ai'>('reorder')
const tabs = [
  { key: 'reorder', label: 'Reorder Queue' },
  { key: 'expiry', label: 'Expiry Risk' },
  { key: 'events', label: 'SG Events' },
  { key: 'ai', label: 'AI Explain' },
]

// Shared fixed-position feedback (ToastHost) — see useActionFeedback.
const { notify, runAction, isPending } = useActionFeedback()
function showOk(msg: string) { notify.success(msg) }
function showErr(msg: unknown) { notify.error(typeof msg === 'string' ? new Error(msg) : msg) }

const reorderSearch = ref('')
const alertFilter = ref<AlertLevel | 'all'>('all')
const selectedIds = ref<string[]>([])

const alertFilterOptions: Array<{ value: AlertLevel | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'stockout', label: 'Stockout' },
  { value: 'critical', label: 'Critical' },
  { value: 'reorder_now', label: 'Reorder Now' },
  { value: 'watch', label: 'Watch' },
  { value: 'healthy', label: 'Healthy' },
  { value: 'overstock', label: 'Overstock' },
  { value: 'no_data', label: 'No Data' },
]

const filteredAlerts = computed(() => {
  let rows = reorderAlerts.value
  if (alertFilter.value !== 'all') rows = rows.filter(r => r.alert_level === alertFilter.value)
  if (reorderSearch.value) {
    const q = reorderSearch.value.toLowerCase()
    rows = rows.filter(r =>
      r.product_title?.toLowerCase().includes(q)
      || r.product_sku?.toLowerCase().includes(q),
    )
  }
  return rows
})

const allFilteredSelected = computed(() =>
  filteredAlerts.value.length > 0
  && filteredAlerts.value.every(r => selectedIds.value.includes(r.product_id)),
)

function toggleSelectAll() {
  if (allFilteredSelected.value) {
    const drop = new Set(filteredAlerts.value.map(r => r.product_id))
    selectedIds.value = selectedIds.value.filter(id => !drop.has(id))
  } else {
    const set = new Set(selectedIds.value)
    for (const r of filteredAlerts.value) set.add(r.product_id)
    selectedIds.value = [...set]
  }
}

function toggleSelect(id: string) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter(x => x !== id)
  } else {
    selectedIds.value = [...selectedIds.value, id]
  }
}

function pathBadge(path: string) {
  if (path === 'store_fill') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
  if (path === 'supplier_buy') return 'border-amber-500/40 bg-amber-500/10 text-amber-300'
  if (path === 'watch') return 'border-blue-500/40 bg-blue-500/10 text-blue-300'
  return 'border-gray-700 bg-gray-800 text-gray-500'
}

function pathLabel(path: string) {
  if (path === 'store_fill') return 'A · store fill'
  if (path === 'supplier_buy') return 'B · supplier'
  if (path === 'watch') return 'watch'
  return '—'
}

// ── AI Explain ───────────────────────────────────────────────
const selectedProductId = ref<string | null>(null)
const aiLoading = ref(false)
const aiForecast = ref<ForecastResult | null>(null)

const aiProductOptions = computed(() => {
  const fromAlerts = reorderAlerts.value
    .filter(a => a.daily_velocity > 0)
    .map(a => ({
      value: a.product_id,
      label: `${a.product_title}${a.product_sku ? ` · ${a.product_sku}` : ''}`,
    }))
  if (fromAlerts.length) return fromAlerts
  return demandVelocity.value
    .filter(d => d.best_velocity > 0)
    .map(d => ({
      value: d.product_id,
      label: `${d.product_title}${d.product_sku ? ` · ${d.product_sku}` : ''}`,
    }))
})

watch(selectedIds, (ids) => {
  if (ids.length === 1) selectedProductId.value = ids[0]
})

async function runAIForecast() {
  if (!selectedProductId.value) return
  aiLoading.value = true
  aiForecast.value = null
  try {
    aiForecast.value = await getAIForecast(selectedProductId.value)
    showOk('Explain run complete (suggest-only)')
  } catch (e: any) {
    showErr(e.message)
  } finally {
    aiLoading.value = false
  }
}

function confidenceColor(c: string) {
  if (c === 'high') return 'text-green-400 bg-green-500/10 border-green-500/30'
  if (c === 'medium') return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
  return 'text-gray-400 bg-gray-500/10 border-gray-500/30'
}

function riskColor(r: string) {
  if (r === 'at_risk') return 'text-red-400 bg-red-500/10 border-red-500/30'
  if (r === 'borderline') return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
  if (r === 'safe') return 'text-green-400 bg-green-500/10 border-green-500/30'
  return 'text-gray-400 bg-gray-500/10 border-gray-500/30'
}

function multiplierBarWidth(m: number) {
  return `${Math.min(((m - 1) / 2) * 100, 100)}%`
}

const statsCards = computed(() => [
  {
    label: 'Needs Action',
    value: criticalCount.value,
    sub: 'Stockout, critical, or reorder now',
    color: criticalCount.value > 0 ? 'text-red-400' : 'text-green-400',
  },
  {
    label: 'Overstock',
    value: overstockCount.value,
    sub: '>90 days of stock',
    color: overstockCount.value > 0 ? 'text-purple-400' : 'text-green-400',
  },
  {
    label: 'Expiry at Risk',
    value: expiryRiskCount.value,
    sub: 'May expire before sell-through',
    color: expiryRiskCount.value > 0 ? 'text-orange-400' : 'text-green-400',
  },
  {
    label: 'Next SG Event',
    value: nextEvent.value ? nextEvent.value.event_name : '—',
    sub: nextEvent.value
      ? `${nextEvent.value.date_from} · ${nextEvent.value.multiplier}×`
      : 'No upcoming events',
    color: 'text-indigo-400',
  },
])

onMounted(async () => {
  await Promise.all([
    loadDemandVelocity(),
    loadReorderAlerts(),
    loadExpiryRisks(),
    loadForecastEvents(),
  ])
  setContext(
    'forecasting',
    'index',
    {
      alerts: reorderAlerts.value.length,
      critical: criticalCount.value,
      selected: selectedIds.value.length,
    },
    'Demand Forecasting',
  )
})
onUnmounted(() => clearContext())
</script>

<template>
  <div class="w-full min-w-0">
    <!-- Header -->
    <div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        <h1 class="text-xl font-bold text-white sm:text-2xl">
          Demand Forecasting
        </h1>
        <p class="mt-1 max-w-2xl text-sm text-gray-400">
          Velocity floor from SKUMS views · path A/B hints · AI explain is suggest-only.
          Nightly truth lives in
          <NuxtLink to="/reports" class="text-indigo-400 hover:underline">Reports</NuxtLink>
          (Track K). Draft actions only — never auto FOB or Loft.
        </p>
      </div>
      <div class="flex shrink-0 flex-wrap gap-2">
        <NuxtLink to="/reports" class="btn-secondary text-sm">
          Open Reports
        </NuxtLink>
        <NuxtLink to="/help" class="btn-ghost text-sm text-gray-400">
          Help
        </NuxtLink>
      </div>
    </div>

    <!-- Overview -->
    <div class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div
        v-for="card in statsCards"
        :key="card.label"
        class="card p-4"
      >
        <p class="mb-1 text-xs uppercase tracking-wide text-gray-500">
          {{ card.label }}
        </p>
        <p class="truncate text-2xl font-bold" :class="card.color">
          {{ card.value }}
        </p>
        <p class="mt-1 truncate text-xs text-gray-500">
          {{ card.sub }}
        </p>
      </div>
    </div>

    <div
      v-if="!loading && reorderAlerts.length > 0 && reorderAlerts.every(a => a.daily_velocity === 0)"
      class="mb-6 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-300"
    >
      <span class="font-semibold">No sales velocity yet.</span>
      Connect POS/Shopify/Woo or import history via
      <NuxtLink to="/import-export" class="underline">Import / Export</NuxtLink>.
    </div>

    <div v-if="error" class="mb-4 card p-4 text-sm text-red-300">
      {{ error }}
    </div>

    <!-- Selection bar (FC-1 multi-select) -->
    <div
      v-if="selectedIds.length"
      class="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm"
    >
      <span class="font-medium text-indigo-200">{{ selectedIds.length }} selected</span>
      <button
        type="button"
        class="btn-secondary text-xs"
        @click="selectedProductId = selectedIds[0]; activeTab = 'ai'"
      >
        Explain first
      </button>
      <button type="button" class="btn-ghost text-xs text-gray-400" @click="selectedIds = []">
        Clear
      </button>
      <span class="text-xs text-gray-500">
        Path A/B draft actions land in FC-3 · loft split is exact in Reports Rpt-6
      </span>
    </div>

    <!-- Tabs -->
    <div class="mb-4 flex gap-1 overflow-x-auto border-b border-gray-800 pb-0">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="shrink-0 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors"
        :class="activeTab === tab.key
          ? 'border border-b-gray-950 border-gray-700 bg-gray-900 text-white'
          : 'text-gray-500 hover:text-gray-300'"
        @click="activeTab = tab.key as any"
      >
        {{ tab.label }}
        <span
          v-if="tab.key === 'reorder' && criticalCount > 0"
          class="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white"
        >{{ criticalCount }}</span>
        <span
          v-if="tab.key === 'expiry' && expiryRiskCount > 0"
          class="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[10px] text-white"
        >{{ expiryRiskCount }}</span>
      </button>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-indigo-500" />
    </div>

    <template v-else>
      <!-- Reorder -->
      <div v-if="activeTab === 'reorder'">
        <div class="mb-4 flex flex-col gap-3 sm:flex-row">
          <input
            v-model="reorderSearch"
            type="search"
            placeholder="Search products…"
            class="input-field flex-1"
          >
          <select v-model="alertFilter" class="input-field sm:w-48">
            <option v-for="opt in alertFilterOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="overflow-x-auto rounded-xl border border-gray-800">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-800 bg-gray-900/60">
                <th class="px-3 py-3 text-left">
                  <input
                    type="checkbox"
                    class="rounded border-gray-600"
                    :checked="allFilteredSelected"
                    :aria-label="'Select all filtered'"
                    @change="toggleSelectAll"
                  >
                </th>
                <th class="px-4 py-3 text-left font-medium text-gray-400">
                  Product
                </th>
                <th class="px-4 py-3 text-right font-medium text-gray-400">
                  Vel/day
                </th>
                <th class="px-4 py-3 text-right font-medium text-gray-400">
                  ATS
                </th>
                <th class="px-4 py-3 text-right font-medium text-gray-400">
                  Days left
                </th>
                <th class="px-4 py-3 text-right font-medium text-gray-400">
                  Suggest
                </th>
                <th class="px-4 py-3 font-medium text-gray-400">
                  Path
                </th>
                <th class="px-4 py-3 font-medium text-gray-400">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in filteredAlerts"
                :key="row.product_id"
                class="border-b border-gray-800/50 transition-colors hover:bg-gray-900/40"
                :class="selectedIds.includes(row.product_id) ? 'bg-indigo-500/5' : ''"
              >
                <td class="px-3 py-3">
                  <input
                    type="checkbox"
                    class="rounded border-gray-600"
                    :checked="selectedIds.includes(row.product_id)"
                    @change="toggleSelect(row.product_id)"
                  >
                </td>
                <td class="px-4 py-3">
                  <p class="max-w-[200px] truncate font-medium text-white">
                    {{ row.product_title }}
                  </p>
                  <p v-if="row.product_sku" class="text-xs text-gray-500">
                    {{ row.product_sku }}
                  </p>
                </td>
                <td class="px-4 py-3 text-right">
                  <span v-if="row.daily_velocity > 0" class="text-gray-200">{{ row.daily_velocity.toFixed(2) }}</span>
                  <span v-else class="text-gray-600">—</span>
                </td>
                <td class="px-4 py-3 text-right text-gray-200">
                  {{ row.available_to_sell.toLocaleString() }}
                </td>
                <td class="px-4 py-3 text-right">
                  <span
                    v-if="row.days_of_stock_remaining !== null"
                    class="font-semibold"
                    :class="dsrColor(row.days_of_stock_remaining)"
                  >{{ row.days_of_stock_remaining }}d</span>
                  <span v-else class="text-gray-600">—</span>
                </td>
                <td class="px-4 py-3 text-right">
                  <span v-if="row.suggested_order_qty" class="font-medium text-indigo-400">
                    {{ row.suggested_order_qty.toLocaleString() }}
                  </span>
                  <span v-else class="text-gray-600">—</span>
                </td>
                <td class="px-4 py-3">
                  <span
                    class="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                    :class="pathBadge(pathHint(row))"
                  >{{ pathLabel(pathHint(row)) }}</span>
                </td>
                <td class="px-4 py-3">
                  <span
                    class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
                    :class="alertLevelColor(row.alert_level)"
                  >{{ alertLevelLabel(row.alert_level) }}</span>
                </td>
              </tr>
              <tr v-if="filteredAlerts.length === 0">
                <td colspan="8" class="px-4 py-12 text-center text-sm text-gray-500">
                  No products match your filters.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="mt-3 text-xs text-gray-600">
          Path column is a client hint. Exact loft vs supplier split runs in
          <code class="text-gray-500">reorder.store_fill</code> /
          <code class="text-gray-500">reorder.supplier_buy</code> report sections.
        </p>
      </div>

      <!-- Expiry -->
      <div v-if="activeTab === 'expiry'">
        <div v-if="expiryRisks.length === 0" class="py-16 text-center text-sm text-gray-500">
          No expiry-tracked batches.
          <NuxtLink to="/expiry" class="text-indigo-400 hover:underline">Expiry Manager</NuxtLink>
        </div>
        <div v-else class="overflow-x-auto rounded-xl border border-gray-800">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-800 bg-gray-900/60">
                <th class="px-4 py-3 text-left font-medium text-gray-400">
                  Product
                </th>
                <th class="px-4 py-3 text-right font-medium text-gray-400">
                  Remaining
                </th>
                <th class="px-4 py-3 text-right font-medium text-gray-400">
                  Expires
                </th>
                <th class="px-4 py-3 text-right font-medium text-gray-400">
                  Days left
                </th>
                <th class="px-4 py-3 text-right font-medium text-gray-400">
                  Days to sell
                </th>
                <th class="px-4 py-3 font-medium text-gray-400">
                  Risk
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in expiryRisks"
                :key="row.item_id"
                class="border-b border-gray-800/50 hover:bg-gray-900/40"
              >
                <td class="px-4 py-3">
                  <p class="max-w-[200px] truncate font-medium text-white">
                    {{ row.product_title }}
                  </p>
                  <p v-if="row.product_sku" class="text-xs text-gray-500">
                    {{ row.product_sku }}
                  </p>
                </td>
                <td class="px-4 py-3 text-right text-gray-200">
                  {{ row.remaining_qty.toLocaleString() }}
                </td>
                <td class="px-4 py-3 text-right text-xs text-gray-400">
                  {{ row.expiry_date }}
                </td>
                <td class="px-4 py-3 text-right">
                  <span :class="row.days_until_expiry <= 30 ? 'text-red-400' : row.days_until_expiry <= 60 ? 'text-yellow-400' : 'text-gray-200'">
                    {{ row.days_until_expiry }}d
                  </span>
                </td>
                <td class="px-4 py-3 text-right">
                  <span v-if="row.days_to_sell_through !== null" class="text-gray-200">{{ row.days_to_sell_through }}d</span>
                  <span v-else class="text-gray-600">—</span>
                </td>
                <td class="px-4 py-3">
                  <span
                    class="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize"
                    :class="riskColor(row.risk_status)"
                  >{{ row.risk_status.replace('_', ' ') }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Events -->
      <div v-if="activeTab === 'events'">
        <p class="mb-4 text-sm text-gray-400">
          Singapore demand events (multipliers) used when explaining forecasts.
        </p>
        <div class="space-y-2">
          <div
            v-for="ev in forecastEvents"
            :key="ev.id"
            class="card flex items-center gap-4 px-4 py-3"
          >
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-white">
                {{ ev.event_name }}
              </p>
              <p class="mt-0.5 text-xs text-gray-500">
                {{ ev.date_from }} → {{ ev.date_to }}
                <span v-if="ev.notes" class="ml-2 text-gray-600">· {{ ev.notes }}</span>
              </p>
            </div>
            <div class="hidden w-32 sm:block">
              <div class="h-2 overflow-hidden rounded-full bg-gray-800">
                <div
                  class="h-full rounded-full bg-indigo-500"
                  :style="{ width: multiplierBarWidth(ev.multiplier) }"
                />
              </div>
            </div>
            <span class="w-12 shrink-0 text-right text-sm font-bold text-indigo-400">
              {{ ev.multiplier }}×
            </span>
          </div>
          <div v-if="forecastEvents.length === 0" class="py-12 text-center text-sm text-gray-500">
            No upcoming events.
          </div>
        </div>
      </div>

      <!-- AI Explain -->
      <div v-if="activeTab === 'ai'">
        <div class="card mb-6 p-5">
          <h3 class="mb-2 text-sm font-semibold text-white">
            AI explain (suggest-only)
          </h3>
          <p class="mb-4 text-xs text-gray-500">
            Uses structured velocity + events + expiry context. Numbers are advisory —
            not a TSFM and not an auto-buy. Prefer Reports for portfolio path A/B.
          </p>
          <div class="flex flex-col gap-3 sm:flex-row">
            <select
              v-model="selectedProductId"
              class="input-field flex-1"
            >
              <option :value="null" disabled>
                Select a product…
              </option>
              <option v-for="opt in aiProductOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
            <button
              type="button"
              class="btn-primary flex items-center gap-2"
              :disabled="!selectedProductId || aiLoading"
              @click="runAIForecast"
            >
              <div
                v-if="aiLoading"
                class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
              />
              <span>{{ aiLoading ? 'Running…' : 'Run explain' }}</span>
            </button>
          </div>
          <p v-if="aiProductOptions.length === 0" class="mt-2 text-xs text-gray-600">
            No products with velocity. Import sales first.
          </p>
        </div>

        <div v-if="aiForecast" class="space-y-4">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 class="text-lg font-bold text-white">
                {{ aiForecast.product_title }}
              </h3>
              <p class="mt-0.5 text-xs text-gray-500">
                {{ new Date(aiForecast.generated_at).toLocaleString() }} ·
                {{ aiForecast.data_maturity }} ·
                <span class="text-indigo-400/80">{{ aiForecast.method_used }}</span>
              </p>
            </div>
            <span
              class="inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize"
              :class="confidenceColor(aiForecast.confidence)"
            >
              {{ aiForecast.confidence }} confidence
            </span>
          </div>

          <div class="grid grid-cols-3 gap-3">
            <div class="card p-4 text-center">
              <p class="mb-1 text-xs text-gray-500">
                30-day
              </p>
              <p class="text-3xl font-bold text-white">
                {{ aiForecast.forecast_30d.toLocaleString() }}
              </p>
            </div>
            <div class="card p-4 text-center">
              <p class="mb-1 text-xs text-gray-500">
                60-day
              </p>
              <p class="text-3xl font-bold text-white">
                {{ aiForecast.forecast_60d.toLocaleString() }}
              </p>
            </div>
            <div class="card p-4 text-center">
              <p class="mb-1 text-xs text-gray-500">
                90-day
              </p>
              <p class="text-3xl font-bold text-white">
                {{ aiForecast.forecast_90d.toLocaleString() }}
              </p>
            </div>
          </div>

          <div class="card border-indigo-500/30 p-4">
            <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-indigo-400">
              Recommendation
            </p>
            <p class="text-sm text-gray-200">
              {{ aiForecast.recommendation }}
            </p>
          </div>

          <div v-if="aiForecast.event_impact" class="card p-4">
            <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Event impact
            </p>
            <p class="text-sm text-gray-300">
              {{ aiForecast.event_impact }}
            </p>
          </div>
        </div>

        <div v-else-if="!aiLoading" class="py-16 text-center text-sm text-gray-500">
          Select a product and run explain, or multi-select from the reorder queue.
        </div>
      </div>
    </template>
  </div>
</template>
