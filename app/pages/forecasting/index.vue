<script setup lang="ts">
import type { ReorderAlert, AlertLevel, ForecastResult } from '~/types'

definePageMeta({})
useHead({ title: 'Forecasting — SKUMS' })

const {
  reorderAlerts, expiryRisks, forecastEvents, forecastResult,
  loading, error,
  loadReorderAlerts, loadExpiryRisks, loadForecastEvents,
  getAIForecast,
  alertLevelColor, alertLevelLabel, dsrColor,
  criticalCount, overstockCount, expiryRiskCount, nextEvent,
} = useForecasting()

const { currentWorkspace } = useWorkspace()

// ── Tabs ───────────────────────────────────────────────────────
const activeTab = ref<'reorder' | 'expiry' | 'events' | 'ai'>('reorder')
const tabs = [
  { key: 'reorder', label: 'Reorder Queue' },
  { key: 'expiry',  label: 'Expiry Risk' },
  { key: 'events',  label: 'SG Events' },
  { key: 'ai',      label: 'AI Forecast' },
]

// ── Toast ─────────────────────────────────────────────────────
const toast = ref('')
const toastError = ref('')
function showOk(msg: string)  { toast.value = msg; toastError.value = ''; setTimeout(() => (toast.value = ''), 3500) }
function showErr(msg: string) { toastError.value = msg; toast.value = '' }

// ── Reorder Queue filters ─────────────────────────────────────
const reorderSearch = ref('')
const alertFilter = ref<AlertLevel | 'all'>('all')
const alertFilterOptions: Array<{ value: AlertLevel | 'all'; label: string }> = [
  { value: 'all',         label: 'All' },
  { value: 'stockout',    label: 'Stockout' },
  { value: 'critical',    label: 'Critical' },
  { value: 'reorder_now', label: 'Reorder Now' },
  { value: 'watch',       label: 'Watch' },
  { value: 'healthy',     label: 'Healthy' },
  { value: 'overstock',   label: 'Overstock' },
  { value: 'no_data',     label: 'No Data' },
]

const filteredAlerts = computed(() => {
  let rows = reorderAlerts.value
  if (alertFilter.value !== 'all') rows = rows.filter(r => r.alert_level === alertFilter.value)
  if (reorderSearch.value) {
    const q = reorderSearch.value.toLowerCase()
    rows = rows.filter(r =>
      r.product_title?.toLowerCase().includes(q) ||
      r.product_sku?.toLowerCase().includes(q)
    )
  }
  return rows
})

// ── AI Forecast ───────────────────────────────────────────────
const selectedProductId = ref<string | null>(null)
const aiLoading = ref(false)
const aiForecast = ref<ForecastResult | null>(null)

const aiProductOptions = computed(() =>
  reorderAlerts.value
    .filter(a => a.daily_velocity > 0)
    .map(a => ({ value: a.product_id, label: `${a.product_title}${a.product_sku ? ` · ${a.product_sku}` : ''}` }))
)

async function runAIForecast() {
  if (!selectedProductId.value) return
  aiLoading.value = true
  aiForecast.value = null
  try {
    aiForecast.value = await getAIForecast(selectedProductId.value)
    showOk('Forecast generated')
  } catch (e: any) {
    showErr(e.message)
  } finally {
    aiLoading.value = false
  }
}

// ── Confidence badge ──────────────────────────────────────────
function confidenceColor(c: string) {
  if (c === 'high')   return 'text-green-400 bg-green-500/10 border-green-500/30'
  if (c === 'medium') return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
  return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30'
}

// ── Risk badge ────────────────────────────────────────────────
function riskColor(r: string) {
  if (r === 'at_risk')    return 'text-red-400 bg-red-500/10 border-red-500/30'
  if (r === 'borderline') return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
  if (r === 'safe')       return 'text-green-400 bg-green-500/10 border-green-500/30'
  return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30'
}

// ── Multiplier bar width ──────────────────────────────────────
function multiplierBarWidth(m: number) {
  // 1.0 = 0%, 3.0 = 100%
  return `${Math.min(((m - 1) / 2) * 100, 100)}%`
}

