<script setup lang="ts">
import type { Product } from '~/types'

const {
  analyses,
  selectedAnalysis,
  selectedSnapshots,
  priceHistory,
  queueItems,
  loading,
  analysing,
  error,
  loadAnalyses,
  loadAnalysis,
  analyseProduct,
  loadPriceHistory,
  loadQueueStatus,
  isQueued,
  scoreColor,
  scoreBg,
  positionLabel,
  positionBadgeClass,
  priceBadgeClass,
  marketplaceLabel,
  marketplaceBadge,
  dataSourceBadge,
  timeAgo,
  formatCurrency,
} = useProductQuality()

const {
  paying,
  paymentError,
  walletConnected,
  walletAddress,
  hasWallet,
  connectWallet,
  payForInstantScan,
  payForBulkScan,
} = useX402()

const client = useSupabaseClient()
const { currentWorkspace } = useWorkspace()

// ── Product search for analyse modal ─────────────────────────
const showModal = ref(false)
const productSearch = ref('')
const productResults = ref<Product[]>([])
const selectedProduct = ref<Product | null>(null)
const searchLoading = ref(false)
const priceHistoryDays = ref<number | undefined>(30)

async function searchProducts() {
  if (!currentWorkspace.value?.id || productSearch.value.trim().length < 2) {
    productResults.value = []
    return
  }
  searchLoading.value = true
  const { data } = await client
    .from('products')
    .select('id, title, sku, ean, asin, retail_price, currency, brand:brand_id(name), category:category_id(name)')
    .eq('workspace_id', currentWorkspace.value.id)
    .or(`title.ilike.%${productSearch.value}%,sku.ilike.%${productSearch.value}%`)
    .limit(10)
  productResults.value = (data ?? []) as any[]
  searchLoading.value = false
}

watch(productSearch, () => searchProducts())

function selectProduct(p: Product) {
  selectedProduct.value = p
  productSearch.value = (p as any).title
  productResults.value = []
}

async function runFreeAnalysis() {
  if (!selectedProduct.value) return
  const p = selectedProduct.value as any
  showModal.value = false
  productSearch.value = ''
  selectedProduct.value = null

  await analyseProduct({
    product_id: p.id,
    product_title: p.title,
    brand_name: p.brand?.name ?? null,
    category_name: p.category?.name ?? null,
    ean: p.ean ?? null,
    asin: p.asin ?? null,
    retail_price: p.retail_price ?? null,
    currency: p.currency ?? 'SGD',
  })
}

async function runInstantScan() {
  if (!selectedProduct.value || !currentWorkspace.value?.id) return
  const p = selectedProduct.value as any
  showModal.value = false
  productSearch.value = ''
  selectedProduct.value = null

  analysing.value = true
  const result = await payForInstantScan({
    product_id: p.id,
    workspace_id: currentWorkspace.value.id,
    product_title: p.title,
    brand_name: p.brand?.name ?? null,
    category_name: p.category?.name ?? null,
    ean: p.ean ?? null,
    asin: p.asin ?? null,
    retail_price: p.retail_price ?? null,
    currency: p.currency ?? 'SGD',
  })
  analysing.value = false

  if (result) {
    await loadAnalyses()
    await loadAnalysis(p.id)
  }
}

// ── Detail panel ──────────────────────────────────────────────
const detailProductId = ref<string | null>(null)

async function openDetail(productId: string) {
  detailProductId.value = productId
  await loadAnalysis(productId)
  await loadPriceHistory(productId, priceHistoryDays.value)
}

function closeDetail() {
  detailProductId.value = null
}

// ── Summary stats ─────────────────────────────────────────────
const totalAnalysed = computed(() => analyses.value.length)
const avgScore = computed(() => {
  const valid = analyses.value.filter(a => a.overall_score !== null)
  if (!valid.length) return null
  return Math.round(valid.reduce((s, a) => s + (a.overall_score ?? 0), 0) / valid.length)
})
const leadersCount = computed(() =>
  analyses.value.filter(a => a.competitive_position === 'market_leader' || a.competitive_position === 'competitive').length
)
const atRiskCount = computed(() =>
  analyses.value.filter(a => a.competitive_position === 'at_risk' || a.competitive_position === 'lagging').length
)

