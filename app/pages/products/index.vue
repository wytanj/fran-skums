<script setup lang="ts">
import type { Product, ProductStatus } from '~/types'

const router = useRouter()
const { products, loading, totalCount, fetchProducts, deleteProducts } = useProducts()

const page = ref(1)
const perPage = ref(25)
const search = ref('')
const statusFilter = ref<ProductStatus | ''>('')
const sortBy = ref('created_at')
const sortDir = ref<'asc' | 'desc'>('desc')
const selected = ref<string[]>([])

const columns = [
  { key: 'title', label: 'Product', sortable: true },
  { key: 'sku', label: 'SKU', sortable: true },
  { key: 'ean', label: 'EAN' },
  { key: 'upc', label: 'UPC' },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'stock_quantity', label: 'Stock', sortable: true, class: 'text-right' },
  { key: 'retail_price', label: 'Price', sortable: true, class: 'text-right' },
  { key: 'updated_at', label: 'Updated', sortable: true },
]

let searchTimeout: ReturnType<typeof setTimeout>

async function load() {
  await fetchProducts({
    page: page.value,
    perPage: perPage.value,
    search: search.value,
    status: statusFilter.value,
    sortBy: sortBy.value,
    sortDir: sortDir.value,
  })
}

function handleSearch(val: string) {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    search.value = val
    page.value = 1
    load()
  }, 300)
}

function handleSort(key: string) {
  if (sortBy.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = key
    sortDir.value = 'asc'
  }
  load()
}

function handleStatusFilter(status: ProductStatus | '') {
  statusFilter.value = status
  page.value = 1
  load()
}

async function handleBulkDelete() {
  if (!selected.value.length) return
  if (!confirm(`Delete ${selected.value.length} product(s)?`)) return

  await deleteProducts(selected.value)
  selected.value = []
  await load()
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatPrice(price: number | null, currency: string) {
  if (price == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price)
}

watch(page, load)
onMounted(load)
</script>

<template>
  <div>
    <!-- Header -->
    <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-white">Products</h1>
        <p class="mt-1 text-sm text-gray-400">Manage your product catalog</p>
      </div>
      <div class="flex items-center gap-3">
        <NuxtLink to="/import-export" class="btn-secondary">
          Import
        </NuxtLink>
        <NuxtLink to="/products/new" class="btn-primary">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add product
        </NuxtLink>
      </div>
    </div>

    <!-- Filters -->
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div class="flex-1">
        <input
          type="text"
          placeholder="Search by title, SKU, EAN, UPC..."
          class="input-field"
          @input="(e: Event) => handleSearch((e.target as HTMLInputElement).value)"
        />
      </div>
      <div class="flex items-center gap-2">
        <button
          v-for="s in [
            { value: '', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'draft', label: 'Draft' },
            { value: 'archived', label: 'Archived' },
          ]"
          :key="s.value"
          :class="[
            'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
            statusFilter === s.value
              ? 'bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30'
              : 'text-gray-400 hover:bg-gray-800 hover:text-white',
          ]"
          @click="handleStatusFilter(s.value as ProductStatus | '')"
        >
          {{ s.label }}
        </button>
      </div>
    </div>

    <!-- Bulk actions -->
    <div v-if="selected.length > 0" class="mb-4 flex items-center gap-3 rounded-lg bg-indigo-600/10 px-4 py-2.5 ring-1 ring-indigo-500/20">
      <span class="text-sm font-medium text-indigo-400">{{ selected.length }} selected</span>
      <button class="btn-danger !py-1.5 !text-xs" @click="handleBulkDelete">Delete</button>
      <button class="btn-ghost !py-1.5 !text-xs" @click="selected = []">Clear</button>
    </div>

    <!-- Table -->
    <DataTable
      :columns="columns"
      :rows="products"
      :loading="loading"
      :sort-by="sortBy"
      :sort-dir="sortDir"
      selectable
      v-model:selected="selected"
      @sort="handleSort"
      @row-click="(row: Product) => router.push(`/products/${row.id}`)"
    >
      <template #cell-title="{ row }">
        <div class="flex items-center gap-3">
          <div
            :class="[
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-medium',
              row.is_canonical ? 'bg-purple-600/10 text-purple-400' : row.canonical_product_id ? 'bg-cyan-600/10 text-cyan-400' : 'bg-gray-800 text-gray-400',
            ]"
          >
            {{ row.title?.charAt(0)?.toUpperCase() }}
          </div>
          <div>
            <div class="flex items-center gap-1.5">
              <p class="font-medium text-white">{{ row.rendition_name || row.title }}</p>
              <span v-if="row.is_canonical" class="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-400 ring-1 ring-purple-500/20">BASE</span>
              <span v-if="row.canonical_product_id" class="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-400 ring-1 ring-cyan-500/20">FORK</span>
            </div>
            <p v-if="row.brand" class="text-xs text-gray-500">{{ row.brand.name }}</p>
            <p v-if="row.export_target" class="text-xs text-orange-400">{{ row.export_target }}</p>
          </div>
        </div>
      </template>

      <template #cell-status="{ value }">
        <StatusBadge :status="value" />
      </template>

      <template #cell-stock_quantity="{ row }">
        <span
          :class="[
            'text-right font-medium tabular-nums',
            row.stock_quantity <= (row.low_stock_threshold || 10) ? 'text-red-400' : 'text-white',
          ]"
        >
          {{ row.stock_quantity }}
        </span>
      </template>

      <template #cell-retail_price="{ row }">
        <span class="font-medium tabular-nums text-white">
          {{ formatPrice(row.retail_price, row.currency) }}
        </span>
      </template>

      <template #cell-updated_at="{ value }">
        <span class="text-gray-400">{{ formatDate(value) }}</span>
      </template>
    </DataTable>

    <!-- Pagination -->
    <Pagination
      v-if="totalCount > perPage"
      :current-page="page"
      :total-items="totalCount"
      :per-page="perPage"
      @update:current-page="page = $event"
    />

    <!-- Empty state -->
    <EmptyState
      v-if="!loading && products.length === 0 && !search"
      title="No products yet"
      description="Add your first product to start building your catalog."
      action-label="Add product"
      action-to="/products/new"
    />
  </div>
</template>
