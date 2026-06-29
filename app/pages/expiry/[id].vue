<script setup lang="ts">
import type { ExpiryBatch, ExpiryItem, ExpiryItemStatus } from '~/types'

const route = useRoute()
const batchId = route.params.id as string

const {
  getBatch, loadBatchItems, createItem, createItems, updateItemStatus, deleteItem,
  loadAliases, createAlias, deleteAlias,
  expiryLabel, daysUntilExpiry, expiryUrgency,
} = useExpiry()

const batch = ref<ExpiryBatch | null>(null)
const items = ref<ExpiryItem[]>([])
const loading = ref(true)
const message = ref('')
const errorMsg = ref('')

function showSuccess(msg: string) { message.value = msg; errorMsg.value = ''; setTimeout(() => (message.value = ''), 3000) }
function showError(msg: string) { errorMsg.value = msg; message.value = '' }

// Add item form
const showItemForm = ref(false)
const newItem = ref({
  raw_sku: '',
  quantity: 1,
  expiry_month: new Date().getMonth() + 1,
  expiry_year: new Date().getFullYear(),
  expiry_day: null as number | null,
  unit_cost: null as number | null,
  notes: '',
})
const itemSaving = ref(false)

// Bulk add (paste mode)
const showBulkForm = ref(false)
const bulkText = ref('')
const bulkSaving = ref(false)

// CSV import
const showCsvImport = ref(false)
const csvSaving = ref(false)

async function loadData() {
  loading.value = true
  const { data: b } = await getBatch(batchId)
  if (b) batch.value = b as ExpiryBatch
  const { data: it } = await loadBatchItems(batchId)
  items.value = it
  loading.value = false
}

async function handleAddItem() {
  if (!newItem.value.raw_sku.trim()) return
  itemSaving.value = true
  const { error } = await createItem({
    batch_id: batchId,
    raw_sku: newItem.value.raw_sku.trim(),
    quantity: newItem.value.quantity,
    remaining_qty: newItem.value.quantity,
    expiry_year: newItem.value.expiry_year,
    expiry_month: newItem.value.expiry_month,
    expiry_day: newItem.value.expiry_day,
    unit_cost: newItem.value.unit_cost,
    notes: newItem.value.notes || null,
  })
  itemSaving.value = false
  if (error) return showError(error.message)
  showSuccess('Item added')
  newItem.value = { raw_sku: '', quantity: 1, expiry_month: newItem.value.expiry_month, expiry_year: newItem.value.expiry_year, expiry_day: null, unit_cost: null, notes: '' }
  await loadData()
}

async function handleBulkAdd() {
  const lines = bulkText.value.trim().split('\n').filter(l => l.trim())
  if (lines.length === 0) return

  bulkSaving.value = true
  const parsed: Partial<ExpiryItem>[] = []
  for (const line of lines) {
    // Expected format: SKU, QTY, MM/YYYY (tab or comma separated)
    const parts = line.split(/[,\t]+/).map(s => s.trim())
    if (parts.length < 3) continue
    const [sku, qtyStr, dateStr] = parts
    const qty = parseInt(qtyStr) || 1
    const dateParts = dateStr.split('/')
    const month = parseInt(dateParts[0])
    const year = parseInt(dateParts[1] || dateParts[0])
    if (!month || !year) continue
    parsed.push({
      batch_id: batchId,
      raw_sku: sku,
      quantity: qty,
      remaining_qty: qty,
      expiry_year: year,
      expiry_month: month,
    })
  }

  if (parsed.length === 0) {
    bulkSaving.value = false
    return showError('No valid lines. Format: SKU, QTY, MM/YYYY')
  }

  const { error } = await createItems(parsed)
  bulkSaving.value = false
  if (error) return showError(error.message)
  showSuccess(`${parsed.length} items added`)
  bulkText.value = ''
  showBulkForm.value = false
  await loadData()
}

function handleCsvUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async (e) => {
    csvSaving.value = true
    const text = e.target?.result as string
    const lines = text.trim().split('\n')
    const header = lines[0].toLowerCase()
    const hasHeader = header.includes('sku') || header.includes('expiry') || header.includes('qty')
    const dataLines = hasHeader ? lines.slice(1) : lines

    const parsed: Partial<ExpiryItem>[] = []
    for (const line of dataLines) {
      const parts = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''))
      if (parts.length < 3) continue
      const [sku, qtyStr, dateStr] = parts
      const qty = parseInt(qtyStr) || 1
      const dateParts = dateStr.split(/[/\-]/)
      let month: number, year: number
      if (dateParts.length >= 2) {
        month = parseInt(dateParts[0])
        year = parseInt(dateParts[1])
        if (year < 100) year += 2000
      } else {
        continue
      }
      if (!month || !year || month < 1 || month > 12) continue
      parsed.push({
        batch_id: batchId,
        raw_sku: sku,
        quantity: qty,
        remaining_qty: qty,
        expiry_year: year,
        expiry_month: month,
      })
    }

    if (parsed.length === 0) {
      csvSaving.value = false
      return showError('No valid rows found. Expected columns: SKU, QTY, MM/YYYY')
    }

    const { error } = await createItems(parsed)
    csvSaving.value = false
    if (error) return showError(error.message)
    showSuccess(`${parsed.length} items imported from CSV`)
    showCsvImport.value = false
    await loadData()
  }
  reader.readAsText(file)
}

async function handleStatusChange(itemId: string, status: ExpiryItemStatus) {
  const { error } = await updateItemStatus(itemId, status)
  if (error) showError(error.message)
  else await loadData()
}

async function handleDeleteItem(id: string) {
  if (!confirm('Delete this item?')) return
  const { error } = await deleteItem(id)
  if (error) showError((error as any).message)
  else await loadData()
}