// ── Price history grouped by marketplace ─────────────────────
const priceHistoryByMarketplace = computed(() => {
  const grouped: Record<string, { date: string; price: number; data_source: string }[]> = {}
  for (const entry of priceHistory.value) {
    if (!grouped[entry.marketplace]) grouped[entry.marketplace] = []
    grouped[entry.marketplace].push({
      date: entry.crawled_at,
      price: entry.price,
      data_source: entry.data_source,
    })
  }
  return grouped
})

// Price trend for a marketplace (latest vs previous)
function priceTrend(marketplace: string): { direction: 'up' | 'down' | 'flat'; delta: number } | null {
  const entries = priceHistoryByMarketplace.value[marketplace]
  if (!entries || entries.length < 2) return null
  const latest = entries[entries.length - 1].price
  const previous = entries[entries.length - 2].price
  const delta = latest - previous
  if (Math.abs(delta) < 0.01) return { direction: 'flat', delta: 0 }
  return { direction: delta > 0 ? 'up' : 'down', delta }
}

// ── Star rating renderer ──────────────────────────────────────
function stars(rating: number | null): string {
  if (rating === null) return '—'
  const full = Math.floor(rating)
  return '★'.repeat(full) + '☆'.repeat(5 - full) + ` ${rating.toFixed(1)}`
}

