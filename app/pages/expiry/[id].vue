<script setup lang="ts">
import type { ExpiryBatch, ExpiryItem } from '~/types'

const route = useRoute()
const batchId = route.params.id as string

const {
  getBatch, loadBatchItems,
  expiryLabel, daysUntilExpiry, expiryUrgency,
} = useExpiry()

const batch = ref<ExpiryBatch | null>(null)
const items = ref<ExpiryItem[]>([])
const loading = ref(true)

async function loadData() {
  loading.value = true
  const { data: b } = await getBatch(batchId)
  if (b) batch.value = b as ExpiryBatch
  const { data: it } = await loadBatchItems(batchId)
  items.value = it
  loading.value = false
}

function urgencyClass(year: number, month: number, day?: number | null) {
  const days = daysUntilExpiry(year, month, day)
  const u = expiryUrgency(days)
  if (u === 'expired') return 'bg-danger-soft text-danger'
  if (u === 'critical') return 'bg-orange-500/10 text-warning'
  if (u === 'warning') return 'bg-yellow-soft text-warning'
  return 'bg-success-soft text-success'
}

function exportCsv() {
  const rows = [['SKU', 'Product', 'Qty', 'Remaining', 'Expiry', 'Status', 'Batch']]
  for (const item of items.value) {
    rows.push([
      item.raw_sku,
      (item.product as any)?.title || '',
      String(item.quantity),
      String(item.remaining_qty),
      expiryLabel(item.expiry_year, item.expiry_month, item.expiry_day),
      item.status,
      batch.value?.batch_code || '',
    ])
  }
  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `expiry-${batch.value?.batch_code || batchId}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(loadData)
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center gap-4">
      <NuxtLink to="/expiry" class="rounded-lg p-2 text-muted transition-colors hover:bg-surface-sunken hover:text-ink">
        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
      </NuxtLink>
      <div v-if="batch" class="flex-1">
        <h1 class="text-2xl font-bold text-ink">Batch: {{ batch.batch_code }}</h1>
        <p class="mt-1 text-sm text-muted">
          Received {{ batch.received_at }}
          <span v-if="batch.source !== 'manual'" class="ml-1 rounded bg-line px-1.5 py-0.5 text-[10px] text-muted">{{ batch.source }}</span>
          <span v-if="batch.notes"> · {{ batch.notes }}</span>
        </p>
      </div>
      <button class="btn-secondary text-sm" @click="exportCsv">Export CSV</button>
    </div>

    <!-- Items table -->
    <div class="card p-6">
      <h2 class="mb-4 text-lg font-semibold text-ink">Items ({{ items.length }})</h2>
      <div v-if="items.length > 0" class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-line text-left text-muted">
              <th class="pb-2 pr-4">SKU</th>
              <th class="pb-2 pr-4">Product</th>
              <th class="pb-2 pr-4 text-right">Qty</th>
              <th class="pb-2 pr-4 text-right">Remaining</th>
              <th class="pb-2 pr-4">Expiry</th>
              <th class="pb-2 pr-4">Status</th>
            </tr>
          </thead>
          <tbody class="text-ink-soft">
            <tr v-for="item in items" :key="item.id" class="border-b border-line">
              <td class="py-2.5 pr-4 font-mono text-xs">{{ item.raw_sku }}</td>
              <td class="py-2.5 pr-4 text-ink">
                <template v-if="item.product">
                  <NuxtLink :to="`/products/${item.product.id}`" class="text-brown hover:underline">{{ (item.product as any).title }}</NuxtLink>
                </template>
                <span v-else class="text-yellow-500 text-xs">Unresolved</span>
              </td>
              <td class="py-2.5 pr-4 text-right">{{ item.quantity }}</td>
              <td class="py-2.5 pr-4 text-right">{{ item.remaining_qty }}</td>
              <td class="py-2.5 pr-4">
                <span :class="['rounded-full px-2 py-0.5 text-xs font-medium', urgencyClass(item.expiry_year, item.expiry_month, item.expiry_day)]">
                  {{ expiryLabel(item.expiry_year, item.expiry_month, item.expiry_day) }}
                </span>
              </td>
              <td class="py-2.5 pr-4">
                <span class="text-xs text-muted">{{ item.status }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else-if="!loading" class="py-8 text-center text-sm text-muted">No items in this batch.</p>
    </div>
  </div>
</template>