function urgencyClass(year: number, month: number, day?: number | null) {
  const days = daysUntilExpiry(year, month, day)
  const u = expiryUrgency(days)
  if (u === 'expired') return 'bg-red-500/10 text-red-400'
  if (u === 'critical') return 'bg-orange-500/10 text-orange-400'
  if (u === 'warning') return 'bg-yellow-500/10 text-yellow-400'
  return 'bg-emerald-500/10 text-emerald-400'
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

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

onMounted(loadData)
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center gap-4">
      <NuxtLink to="/expiry" class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white">
        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
      </NuxtLink>
      <div v-if="batch" class="flex-1">
        <h1 class="text-2xl font-bold text-white">Batch: {{ batch.batch_code }}</h1>
        <p class="mt-1 text-sm text-gray-400">
          Received {{ batch.received_at }}
          <span v-if="batch.source !== 'manual'" class="ml-1 rounded bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">{{ batch.source }}</span>
          <span v-if="batch.notes"> · {{ batch.notes }}</span>
        </p>
      </div>
      <button class="btn-secondary text-sm" @click="exportCsv">Export CSV</button>
    </div>

    <!-- Messages -->
    <div v-if="message" class="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">{{ message }}</div>
    <div v-if="errorMsg" class="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{{ errorMsg }}</div>

    <!-- Add actions -->
    <div class="flex flex-wrap gap-2">
      <button
        :class="['rounded-lg border px-3 py-2 text-sm transition-colors', showItemForm ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-gray-700 text-gray-400 hover:border-gray-600']"
        @click="showItemForm = !showItemForm; showBulkForm = false; showCsvImport = false"
      >+ Add Item</button>
      <button
        :class="['rounded-lg border px-3 py-2 text-sm transition-colors', showBulkForm ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-gray-700 text-gray-400 hover:border-gray-600']"
        @click="showBulkForm = !showBulkForm; showItemForm = false; showCsvImport = false"
      >Bulk Paste</button>
      <button
        :class="['rounded-lg border px-3 py-2 text-sm transition-colors', showCsvImport ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-gray-700 text-gray-400 hover:border-gray-600']"
        @click="showCsvImport = !showCsvImport; showItemForm = false; showBulkForm = false"
      >Import CSV</button>
    </div>

    <!-- Single item form -->
    <div v-if="showItemForm" class="card p-4 space-y-3">
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <label class="label-field">SKU / Code *</label>
          <input v-model="newItem.raw_sku" class="input-field" placeholder="ABC-123" />
        </div>
        <div>
          <label class="label-field">Quantity</label>
          <input v-model.number="newItem.quantity" type="number" min="1" class="input-field" />
        </div>
        <div>
          <label class="label-field">Expiry Month</label>
          <select v-model.number="newItem.expiry_month" class="input-field">
            <option v-for="(m, i) in months" :key="i" :value="i + 1">{{ m }}</option>
          </select>
        </div>
        <div>
          <label class="label-field">Expiry Year</label>
          <input v-model.number="newItem.expiry_year" type="number" min="2020" max="2050" class="input-field" />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="label-field">Expiry Day (optional)</label>
          <input v-model.number="newItem.expiry_day" type="number" min="1" max="31" class="input-field" placeholder="—" />
        </div>
        <div>
          <label class="label-field">Unit Cost</label>
          <input v-model.number="newItem.unit_cost" type="number" step="0.01" class="input-field" placeholder="0.00" />
        </div>
      </div>
      <button class="btn-primary" :disabled="!newItem.raw_sku.trim() || itemSaving" @click="handleAddItem">
        {{ itemSaving ? 'Adding…' : 'Add Item' }}
      </button>
    </div>

    <!-- Bulk paste form -->
    <div v-if="showBulkForm" class="card p-4 space-y-3">
      <label class="label-field">Paste lines (one per row: SKU, QTY, MM/YYYY)</label>
      <textarea v-model="bulkText" class="input-field font-mono text-xs" rows="6" placeholder="ABC-123, 10, 06/2026&#10;DEF-456, 5, 12/2026&#10;GHI-789, 20, 03/2027" />
      <button class="btn-primary" :disabled="!bulkText.trim() || bulkSaving" @click="handleBulkAdd">
        {{ bulkSaving ? 'Adding…' : 'Add All' }}
      </button>
    </div>

    <!-- CSV import -->
    <div v-if="showCsvImport" class="card p-4 space-y-3">
      <p class="text-sm text-gray-400">Upload a CSV with columns: SKU, QTY, EXPIRY (MM/YYYY). Headers are auto-detected.</p>
      <input type="file" accept=".csv" class="input-field text-sm" @change="handleCsvUpload" />
      <p v-if="csvSaving" class="text-sm text-indigo-400">Importing…</p>
    </div>

    <!-- Items table -->
    <div class="card p-6">
      <h2 class="mb-4 text-lg font-semibold text-white">Items ({{ items.length }})</h2>
      <div v-if="items.length > 0" class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-700 text-left text-gray-400">
              <th class="pb-2 pr-4">SKU</th>
              <th class="pb-2 pr-4">Product</th>
              <th class="pb-2 pr-4 text-right">Qty</th>
              <th class="pb-2 pr-4 text-right">Remaining</th>
              <th class="pb-2 pr-4">Expiry</th>
              <th class="pb-2 pr-4">Status</th>
              <th class="pb-2"></th>
            </tr>
          </thead>
          <tbody class="text-gray-300">
            <tr v-for="item in items" :key="item.id" class="border-b border-gray-800">
              <td class="py-2.5 pr-4 font-mono text-xs">{{ item.raw_sku }}</td>
              <td class="py-2.5 pr-4 text-white">
                <template v-if="item.product">
                  <NuxtLink :to="`/products/${item.product.id}`" class="text-indigo-400 hover:underline">{{ (item.product as any).title }}</NuxtLink>
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
                <select
                  :value="item.status"
                  class="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300"
                  @change="handleStatusChange(item.id, ($event.target as HTMLSelectElement).value as ExpiryItemStatus)"
                >
                  <option value="in_stock">In Stock</option>
                  <option value="sold">Sold</option>
                  <option value="promoted">Promoted</option>
                  <option value="disposed">Disposed</option>
                  <option value="returned">Returned</option>
                </select>
              </td>
              <td class="py-2.5 text-right">
                <button class="text-xs text-red-400 hover:text-red-300" @click="handleDeleteItem(item.id)">Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else-if="!loading" class="py-8 text-center text-sm text-gray-500">No items in this batch yet. Add items above.</p>
    </div>
  </div>
</template>