onMounted(async () => {
  await loadAnalyses()
  await loadQueueStatus()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="border-b border-line bg-white px-6 py-4">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-ink">Product Quality</h1>
          <p class="mt-0.5 text-sm text-muted">
            Competitive intelligence across Shopee, Lazada, Sephora, Hwahae, Olive Young &amp; more
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="btn-primary flex items-center gap-2"
            @click="showModal = true"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 15.803a7.5 7.5 0 0 0 10.607 0Z" />
            </svg>
            Analyse Product
          </button>
        </div>
      </div>
    </div>

    <!-- Analysing overlay -->
    <div
      v-if="analysing"
      class="border-b border-line bg-yellow-deep/10 px-6 py-3"
    >
      <div class="flex items-center gap-3 text-brown text-sm">
        <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
        </svg>
        Analysing product across marketplaces...
      </div>
    </div>

    <!-- Payment error (hidden until x402 is enabled) -->
    <!-- <div v-if="paymentError" class="border-b border-danger/30 bg-danger-soft px-6 py-3 text-sm text-danger flex items-center justify-between">
      <span>{{ paymentError }}</span>
      <button class="text-danger hover:text-ink text-xs underline" @click="paymentError = null">Dismiss</button>
    </div> -->

    <!-- Error -->
    <div v-if="error" class="border-b border-danger/30 bg-danger-soft px-6 py-3 text-sm text-danger">
      {{ error }}
    </div>

    <div class="flex flex-1 overflow-hidden">
      <!-- Left: list panel -->
      <div class="flex w-full flex-col overflow-hidden" :class="detailProductId ? 'hidden lg:flex lg:w-96 lg:border-r lg:border-line' : ''">

        <!-- Summary cards -->
        <div class="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <div class="rounded-lg border border-line bg-surface-sunken p-3">
            <div class="text-xs text-muted">Analysed</div>
            <div class="mt-1 text-2xl font-bold text-ink">{{ totalAnalysed }}</div>
          </div>
          <div class="rounded-lg border border-line bg-surface-sunken p-3">
            <div class="text-xs text-muted">Avg Score</div>
            <div class="mt-1 text-2xl font-bold" :class="scoreColor(avgScore)">
              {{ avgScore ?? '—' }}
            </div>
          </div>
          <div class="rounded-lg border border-line bg-surface-sunken p-3">
            <div class="text-xs text-muted">Competitive+</div>
            <div class="mt-1 text-2xl font-bold text-success">{{ leadersCount }}</div>
          </div>
          <div class="rounded-lg border border-line bg-surface-sunken p-3">
            <div class="text-xs text-muted">At Risk</div>
            <div class="mt-1 text-2xl font-bold text-danger">{{ atRiskCount }}</div>
          </div>
        </div>

        <!-- Table -->
        <div class="flex-1 overflow-y-auto px-4 pb-4">
          <!-- Empty state -->
          <div v-if="!loading && analyses.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
            <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-sunken">
              <svg class="h-8 w-8 text-muted" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.563.563 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
              </svg>
            </div>
            <p class="text-sm font-medium text-muted">No analyses yet</p>
            <p class="mt-1 text-xs text-muted">Click "Analyse Product" to start competitive research</p>
          </div>

          <!-- Loader -->
          <div v-else-if="loading" class="space-y-2 pt-2">
            <div v-for="i in 5" :key="i" class="h-14 animate-pulse rounded-lg bg-surface-sunken" />
          </div>

          <!-- Product list -->
          <div v-else class="space-y-2 pt-2">
            <button
              v-for="a in analyses"
              :key="a.id"
              class="w-full rounded-lg border bg-surface-sunken p-3 text-left transition-all hover:bg-surface-sunken"
              :class="detailProductId === a.product_id ? 'border-yellow-deep bg-yellow-soft/40' : 'border-line'"
              @click="openDetail(a.product_id)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-ink">{{ a.product_title ?? a.product_id }}</p>
                  <div class="mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
                      :class="positionBadgeClass(a.competitive_position)"
                    >
                      {{ positionLabel(a.competitive_position) }}
                    </span>
                    <span
                      v-if="a.price_position"
                      class="inline-flex items-center rounded px-1.5 py-0.5 text-xs"
                      :class="priceBadgeClass(a.price_position)"
                    >
                      {{ a.price_position }}
                    </span>
                    <!-- Queue status badge -->
                    <span
                      v-if="isQueued(a.product_id)"
                      class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                    >
                      <svg class="h-2.5 w-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
                      </svg>
                      Queued
                    </span>
                    <span class="text-xs text-muted">{{ timeAgo(a.analysed_at) }}</span>
                  </div>
                </div>
                <div class="shrink-0 text-right">
                  <div class="text-xl font-bold leading-none" :class="scoreColor(a.overall_score)">
                    {{ a.overall_score !== null ? Math.round(a.overall_score) : '—' }}
                  </div>
                  <div class="mt-0.5 text-xs text-muted">/ 100</div>
                </div>
              </div>
              <div v-if="a.sources_checked?.length" class="mt-2 flex flex-wrap gap-1">
                <span
                  v-for="src in a.sources_checked"
                  :key="src"
                  class="rounded px-1.5 py-0.5 text-xs"
                  :class="marketplaceBadge(src)"
                >
                  {{ marketplaceLabel(src) }}
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- Right: detail panel -->
      <div v-if="detailProductId" class="flex flex-1 flex-col overflow-hidden">
        <div v-if="loading" class="flex flex-1 items-center justify-center">
          <svg class="h-8 w-8 animate-spin text-brown" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
          </svg>
        </div>

        <template v-else-if="selectedAnalysis">
          <!-- Detail header -->
          <div class="flex items-center justify-between border-b border-line px-6 py-4">
            <div>
              <h2 class="text-base font-semibold text-ink">{{ selectedAnalysis.product_title ?? 'Product Detail' }}</h2>
              <p class="text-xs text-muted">Last analysed {{ timeAgo(selectedAnalysis.analysed_at) }}</p>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="btn-secondary text-xs"
                :disabled="analysing"
                @click="() => {
                  const a = selectedAnalysis
                  if (a) analyseProduct({ product_id: a.product_id, product_title: a.product_title ?? '' })
                }"
              >
                Re-analyse (Free)
              </button>
              <button class="text-muted hover:text-ink lg:hidden" @click="closeDetail">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-6 space-y-6">
            <!-- Score cards -->
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div
                v-for="{ label, value } in [
                  { label: 'Overall', value: selectedAnalysis.overall_score },
                  { label: 'Reviews', value: selectedAnalysis.review_score },
                  { label: 'Price', value: selectedAnalysis.price_score },
                  { label: 'Availability', value: selectedAnalysis.availability_score },
                ]"
                :key="label"
                class="rounded-lg border p-3"
                :class="scoreBg(value)"
              >
                <div class="text-xs text-muted">{{ label }}</div>
                <div class="mt-1 text-2xl font-bold" :class="scoreColor(value)">
                  {{ value !== null ? Math.round(value as number) : '—' }}
                </div>
                <div class="mt-0.5 text-xs text-muted">/ 100</div>
              </div>
            </div>

            <!-- Position badges -->
            <div class="flex flex-wrap gap-2">
              <span
                class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium"
                :class="positionBadgeClass(selectedAnalysis.competitive_position)"
              >
                {{ positionLabel(selectedAnalysis.competitive_position) }}
              </span>
              <span
                v-if="selectedAnalysis.price_position"
                class="inline-flex items-center rounded-full px-3 py-1 text-sm"
                :class="priceBadgeClass(selectedAnalysis.price_position)"
              >
                Price: {{ selectedAnalysis.price_position }}
              </span>
            </div>

            <!-- AI Summary -->
            <div v-if="selectedAnalysis.ai_summary" class="rounded-lg border border-line bg-surface-sunken p-4">
              <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">AI Assessment</h3>
              <p class="text-sm text-ink-soft leading-relaxed">{{ selectedAnalysis.ai_summary }}</p>
            </div>

            <!-- Marketplace comparison table -->
            <div v-if="selectedSnapshots.length">
              <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Marketplace Data</h3>
              <div class="overflow-x-auto rounded-lg border border-line">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-line bg-surface-sunken/80">
                      <th class="px-3 py-2.5 text-left text-xs font-medium text-muted">Platform</th>
                      <th class="px-3 py-2.5 text-right text-xs font-medium text-muted">Price</th>
                      <th class="px-3 py-2.5 text-right text-xs font-medium text-muted">Rating</th>
                      <th class="px-3 py-2.5 text-right text-xs font-medium text-muted">Reviews</th>
                      <th class="px-3 py-2.5 text-right text-xs font-medium text-muted">Sold</th>
                      <th class="px-3 py-2.5 text-center text-xs font-medium text-muted">Stock</th>
                      <th class="px-3 py-2.5 text-center text-xs font-medium text-muted">Source</th>
                      <th class="px-3 py-2.5 text-center text-xs font-medium text-muted">Link</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-700/50">
                    <tr v-for="snap in selectedSnapshots" :key="snap.id" class="hover:bg-surface-sunken/60">
                      <td class="px-3 py-3">
                        <div class="flex items-center gap-2">
                          <span
                            class="inline-flex rounded px-1.5 py-0.5 text-xs"
                            :class="marketplaceBadge(snap.marketplace)"
                          >
                            {{ marketplaceLabel(snap.marketplace) }}
                          </span>
                          <span v-if="!snap.found" class="text-xs text-muted">not found</span>
                        </div>
                        <div v-if="snap.seller_name" class="mt-0.5 truncate text-xs text-muted max-w-[120px]">
                          {{ snap.seller_name }}
                        </div>
                      </td>
                      <td class="px-3 py-3 text-right">
                        <div v-if="snap.price" class="flex items-center justify-end gap-1.5">
                          <span class="font-medium text-ink">
                            {{ snap.currency }} {{ Number(snap.price).toFixed(2) }}
                          </span>
                          <!-- Price trend arrow -->
                          <template v-if="priceTrend(snap.marketplace)">
                            <span
                              v-if="priceTrend(snap.marketplace)!.direction === 'up'"
                              class="text-xs text-danger"
                              :title="`+${priceTrend(snap.marketplace)!.delta.toFixed(2)}`"
                            >
                              ↑
                            </span>
                            <span
                              v-else-if="priceTrend(snap.marketplace)!.direction === 'down'"
                              class="text-xs text-success"
                              :title="`${priceTrend(snap.marketplace)!.delta.toFixed(2)}`"
                            >
                              ↓
                            </span>
                          </template>
                        </div>
                        <span v-else class="text-muted">—</span>
                      </td>
                      <td class="px-3 py-3 text-right">
                        <span v-if="snap.rating" class="text-warning">
                          {{ Number(snap.rating).toFixed(1) }}★
                        </span>
                        <span v-else class="text-muted">—</span>
                      </td>
                      <td class="px-3 py-3 text-right">
                        <span v-if="snap.review_count" class="text-ink-soft">
                          {{ snap.review_count >= 1000
                            ? (snap.review_count / 1000).toFixed(1) + 'k'
                            : snap.review_count }}
                        </span>
                        <span v-else class="text-muted">—</span>
                      </td>
                      <td class="px-3 py-3 text-right text-ink-soft text-xs">
                        {{ snap.units_sold_label ?? '—' }}
                      </td>
                      <td class="px-3 py-3 text-center">
                        <span
                          v-if="snap.found"
                          class="inline-flex rounded-full px-1.5 py-0.5 text-xs"
                          :class="snap.availability === 'in_stock'
                            ? 'bg-emerald-500/20 text-success'
                            : snap.availability === 'out_of_stock'
                            ? 'bg-danger-soft text-danger'
                            : 'bg-line text-muted'"
                        >
                          {{ snap.availability === 'in_stock' ? 'In Stock'
                            : snap.availability === 'out_of_stock' ? 'OOS'
                            : 'Unknown' }}
                        </span>
                        <span v-else class="text-muted">—</span>
                      </td>
                      <td class="px-3 py-3 text-center">
                        <span
                          class="inline-flex rounded px-1.5 py-0.5 text-xs"
                          :class="dataSourceBadge(snap.data_source).class"
                        >
                          {{ dataSourceBadge(snap.data_source).label }}
                        </span>
                      </td>
                      <td class="px-3 py-3 text-center">
                        <a
                          v-if="snap.external_url"
                          :href="snap.external_url"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:text-brown transition-colors"
                        >
                          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                          </svg>
                        </a>
                        <span v-else class="text-muted">—</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Price History -->
            <div v-if="Object.keys(priceHistoryByMarketplace).length > 0">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-xs font-semibold uppercase tracking-wider text-muted">Price History</h3>
                <div class="flex gap-1">
                  <button
                    v-for="d in [7, 30, 90, undefined]"
                    :key="d ?? 'all'"
                    class="rounded px-2 py-0.5 text-xs transition-colors"
                    :class="priceHistoryDays === d
                      ? 'bg-yellow-deep/20 text-brown'
                      : 'text-muted hover:text-ink-soft'"
                    @click="priceHistoryDays = d; detailProductId && loadPriceHistory(detailProductId, d)"
                  >
                    {{ d ? `${d}d` : 'All' }}
                  </button>
                </div>
              </div>
              <div class="space-y-3">
                <div
                  v-for="(entries, marketplace) in priceHistoryByMarketplace"
                  :key="marketplace"
                  class="rounded-lg border border-line bg-surface-sunken/60 p-3"
                >
                  <div class="flex items-center justify-between mb-2">
                    <span class="inline-flex rounded px-1.5 py-0.5 text-xs" :class="marketplaceBadge(marketplace as string)">
                      {{ marketplaceLabel(marketplace as string) }}
                    </span>
                    <span class="text-xs text-muted">{{ entries.length }} data points</span>
                  </div>
                  <!-- Sparkline bars -->
                  <div class="flex items-end gap-px h-12">
                    <div
                      v-for="(entry, i) in entries"
                      :key="i"
                      class="flex-1 min-w-[2px] rounded-t transition-all"
                      :class="entry.data_source === 'scraped' ? 'bg-yellow-deep' : 'bg-muted'"
                      :style="{
                        height: `${Math.max(10, (entry.price / Math.max(...entries.map(e => e.price))) * 100)}%`,
                      }"
                      :title="`${formatCurrency(entry.price)} — ${new Date(entry.date).toLocaleDateString()}`"
                    />
                  </div>
                  <div class="mt-1.5 flex items-center justify-between text-xs text-muted">
                    <span>{{ formatCurrency(entries[0]?.price) }}</span>
                    <span>Latest: {{ formatCurrency(entries[entries.length - 1]?.price) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Recommendations -->
            <div v-if="selectedAnalysis.recommendations?.length">
              <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Recommendations</h3>
              <div class="space-y-2">
                <div
                  v-for="(rec, i) in selectedAnalysis.recommendations"
                  :key="i"
                  class="flex gap-3 rounded-lg border border-line bg-surface-sunken/60 p-3"
                >
                  <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-yellow-deep/20 text-xs font-bold text-brown">
                    {{ i + 1 }}
                  </div>
                  <p class="text-sm text-ink-soft leading-relaxed">{{ rec }}</p>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- No analysis yet for selected product -->
        <div v-else class="flex flex-1 items-center justify-center">
          <div class="text-center">
            <p class="text-sm text-muted">No analysis found for this product.</p>
            <button class="btn-primary mt-4 text-sm" @click="() => {
              const id = detailProductId
              if (id) {
                const a = analyses.value?.find(x => x.product_id === id)
                if (a) analyseProduct({ product_id: a.product_id, product_title: a.product_title ?? '' })
              }
            }">
              Run Analysis
            </button>
          </div>
        </div>
      </div>

      <!-- No detail selected (desktop only, show CTA) -->
      <div v-else-if="analyses.length > 0" class="hidden lg:flex flex-1 items-center justify-center">
        <div class="text-center">
          <svg class="mx-auto h-10 w-10 text-muted" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.563.563 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
          </svg>
          <p class="mt-3 text-sm text-muted">Select a product to view its competitive analysis</p>
        </div>
      </div>
    </div>
  </div>

  <!-- Analyse Product Modal -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-150"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-brown/40 backdrop-blur-sm"
        @click.self="showModal = false"
      >
        <div class="w-full max-w-lg rounded-xl border border-line bg-white shadow-2xl">
          <div class="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 class="text-base font-semibold text-ink">Analyse Product Competitiveness</h2>
            <button class="text-muted hover:text-ink" @click="showModal = false">
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="p-5">
            <!-- Product search -->
            <div class="relative">
              <label class="mb-1.5 block text-xs font-medium text-muted">Search your products</label>
              <input
                v-model="productSearch"
                type="text"
                placeholder="Type product name or SKU..."
                class="input-field w-full"
              />
              <div v-if="searchLoading" class="absolute right-3 top-8">
                <svg class="h-4 w-4 animate-spin text-muted" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
                </svg>
              </div>

              <!-- Dropdown results -->
              <div
                v-if="productResults.length"
                class="absolute z-10 mt-1 w-full rounded-lg border border-line bg-white shadow-xl"
              >
                <button
                  v-for="p in productResults"
                  :key="p.id"
                  class="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-surface-sunken first:rounded-t-lg last:rounded-b-lg"
                  @click="selectProduct(p)"
                >
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm text-ink">{{ p.title }}</p>
                    <p class="text-xs text-muted">
                      {{ p.sku ?? 'No SKU' }}
                      <span v-if="(p as any).brand?.name"> · {{ (p as any).brand.name }}</span>
                    </p>
                  </div>
                  <div v-if="(p as any).retail_price" class="shrink-0 text-xs text-muted">
                    {{ p.currency }} {{ Number((p as any).retail_price).toFixed(2) }}
                  </div>
                </button>
              </div>
            </div>

            <!-- Selected product preview -->
            <div v-if="selectedProduct" class="mt-3 rounded-lg border border-line bg-yellow-soft/40 p-3">
              <p class="text-sm font-medium text-ink">{{ (selectedProduct as any).title }}</p>
              <div class="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                <span v-if="(selectedProduct as any).brand?.name">{{ (selectedProduct as any).brand.name }}</span>
                <span v-if="selectedProduct.ean">EAN: {{ selectedProduct.ean }}</span>
                <span v-if="selectedProduct.asin">ASIN: {{ selectedProduct.asin }}</span>
                <span v-if="(selectedProduct as any).retail_price">
                  {{ selectedProduct.currency }} {{ Number((selectedProduct as any).retail_price).toFixed(2) }}
                </span>
              </div>
            </div>

            <!-- Tier selection -->
            <div v-if="selectedProduct" class="mt-4 space-y-2">
              <label class="block text-xs font-medium text-muted mb-2">Choose scan type</label>

              <!-- Free tier -->
              <div class="rounded-lg border border-line bg-surface-sunken/60 p-3">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-ink">Free Analysis</p>
                    <p class="text-xs text-muted mt-0.5">AI estimate now + real scrape overnight</p>
                  </div>
                  <button
                    class="btn-secondary text-xs"
                    :disabled="analysing"
                    @click="runFreeAnalysis"
                  >
                    Run Free
                  </button>
                </div>
              </div>

              <!-- Instant scan (x402) — hidden until x402 is enabled -->
              <!-- <div class="rounded-lg border border-line bg-yellow-soft/40 p-3">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-ink">Instant Scan</p>
                    <p class="text-xs text-muted mt-0.5">Live scrape all marketplaces now (~60s)</p>
                  </div>
                  <button
                    class="btn-primary text-xs flex items-center gap-1.5"
                    :disabled="analysing || paying"
                    @click="runInstantScan"
                  >
                    <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    $0.05 USDC
                  </button>
                </div>
              </div> -->
            </div>
          </div>

          <div class="flex items-center justify-end border-t border-line px-5 py-4">
            <button class="btn-secondary" @click="showModal = false">Cancel</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
