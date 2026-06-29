<script setup lang="ts">
import type { ExpiryBatch, ExpiryLifoRow, ExpirySummary, ExpiryMicrosite } from '~/types'

const {
  batches, lifoItems, summary, microsites, loading,
  loadSummary, loadBatches, loadLifo, loadMicrosites,
  createBatch, deleteBatch, createMicrosite, deleteMicrosite,
  expiryLabel, daysUntilExpiry, expiryUrgency,
} = useExpiry()

const activeTab = ref<'overview' | 'batches' | 'lifo' | 'microsites'>('overview')

// Batch creation
const showBatchForm = ref(false)
const newBatch = ref({ batch_code: '', received_at: new Date().toISOString().slice(0, 10), notes: '' })
const batchSaving = ref(false)

// Microsite creation
const showMicrositeForm = ref(false)
const newMicrosite = ref({ slug: '', title: '', description: '' })
const micrositeSaving = ref(false)

const message = ref('')
const errorMsg = ref('')

function showSuccess(msg: string) { message.value = msg; errorMsg.value = ''; setTimeout(() => (message.value = ''), 3000) }
function showError(msg: string) { errorMsg.value = msg; message.value = '' }

async function handleCreateBatch() {
  if (!newBatch.value.batch_code.trim()) return
  batchSaving.value = true
  const { error } = await createBatch({
    batch_code: newBatch.value.batch_code,
    received_at: newBatch.value.received_at,
    notes: newBatch.value.notes || null,
    source: 'manual',
  })
  batchSaving.value = false
  if (error) return showError(error.message)
  showSuccess('Batch created')
  showBatchForm.value = false
  newBatch.value = { batch_code: '', received_at: new Date().toISOString().slice(0, 10), notes: '' }
}

async function handleDeleteBatch(id: string) {
  if (!confirm('Delete this batch and all its items?')) return
  const { error } = await deleteBatch(id)
  if (error) showError(error.message)
  else showSuccess('Batch deleted')
  await loadSummary()
}

async function handleCreateMicrosite() {
  if (!newMicrosite.value.slug.trim() || !newMicrosite.value.title.trim()) return
  micrositeSaving.value = true
  const { error } = await createMicrosite({
    slug: newMicrosite.value.slug.replace(/[^a-z0-9-]/g, ''),
    title: newMicrosite.value.title,
    description: newMicrosite.value.description || null,
  })
  micrositeSaving.value = false
  if (error) return showError(error.message)
  showSuccess('Microsite created')
  showMicrositeForm.value = false
  newMicrosite.value = { slug: '', title: '', description: '' }
}

async function handleDeleteMicrosite(id: string) {
  if (!confirm('Delete this microsite?')) return
  const { error } = await deleteMicrosite(id)
  if (error) showError(error.message)
  else showSuccess('Microsite deleted')
}

function urgencyClass(days: number) {
  const u = expiryUrgency(days)
  if (u === 'expired') return 'bg-red-500/10 text-red-400'
  if (u === 'critical') return 'bg-orange-500/10 text-orange-400'
  if (u === 'warning') return 'bg-yellow-500/10 text-yellow-400'
  return 'bg-emerald-500/10 text-emerald-400'
}

function urgencyBadge(days: number) {
  const u = expiryUrgency(days)
  if (u === 'expired') return 'Expired'
  if (u === 'critical') return `${days}d left`
  if (u === 'warning') return `${days}d left`
  return `${days}d left`
}

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'batches', label: 'Batches' },
  { key: 'lifo', label: 'LIFO Planner' },
  { key: 'microsites', label: 'Microsites' },
]