// ── Overview stats ────────────────────────────────────────────
const statsCards = computed(() => [
  {
    label: 'Needs Action',
    value: criticalCount.value,
    sub: 'Stockout, critical, or reorder now',
    color: criticalCount.value > 0 ? 'text-red-400' : 'text-green-400',
  },
  {
    label: 'Overstock Alerts',
    value: overstockCount.value,
    sub: '>90 days of stock',
    color: overstockCount.value > 0 ? 'text-purple-400' : 'text-green-400',
  },
  {
    label: 'Expiry at Risk',
    value: expiryRiskCount.value,
    sub: 'Will expire before selling through',
    color: expiryRiskCount.value > 0 ? 'text-orange-400' : 'text-green-400',
  },
  {
    label: 'Next SG Event',
    value: nextEvent.value ? nextEvent.value.event_name : '—',
    sub: nextEvent.value ? `${nextEvent.value.date_from} · ${nextEvent.value.multiplier}× demand` : 'No upcoming events',
    color: 'text-blue-400',
    wide: true,
  },
])

// ── Load on mount ─────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([
    loadReorderAlerts(),
    loadExpiryRisks(),
    loadForecastEvents(),
  ])
})
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100">
    <!-- Toast -->
    <div v-if="toast" class="fixed top-4 right-4 z-50 bg-zinc-800 border border-zinc-700 text-green-400 text-sm px-4 py-2 rounded-lg shadow-lg">
      {{ toast }}
    </div>
    <div v-if="toastError" class="fixed top-4 right-4 z-50 bg-zinc-800 border border-red-500/40 text-red-400 text-sm px-4 py-2 rounded-lg shadow-lg">
      {{ toastError }}
    </div>

    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      <!-- Header -->
      <div class="mb-8">
        <h1 class="text-2xl font-bold text-zinc-100">Demand Forecasting</h1>
        <p class="text-sm text-zinc-400 mt-1">
          Stock velocity, reorder alerts, expiry risk, and AI-powered demand forecasts.
        </p>
      </div>

      <!-- Overview Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div
          v-for="card in statsCards"
          :key="card.label"
          class="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
          :class="card.wide ? 'lg:col-span-1' : ''"
        >
          <p class="text-xs text-zinc-500 uppercase tracking-wide mb-1">{{ card.label }}</p>
          <p class="text-2xl font-bold truncate" :class="card.color">{{ card.value }}</p>
          <p class="text-xs text-zinc-500 mt-1 truncate">{{ card.sub }}</p>
        </div>
      </div>

      <!-- No Sales Data Banner -->
      <div
        v-if="!loading && reorderAlerts.length > 0 && reorderAlerts.every(a => a.daily_velocity === 0)"
        class="mb-6 bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 text-sm text-blue-300"
      >
        <span class="font-semibold">No sales data yet.</span>
        Connect a Shopify or WooCommerce integration, or import historical sales via
        <NuxtLink to="/import-export" class="underline">Import / Export</NuxtLink>
        to enable velocity-based forecasting.
      </div>

      <!-- Tabs -->
      <div class="flex gap-1 mb-6 border-b border-zinc-800 pb-0">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors"
          :class="activeTab === tab.key
            ? 'bg-zinc-800 text-zinc-100 border border-b-zinc-800 border-zinc-700'
            : 'text-zinc-500 hover:text-zinc-300'"
          @click="activeTab = tab.key as any"
        >
          {{ tab.label }}
          <span
            v-if="tab.key === 'reorder' && criticalCount > 0"
            class="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-xs bg-red-500 text-white rounded-full"
          >{{ criticalCount }}</span>
          <span
            v-if="tab.key === 'expiry' && expiryRiskCount > 0"
            class="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-xs bg-orange-500 text-white rounded-full"
          >{{ expiryRiskCount }}</span>
        </button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center py-20">
        <div class="w-6 h-6 border-2 border-zinc-600 border-t-indigo-500 rounded-full animate-spin" />
      </div>

      <template v-else>

        <!-- ── REORDER QUEUE ───────────────────────────────────── -->
        <div v-if="activeTab === 'reorder'">
          <!-- Filters -->
          <div class="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              v-model="reorderSearch"
              type="text"
              placeholder="Search products…"
              class="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
            />
            <select
              v-model="alertFilter"
              class="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
            >
              <option v-for="opt in alertFilterOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>

          <!-- Table -->
          <div class="overflow-x-auto rounded-xl border border-zinc-800">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-zinc-800 bg-zinc-900/60">
                  <th class="text-left px-4 py-3 text-zinc-400 font-medium">Product</th>
                  <th class="text-right px-4 py-3 text-zinc-400 font-medium">Velocity/day</th>
                  <th class="text-right px-4 py-3 text-zinc-400 font-medium">Available</th>
                  <th class="text-right px-4 py-3 text-zinc-400 font-medium">Days Left</th>
                  <th class="text-right px-4 py-3 text-zinc-400 font-medium">On Order</th>
                  <th class="text-right px-4 py-3 text-zinc-400 font-medium">Suggest Qty</th>
                  <th class="px-4 py-3 text-zinc-400 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in filteredAlerts"
                  :key="row.product_id"
                  class="border-b border-zinc-800/50 hover:bg-zinc-900/40 transition-colors"
                >
                  <td class="px-4 py-3">
                    <p class="font-medium text-zinc-100 truncate max-w-[180px]">{{ row.product_title }}</p>
                    <p v-if="row.product_sku" class="text-xs text-zinc-500">{{ row.product_sku }}</p>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <span v-if="row.daily_velocity > 0" class="text-zinc-200">{{ row.daily_velocity.toFixed(2) }}</span>
                    <span v-else class="text-zinc-600">—</span>
                  </td>
                  <td class="px-4 py-3 text-right text-zinc-200">{{ row.available_to_sell.toLocaleString() }}</td>
                  <td class="px-4 py-3 text-right">
                    <span
                      v-if="row.days_of_stock_remaining !== null"
                      class="font-semibold"
                      :class="dsrColor(row.days_of_stock_remaining)"
                    >{{ row.days_of_stock_remaining }}d</span>
                    <span v-else class="text-zinc-600">—</span>
                  </td>
                  <td class="px-4 py-3 text-right text-zinc-400">{{ row.total_on_order.toLocaleString() }}</td>
                  <td class="px-4 py-3 text-right">
                    <span v-if="row.suggested_order_qty" class="text-indigo-400 font-medium">
                      {{ row.suggested_order_qty.toLocaleString() }}
                    </span>
                    <span v-else class="text-zinc-600">—</span>
                  </td>
                  <td class="px-4 py-3">
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border"
                      :class="alertLevelColor(row.alert_level)"
                    >{{ alertLevelLabel(row.alert_level) }}</span>
                  </td>
                </tr>
                <tr v-if="filteredAlerts.length === 0">
                  <td colspan="7" class="px-4 py-12 text-center text-zinc-500 text-sm">
                    No products match your filters.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p class="text-xs text-zinc-600 mt-3">
            Velocity based on 30-day rolling average. Lead time derived from historical purchase order data (14-day fallback).
          </p>
        </div>

        <!-- ── EXPIRY RISK ──────────────────────────────────────── -->
        <div v-if="activeTab === 'expiry'">
          <div v-if="expiryRisks.length === 0" class="text-center py-16 text-zinc-500 text-sm">
            No expiry-tracked batches. Add batch expiry data in
            <NuxtLink to="/expiry" class="text-indigo-400 hover:underline">Expiry Manager</NuxtLink>.
          </div>
          <div v-else class="overflow-x-auto rounded-xl border border-zinc-800">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-zinc-800 bg-zinc-900/60">
                  <th class="text-left px-4 py-3 text-zinc-400 font-medium">Product</th>
                  <th class="text-right px-4 py-3 text-zinc-400 font-medium">Remaining</th>
                  <th class="text-right px-4 py-3 text-zinc-400 font-medium">Expires</th>
                  <th class="text-right px-4 py-3 text-zinc-400 font-medium">Days Left</th>
                  <th class="text-right px-4 py-3 text-zinc-400 font-medium">Days to Sell</th>
                  <th class="px-4 py-3 text-zinc-400 font-medium">Risk</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in expiryRisks"
                  :key="row.item_id"
                  class="border-b border-zinc-800/50 hover:bg-zinc-900/40 transition-colors"
                >
                  <td class="px-4 py-3">
                    <p class="font-medium text-zinc-100 truncate max-w-[180px]">{{ row.product_title }}</p>
                    <p v-if="row.product_sku" class="text-xs text-zinc-500">{{ row.product_sku }}</p>
                  </td>
                  <td class="px-4 py-3 text-right text-zinc-200">{{ row.remaining_qty.toLocaleString() }}</td>
                  <td class="px-4 py-3 text-right text-zinc-400 text-xs">{{ row.expiry_date }}</td>
                  <td class="px-4 py-3 text-right">
                    <span :class="row.days_until_expiry <= 30 ? 'text-red-400' : row.days_until_expiry <= 60 ? 'text-yellow-400' : 'text-zinc-200'">
                      {{ row.days_until_expiry }}d
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <span v-if="row.days_to_sell_through !== null" class="text-zinc-200">{{ row.days_to_sell_through }}d</span>
                    <span v-else class="text-zinc-600">—</span>
                  </td>
                  <td class="px-4 py-3">
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize"
                      :class="riskColor(row.risk_status)"
                    >{{ row.risk_status.replace('_', ' ') }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p class="text-xs text-zinc-600 mt-3">
            "At Risk" = batch will expire before projected sell-through at current demand velocity.
            Consider activating a microsite promotion or discount.
          </p>
        </div>

        <!-- ── SG EVENTS CALENDAR ──────────────────────────────── -->
        <div v-if="activeTab === 'events'">
          <p class="text-sm text-zinc-400 mb-4">
            Singapore demand events used to adjust AI forecasts. Multiplier = expected demand vs baseline (e.g. 2.5× = 250%).
          </p>
          <div class="space-y-2">
            <div
              v-for="ev in forecastEvents"
              :key="ev.id"
              class="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-center gap-4"
            >
              <div class="flex-1 min-w-0">
                <p class="font-medium text-zinc-100 text-sm">{{ ev.event_name }}</p>
                <p class="text-xs text-zinc-500 mt-0.5">
                  {{ ev.date_from }} → {{ ev.date_to }}
                  <span v-if="ev.notes" class="ml-2 text-zinc-600">· {{ ev.notes }}</span>
                </p>
              </div>
              <!-- Multiplier bar -->
              <div class="w-32 hidden sm:block">
                <div class="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    class="h-full bg-indigo-500 rounded-full transition-all"
                    :style="{ width: multiplierBarWidth(ev.multiplier) }"
                  />
                </div>
              </div>
              <span class="text-sm font-bold text-indigo-400 w-12 text-right shrink-0">
                {{ ev.multiplier }}×
              </span>
            </div>
            <div v-if="forecastEvents.length === 0" class="text-center py-12 text-zinc-500 text-sm">
              No upcoming events found.
            </div>
          </div>
        </div>

        <!-- ── AI FORECAST ─────────────────────────────────────── -->
        <div v-if="activeTab === 'ai'">
          <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-6">
            <h3 class="text-sm font-semibold text-zinc-200 mb-3">Generate AI Forecast</h3>
            <p class="text-xs text-zinc-500 mb-4">
              Uses Grok to generate a 30/60/90-day demand forecast incorporating current velocity,
              Singapore event calendar, expiry risk, and lead times. Requires sales history.
            </p>
            <div class="flex flex-col sm:flex-row gap-3">
              <select
                v-model="selectedProductId"
                class="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="" disabled>Select a product…</option>
                <option v-for="opt in aiProductOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
              <button
                :disabled="!selectedProductId || aiLoading"
                class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                @click="runAIForecast"
              >
                <div v-if="aiLoading" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>{{ aiLoading ? 'Generating…' : 'Run Forecast' }}</span>
              </button>
            </div>
            <p v-if="aiProductOptions.length === 0" class="text-xs text-zinc-600 mt-2">
              No products with sales velocity available. Import sales history first.
            </p>
          </div>

          <!-- Forecast Result -->
          <div v-if="aiForecast" class="space-y-4">
            <!-- Header row -->
            <div class="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 class="text-lg font-bold text-zinc-100">{{ aiForecast.product_title }}</h3>
                <p class="text-xs text-zinc-500 mt-0.5">
                  Generated {{ new Date(aiForecast.generated_at).toLocaleString() }} ·
                  {{ aiForecast.data_maturity }} data ·
                  <span class="text-indigo-400/70">{{ aiForecast.method_used }}</span>
                </p>
              </div>
              <span
                class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border capitalize"
                :class="confidenceColor(aiForecast.confidence)"
              >
                {{ aiForecast.confidence }} confidence
              </span>
            </div>

            <!-- Forecast numbers -->
            <div class="grid grid-cols-3 gap-3">
              <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
                <p class="text-xs text-zinc-500 mb-1">30-day forecast</p>
                <p class="text-3xl font-bold text-zinc-100">{{ aiForecast.forecast_30d.toLocaleString() }}</p>
                <p class="text-xs text-zinc-600 mt-1">units</p>
              </div>
              <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
                <p class="text-xs text-zinc-500 mb-1">60-day forecast</p>
                <p class="text-3xl font-bold text-zinc-100">{{ aiForecast.forecast_60d.toLocaleString() }}</p>
                <p class="text-xs text-zinc-600 mt-1">units</p>
              </div>
              <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
                <p class="text-xs text-zinc-500 mb-1">90-day forecast</p>
                <p class="text-3xl font-bold text-zinc-100">{{ aiForecast.forecast_90d.toLocaleString() }}</p>
                <p class="text-xs text-zinc-600 mt-1">units</p>
              </div>
            </div>

            <!-- Current velocity -->
            <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
              <div>
                <p class="text-xs text-zinc-500">Current velocity</p>
                <p class="text-xl font-bold text-indigo-400">{{ aiForecast.current_velocity.toFixed(2) }} <span class="text-sm font-normal text-zinc-500">units/day</span></p>
              </div>
            </div>

            <!-- Recommendation -->
            <div class="bg-zinc-900 border border-indigo-500/30 rounded-xl p-4">
              <p class="text-xs text-indigo-400 uppercase tracking-wide font-semibold mb-1">Recommendation</p>
              <p class="text-sm text-zinc-200">{{ aiForecast.recommendation }}</p>
            </div>

            <!-- Event impact -->
            <div v-if="aiForecast.event_impact" class="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p class="text-xs text-zinc-500 uppercase tracking-wide font-semibold mb-1">Event Impact</p>
              <p class="text-sm text-zinc-300">{{ aiForecast.event_impact }}</p>
            </div>

            <!-- Upcoming events used -->
            <div v-if="aiForecast.upcoming_events?.length" class="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p class="text-xs text-zinc-500 uppercase tracking-wide font-semibold mb-2">Events in Forecast Window</p>
              <div class="space-y-1">
                <div
                  v-for="ev in aiForecast.upcoming_events"
                  :key="ev.event_name"
                  class="flex items-center justify-between text-sm"
                >
                  <span class="text-zinc-300">{{ ev.event_name }}</span>
                  <span class="text-indigo-400 font-medium">{{ ev.multiplier }}×</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Empty state -->
          <div v-else-if="!aiLoading" class="text-center py-16 text-zinc-500 text-sm">
            Select a product and click "Run Forecast" to generate an AI-powered demand forecast.
          </div>
        </div>

      </template>
    </div>
  </div>
</template>