onMounted(async () => {
  await Promise.all([loadSummary(), loadBatches(), loadLifo({ limit: 50 }), loadMicrosites()])
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-white">Expiry</h1>
        <p class="mt-1 text-sm text-gray-400">Track batch expiries, plan LIFO, and share transparency pages.</p>
      </div>
    </div>

    <!-- Messages -->
    <div v-if="message" class="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">{{ message }}</div>
    <div v-if="errorMsg" class="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{{ errorMsg }}</div>

    <!-- Tabs -->
    <div class="flex gap-1 rounded-lg border border-gray-800 bg-gray-900 p-1">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :class="[
          'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all',
          activeTab === tab.key ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white',
        ]"
        @click="activeTab = tab.key as any"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- ===== OVERVIEW ===== -->
    <div v-show="activeTab === 'overview'" class="space-y-6">
      <!-- Stats cards -->
      <div v-if="summary" class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div class="card p-4">
          <p class="text-xs text-gray-400 uppercase tracking-wide">In Stock Items</p>
          <p class="mt-1 text-2xl font-bold text-white">{{ summary.total_items }}</p>
          <p class="text-xs text-gray-500">{{ summary.total_quantity }} total units</p>
        </div>
        <div class="card p-4">
          <p class="text-xs text-gray-400 uppercase tracking-wide">Expired</p>
          <p class="mt-1 text-2xl font-bold" :class="summary.expired > 0 ? 'text-red-400' : 'text-white'">{{ summary.expired }}</p>
          <p class="text-xs text-gray-500">need disposal or promo</p>
        </div>
        <div class="card p-4">
          <p class="text-xs text-gray-400 uppercase tracking-wide">Expiring < 30d</p>
          <p class="mt-1 text-2xl font-bold" :class="summary.expiring_30d > 0 ? 'text-orange-400' : 'text-white'">{{ summary.expiring_30d }}</p>
          <p class="text-xs text-gray-500">high priority</p>
        </div>
        <div class="card p-4">
          <p class="text-xs text-gray-400 uppercase tracking-wide">Expiring < 90d</p>
          <p class="mt-1 text-2xl font-bold" :class="summary.expiring_90d > 0 ? 'text-yellow-400' : 'text-white'">{{ summary.expiring_90d }}</p>
          <p class="text-xs text-gray-500">plan promotions</p>
        </div>
      </div>

      <!-- Unresolved SKUs alert -->
      <div v-if="summary && summary.unresolved > 0" class="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
        <div class="flex items-start gap-3">
          <svg class="mt-0.5 h-5 w-5 shrink-0 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <div>
            <p class="text-sm font-medium text-yellow-400">{{ summary.unresolved }} items have unresolved SKUs</p>
            <p class="mt-1 text-xs text-gray-400">These SKU strings couldn't be matched to a product. Add SKU aliases in a batch detail page or ensure the product exists with that SKU.</p>
          </div>
        </div>
      </div>

      <!-- Soonest expiring (quick LIFO peek) -->
      <div class="card p-6">
        <h2 class="mb-4 text-lg font-semibold text-white">Soonest Expiring</h2>
        <div v-if="lifoItems.length > 0" class="space-y-2">
          <div
            v-for="item in lifoItems.slice(0, 10)"
            :key="item.id"
            class="flex items-center justify-between rounded-lg border border-gray-800 px-4 py-3"
          >
            <div class="min-w-0">
              <p class="text-sm font-medium text-white truncate">{{ item.product_title || item.raw_sku }}</p>
              <p class="text-xs text-gray-500">
                Batch {{ item.batch_code }} · {{ item.remaining_qty }} units · {{ expiryLabel(item.expiry_year, item.expiry_month, item.expiry_day) }}
              </p>
            </div>
            <span :class="['shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium', urgencyClass(item.days_until_expiry)]">
              {{ urgencyBadge(item.days_until_expiry) }}
            </span>
          </div>
        </div>
        <p v-else class="text-sm text-gray-500">No in-stock items with expiry data yet.</p>
      </div>
    </div>

    <!-- ===== BATCHES ===== -->
    <div v-show="activeTab === 'batches'" class="space-y-4">
      <div class="card p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-semibold text-white">Batches</h2>
            <p class="mt-1 text-sm text-gray-400">Each batch represents a goods receipt with associated expiry data.</p>
          </div>
          <button class="btn-primary" @click="showBatchForm = !showBatchForm">
            {{ showBatchForm ? 'Cancel' : '+ New Batch' }}
          </button>
        </div>

        <!-- Create form -->
        <div v-if="showBatchForm" class="mb-6 rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label-field">Batch Code *</label>
              <input v-model="newBatch.batch_code" class="input-field" placeholder="e.g. MFG-2026-0301" />
            </div>
            <div>
              <label class="label-field">Received Date</label>
              <input v-model="newBatch.received_at" type="date" class="input-field" />
            </div>
          </div>
          <div>
            <label class="label-field">Notes</label>
            <textarea v-model="newBatch.notes" class="input-field" rows="2" placeholder="Optional notes about this batch" />
          </div>
          <button class="btn-primary" :disabled="!newBatch.batch_code.trim() || batchSaving" @click="handleCreateBatch">
            {{ batchSaving ? 'Creating…' : 'Create Batch' }}
          </button>
        </div>

        <!-- Batch list -->
        <div v-if="!loading && batches.length > 0" class="space-y-2">
          <NuxtLink
            v-for="batch in batches"
            :key="batch.id"
            :to="`/expiry/${batch.id}`"
            class="flex items-center justify-between rounded-lg border border-gray-800 px-4 py-3 transition-colors hover:border-gray-700 hover:bg-gray-800/50"
          >
            <div class="min-w-0">
              <p class="text-sm font-medium text-white">{{ batch.batch_code }}</p>
              <p class="text-xs text-gray-500">
                Received {{ batch.received_at }} · {{ batch._item_count }} item{{ batch._item_count === 1 ? '' : 's' }}
                <span v-if="batch.source !== 'manual'" class="ml-1 rounded bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">{{ batch.source }}</span>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="text-xs text-red-400 hover:text-red-300 z-10"
                @click.prevent.stop="handleDeleteBatch(batch.id)"
              >Delete</button>
              <svg class="h-4 w-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </NuxtLink>
        </div>
        <p v-else-if="!loading" class="py-8 text-center text-sm text-gray-500">No batches yet. Create one to start tracking expiry data.</p>
      </div>
    </div>

    <!-- ===== LIFO PLANNER ===== -->
    <div v-show="activeTab === 'lifo'" class="space-y-4">
      <div class="card p-6">
        <div class="mb-4">
          <h2 class="text-lg font-semibold text-white">LIFO Planner</h2>
          <p class="mt-1 text-sm text-gray-400">Items sorted by expiry date — soonest first. Sell, promote, or dispose of expiring stock.</p>
        </div>

        <div v-if="lifoItems.length > 0" class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-700 text-left text-gray-400">
                <th class="pb-2 pr-4">Product</th>
                <th class="pb-2 pr-4">SKU</th>
                <th class="pb-2 pr-4">Batch</th>
                <th class="pb-2 pr-4 text-right">Qty</th>
                <th class="pb-2 pr-4">Expires</th>
                <th class="pb-2 pr-4">Status</th>
              </tr>
            </thead>
            <tbody class="text-gray-300">
              <tr v-for="item in lifoItems" :key="item.id" class="border-b border-gray-800">
                <td class="py-2.5 pr-4 font-medium text-white">{{ item.product_title || '—' }}</td>
                <td class="py-2.5 pr-4 font-mono text-xs text-gray-400">{{ item.raw_sku }}</td>
                <td class="py-2.5 pr-4 text-xs text-gray-400">{{ item.batch_code }}</td>
                <td class="py-2.5 pr-4 text-right">{{ item.remaining_qty }}</td>
                <td class="py-2.5 pr-4">
                  {{ expiryLabel(item.expiry_year, item.expiry_month, item.expiry_day) }}
                </td>
                <td class="py-2.5 pr-4">
                  <span :class="['rounded-full px-2 py-0.5 text-xs font-medium', urgencyClass(item.days_until_expiry)]">
                    {{ urgencyBadge(item.days_until_expiry) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="py-8 text-center text-sm text-gray-500">No in-stock items to plan. Import batch data to get started.</p>
      </div>
    </div>

    <!-- ===== MICROSITES ===== -->
    <div v-show="activeTab === 'microsites'" class="space-y-4">
      <div class="card p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-semibold text-white">Expiry Microsites</h2>
            <p class="mt-1 text-sm text-gray-400">Public pages showing expiry data transparently for your customers.</p>
          </div>
          <button class="btn-primary" @click="showMicrositeForm = !showMicrositeForm">
            {{ showMicrositeForm ? 'Cancel' : '+ New Microsite' }}
          </button>
        </div>

        <!-- Create form -->
        <div v-if="showMicrositeForm" class="mb-6 rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label-field">Title *</label>
              <input v-model="newMicrosite.title" class="input-field" placeholder="e.g. Our Product Freshness" />
            </div>
            <div>
              <label class="label-field">Slug * (URL path)</label>
              <div class="flex items-center gap-1">
                <span class="text-xs text-gray-500">/m/</span>
                <input
                  v-model="newMicrosite.slug"
                  class="input-field"
                  placeholder="my-store-expiry"
                  @input="newMicrosite.slug = newMicrosite.slug.toLowerCase().replace(/[^a-z0-9-]/g, '')"
                />
              </div>
            </div>
          </div>
          <div>
            <label class="label-field">Description</label>
            <textarea v-model="newMicrosite.description" class="input-field" rows="2" placeholder="Optional public description" />
          </div>
          <button
            class="btn-primary"
            :disabled="!newMicrosite.slug.trim() || !newMicrosite.title.trim() || micrositeSaving"
            @click="handleCreateMicrosite"
          >
            {{ micrositeSaving ? 'Creating…' : 'Create Microsite' }}
          </button>
        </div>

        <!-- Microsite list -->
        <div v-if="microsites.length > 0" class="space-y-2">
          <div
            v-for="site in microsites"
            :key="site.id"
            class="flex items-center justify-between rounded-lg border border-gray-800 px-4 py-3"
          >
            <div class="min-w-0">
              <p class="text-sm font-medium text-white">{{ site.title }}</p>
              <p class="text-xs text-gray-500">
                <code class="text-indigo-400">/m/{{ site.slug }}</code>
                <span :class="['ml-2 rounded-full px-2 py-0.5 text-[10px]', site.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-700 text-gray-400']">
                  {{ site.is_active ? 'Active' : 'Inactive' }}
                </span>
              </p>
            </div>
            <div class="flex items-center gap-3">
              <NuxtLink :to="`/m/${site.slug}`" target="_blank" class="text-xs text-indigo-400 hover:text-indigo-300">Preview</NuxtLink>
              <button class="text-xs text-red-400 hover:text-red-300" @click="handleDeleteMicrosite(site.id)">Delete</button>
            </div>
          </div>
        </div>
        <p v-else class="py-8 text-center text-sm text-gray-500">
          No microsites yet. Create one to share expiry data publicly with your customers.
        </p>
      </div>
    </div>
  </div>
</template>
