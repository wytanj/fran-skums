<script setup lang="ts">
import type { Product, ProductManual, ProductSchema, ProductSchemaDefinition, Brand, Category } from '~/types'

const route = useRoute()
const router = useRouter()
const client = useSupabaseClient()
const { currentWorkspace } = useWorkspace()
const { getProduct, updateProduct, deleteProduct, forkProduct, getManuals, createManual, updateManual, deleteManual } = useProducts()
const { schemas, fetchSchemas, getResolvedSchema, resolveSchemaLocally, flattenSchemaProperties } = useProductSchema()

// Brands & categories for dropdowns
const brands = ref<Brand[]>([])
const categories = ref<Category[]>([])

async function loadBrandsAndCategories() {
  if (!currentWorkspace.value?.id) return
  const [{ data: bData }, { data: cData }] = await Promise.all([
    client.from('brands').select('id, name').eq('workspace_id', currentWorkspace.value.id).order('name'),
    client.from('categories').select('id, name').eq('workspace_id', currentWorkspace.value.id).order('name'),
  ])
  brands.value = (bData ?? []) as Brand[]
  categories.value = (cData ?? []) as Category[]
}

const product = ref<Product | null>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const activeTab = ref<'details' | 'identifiers' | 'pricing' | 'seo' | 'forks' | 'manuals' | 'schema'>('details')

// Schema tab state
const resolvedSchema = ref<ProductSchemaDefinition | null>(null)
const productData = ref<Record<string, any>>({})
const schemaView = ref<'form' | 'json' | 'raw'>('form')
const schemaSaving = ref(false)
const selectedSchemaId = ref<string | null>(null)

// Fork modal
const showForkModal = ref(false)
const forkForm = reactive({ rendition_name: '', export_target: '' })
const forking = ref(false)

// Manual modal
const showManualModal = ref(false)
const editingManual = ref<ProductManual | null>(null)
const manualForm = reactive({ title: '', content: '', version: '1.0' })
const manualSaving = ref(false)
const manuals = ref<ProductManual[]>([])

const form = reactive({
  title: '',
  brand_id: null as string | null,
  category_id: null as string | null,
  sku: '',
  ean: '',
  upc: '',
  isbn: '',
  asin: '',
  mpn: '',
  gtin: '',
  description: '',
  short_description: '',
  cost_price: null as number | null,
  retail_price: null as number | null,
  sale_price: null as number | null,
  currency: 'USD',
  weight: null as number | null,
  weight_unit: 'kg',
  length: null as number | null,
  width: null as number | null,
  height: null as number | null,
  dimension_unit: 'cm',
  stock_quantity: 0,
  low_stock_threshold: 10,
  track_inventory: true,
  seo_title: '',
  seo_description: '',
  seo_keywords: '',
  canonical_url: '',
  status: 'draft' as 'draft' | 'active' | 'archived',
  tags: '',
  is_canonical: false,
  rendition_name: '',
  export_target: '',
})

async function load() {
  loading.value = true
  try {
    const data = await getProduct(route.params.id as string)
    product.value = data
    Object.assign(form, {
      ...data,
      brand_id: data.brand_id ?? null,
      category_id: data.category_id ?? null,
      seo_keywords: data.seo_keywords?.join(', ') || '',
      tags: data.tags?.join(', ') || '',
      rendition_name: data.rendition_name || '',
      export_target: data.export_target || '',
    })
    manuals.value = await getManuals(data.id)
    productData.value = data.product_data || {}
    selectedSchemaId.value = data.schema_id || null

    await fetchSchemas()

    if (data.schema_id) {
      try {
        resolvedSchema.value = await getResolvedSchema(data.schema_id)
      } catch {
        const s = schemas.value.find(s => s.id === data.schema_id)
        if (s) resolvedSchema.value = resolveSchemaLocally(s, schemas.value)
      }
    }
  } catch {
    error.value = 'Product not found'
  } finally {
    loading.value = false
  }
}

async function handleSchemaChange(schemaId: string) {
  if (!product.value) return
  selectedSchemaId.value = schemaId || null
  schemaSaving.value = true
  try {
    await updateProduct(product.value.id, { schema_id: schemaId || null } as any)
    if (schemaId) {
      try {
        resolvedSchema.value = await getResolvedSchema(schemaId)
      } catch {
        const s = schemas.value.find(s => s.id === schemaId)
        if (s) resolvedSchema.value = resolveSchemaLocally(s, schemas.value)
      }
    } else {
      resolvedSchema.value = null
    }
  } catch (e: any) {
    error.value = e.message
  } finally {
    schemaSaving.value = false
  }
}

async function handleSaveProductData() {
  if (!product.value) return
  schemaSaving.value = true
  error.value = ''
  try {
    await updateProduct(product.value.id, { product_data: productData.value } as any)
    product.value.product_data = { ...productData.value }
  } catch (e: any) {
    error.value = e.message
  } finally {
    schemaSaving.value = false
  }
}

function setNestedValue(obj: Record<string, any>, path: string, value: any) {
  const parts = path.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {}
    }
    current = current[parts[i]]
  }
  current[parts[parts.length - 1]] = value
}

function getNestedValue(obj: Record<string, any>, path: string): any {
  const parts = path.split('.')
  let current = obj
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined
    current = current[part]
  }
  return current
}

function getSchemaFieldsGrouped() {
  if (!resolvedSchema.value?.properties) return []
  return Object.entries(resolvedSchema.value.properties)
    .filter(([, v]) => v.type === 'object' && v.properties)
    .map(([key, val]) => ({
      key,
      description: val.description || '',
      fields: Object.entries(val.properties || {}).map(([fk, fv]) => ({
        path: `${key}.${fk}`,
        key: fk,
        property: fv,
      })),
    }))
}

const rawJsonText = computed({
  get: () => JSON.stringify(productData.value, null, 2),
  set: (val: string) => {
    try { productData.value = JSON.parse(val) } catch {}
  },
})

async function handleSave() {
  saving.value = true
  error.value = ''

  try {
    const { brand, category, images, variants, manuals: _m, canonical_product, forks, product_schema, ...formFields } = form as any
    await updateProduct(route.params.id as string, {
      ...formFields,
      seo_keywords: form.seo_keywords ? form.seo_keywords.split(',').map((k: string) => k.trim()) : [],
      tags: form.tags ? form.tags.split(',').map((t: string) => t.trim()) : [],
      rendition_name: form.rendition_name || null,
      export_target: form.export_target || null,
    } as any)
    await load()
  } catch (e: any) {
    error.value = e.message || 'Failed to save'
  } finally {
    saving.value = false
  }
}

async function handleDelete() {
  if (!confirm('Are you sure you want to delete this product?')) return
  await deleteProduct(route.params.id as string)
  router.push('/products')
}

async function handleFork() {
  if (!forkForm.rendition_name.trim()) return
  forking.value = true
  try {
    const forked = await forkProduct(
      route.params.id as string,
      forkForm.rendition_name,
      forkForm.export_target,
    )
    showForkModal.value = false
    router.push(`/products/${forked.id}`)
  } catch (e: any) {
    error.value = e.message || 'Failed to fork'
  } finally {
    forking.value = false
  }
}

// Manual functions
function openNewManual() {
  editingManual.value = null
  manualForm.title = ''
  manualForm.content = ''
  manualForm.version = '1.0'
  showManualModal.value = true
}

function openEditManual(m: ProductManual) {
  editingManual.value = m
  manualForm.title = m.title
  manualForm.content = m.content
  manualForm.version = m.version
  showManualModal.value = true
}

async function handleSaveManual() {
  if (!manualForm.title.trim()) return
  manualSaving.value = true
  try {
    if (editingManual.value) {
      await updateManual(editingManual.value.id, {
        title: manualForm.title,
        content: manualForm.content,
        version: manualForm.version,
      })
    } else {
      await createManual(route.params.id as string, manualForm.title, manualForm.content)
    }
    showManualModal.value = false
    manuals.value = await getManuals(route.params.id as string)
  } finally {
    manualSaving.value = false
  }
}

async function handleDeleteManual(id: string) {
  if (!confirm('Delete this manual?')) return
  await deleteManual(id)
  manuals.value = await getManuals(route.params.id as string)
}

function exportManual(m: ProductManual, format: 'md' | 'txt') {
  let content = ''
  if (format === 'md') {
    content = `# ${m.title}\n\n_Version ${m.version}_\n\n${m.content}`
  } else {
    content = `${m.title}\nVersion ${m.version}\n${'='.repeat(40)}\n\n${m.content}`
  }
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const slug = m.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  a.download = `${slug}.${format}`
  a.click()
  URL.revokeObjectURL(url)
}

const tabs = computed(() => {
  const base = [
    { key: 'details', label: 'Details' },
    { key: 'identifiers', label: 'Identifiers' },
    { key: 'pricing', label: 'Pricing & Inventory' },
    { key: 'seo', label: 'SEO & Meta' },
    { key: 'schema', label: 'Schema & Data' },
    { key: 'manuals', label: `Manuals (${manuals.value.length})` },
  ]
  if (product.value?.is_canonical) {
    base.splice(5, 0, { key: 'forks', label: `Renditions (${product.value.forks?.length || 0})` })
  }
  return base
})

onMounted(() => { load(); loadBrandsAndCategories() })
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <svg class="h-8 w-8 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>

    <template v-else-if="product">
      <!-- Header -->
      <div class="mb-6 flex items-center justify-between">
        <div class="flex items-center gap-4">
          <NuxtLink to="/products" class="btn-ghost !px-2">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
          </NuxtLink>
          <div>
            <h1 class="text-2xl font-bold text-white">{{ product.title }}</h1>
            <div class="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge :status="product.status" />
              <span v-if="product.is_canonical" class="badge bg-purple-500/10 text-purple-400 ring-1 ring-inset ring-purple-500/20">
                Canonical
              </span>
              <span v-if="product.canonical_product_id" class="badge bg-cyan-500/10 text-cyan-400 ring-1 ring-inset ring-cyan-500/20">
                Fork
              </span>
              <span v-if="product.export_target" class="badge bg-orange-500/10 text-orange-400 ring-1 ring-inset ring-orange-500/20">
                {{ product.export_target }}
              </span>
              <span v-if="product.sku" class="text-sm text-gray-400">SKU: {{ product.sku }}</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-secondary" @click="showForkModal = true">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
            </svg>
            Fork
          </button>
          <button class="btn-danger" @click="handleDelete">Delete</button>
          <button class="btn-primary" :disabled="saving" @click="handleSave">
            {{ saving ? 'Saving...' : 'Save changes' }}
          </button>
        </div>
      </div>

      <!-- Canonical source info -->
      <div v-if="product.canonical_product" class="mb-4 flex items-center gap-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-3">
        <svg class="h-5 w-5 shrink-0 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
        </svg>
        <div class="flex-1 text-sm">
          <span class="text-gray-400">Forked from canonical: </span>
          <NuxtLink :to="`/products/${product.canonical_product.id}`" class="font-medium text-cyan-400 hover:underline">
            {{ product.canonical_product.title }}
          </NuxtLink>
        </div>
      </div>

      <div v-if="error" class="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{{ error }}</div>

      <!-- Tabs -->
      <div class="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-gray-800 bg-gray-900 p-1">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          :class="[
            'shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-all',
            activeTab === tab.key
              ? 'bg-gray-800 text-white shadow-sm'
              : 'text-gray-400 hover:text-white',
          ]"
          @click="activeTab = tab.key as any"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- Details tab -->
      <div v-show="activeTab === 'details'" class="space-y-4">
        <!-- Rendition info for forks -->
        <div v-if="product.canonical_product_id" class="card p-6 space-y-4">
          <h3 class="text-base font-semibold text-white">Rendition Info</h3>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label-field">Rendition Name</label>
              <input v-model="form.rendition_name" type="text" class="input-field" placeholder="e.g. US Shopify, EU Website" />
            </div>
            <div>
              <label class="label-field">Export Target</label>
              <select v-model="form.export_target" class="input-field">
                <option value="">None</option>
                <option value="shopify">Shopify</option>
                <option value="woocommerce">WooCommerce</option>
                <option value="amazon">Amazon</option>
                <option value="ebay">eBay</option>
                <option value="website">Website</option>
                <option value="print_catalog">Print Catalog</option>
                <option value="pos">Point of Sale</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
        </div>

        <div class="card p-6 space-y-4">
          <div>
            <label class="label-field">Title</label>
            <input v-model="form.title" type="text" class="input-field" />
          </div>
          <div>
            <label class="label-field">Short Description</label>
            <input v-model="form.short_description" type="text" class="input-field" />
          </div>
          <div>
            <label class="label-field">Description</label>
            <textarea v-model="form.description" rows="5" class="input-field" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label-field">Brand</label>
              <select v-model="form.brand_id" class="input-field">
                <option :value="null">— No brand —</option>
                <option v-for="b in brands" :key="b.id" :value="b.id">{{ b.name }}</option>
              </select>
            </div>
            <div>
              <label class="label-field">Category</label>
              <select v-model="form.category_id" class="input-field">
                <option :value="null">— No category —</option>
                <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label-field">Status</label>
              <select v-model="form.status" class="input-field">
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label class="label-field">Tags</label>
              <input v-model="form.tags" type="text" class="input-field" placeholder="tag1, tag2" />
            </div>
          </div>
          <div class="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
            <label class="flex items-center gap-3 cursor-pointer">
              <input v-model="form.is_canonical" type="checkbox" class="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500" />
              <div>
                <p class="text-sm font-medium text-white">Canonical (Base) Product</p>
                <p class="text-xs text-gray-400">Mark as the manufacturer's authoritative product definition.</p>
              </div>
            </label>
          </div>
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <label class="label-field">Weight</label>
              <div class="flex gap-2">
                <input v-model.number="form.weight" type="number" step="0.001" class="input-field flex-1" />
                <select v-model="form.weight_unit" class="input-field w-20">
                  <option value="kg">kg</option>
                  <option value="lb">lb</option>
                  <option value="g">g</option>
                  <option value="oz">oz</option>
                </select>
              </div>
            </div>
            <div>
              <label class="label-field">Length</label>
              <input v-model.number="form.length" type="number" step="0.01" class="input-field" />
            </div>
            <div>
              <label class="label-field">Width</label>
              <input v-model.number="form.width" type="number" step="0.01" class="input-field" />
            </div>
            <div>
              <label class="label-field">Height</label>
              <input v-model.number="form.height" type="number" step="0.01" class="input-field" />
            </div>
            <div>
              <label class="label-field">Dimension Unit</label>
              <select v-model="form.dimension_unit" class="input-field">
                <option value="cm">cm</option>
                <option value="in">in</option>
                <option value="m">m</option>
                <option value="ft">ft</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Identifiers tab -->
      <div v-show="activeTab === 'identifiers'" class="card p-6">
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <label class="label-field">SKU</label>
            <input v-model="form.sku" type="text" class="input-field" />
          </div>
          <div>
            <label class="label-field">EAN</label>
            <input v-model="form.ean" type="text" class="input-field" />
          </div>
          <div>
            <label class="label-field">UPC</label>
            <input v-model="form.upc" type="text" class="input-field" />
          </div>
          <div>
            <label class="label-field">GTIN</label>
            <input v-model="form.gtin" type="text" class="input-field" />
          </div>
          <div>
            <label class="label-field">ISBN</label>
            <input v-model="form.isbn" type="text" class="input-field" />
          </div>
          <div>
            <label class="label-field">ASIN</label>
            <input v-model="form.asin" type="text" class="input-field" />
          </div>
          <div>
            <label class="label-field">MPN</label>
            <input v-model="form.mpn" type="text" class="input-field" />
          </div>
        </div>
      </div>

      <!-- Pricing & Inventory tab -->
      <div v-show="activeTab === 'pricing'" class="space-y-6">
        <div class="card p-6">
          <h3 class="mb-4 text-base font-semibold text-white">Pricing</h3>
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <label class="label-field">Cost Price</label>
              <input v-model.number="form.cost_price" type="number" step="0.01" class="input-field" />
            </div>
            <div>
              <label class="label-field">Retail Price</label>
              <input v-model.number="form.retail_price" type="number" step="0.01" class="input-field" />
            </div>
            <div>
              <label class="label-field">Sale Price</label>
              <input v-model.number="form.sale_price" type="number" step="0.01" class="input-field" />
            </div>
            <div>
              <label class="label-field">Currency</label>
              <select v-model="form.currency" class="input-field">
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="AUD">AUD</option>
                <option value="CAD">CAD</option>
                <option value="JPY">JPY</option>
                <option value="SGD">SGD</option>
                <option value="MYR">MYR</option>
              </select>
            </div>
          </div>
        </div>
        <div class="card p-6">
          <h3 class="mb-4 text-base font-semibold text-white">Inventory</h3>
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <label class="label-field">Stock Quantity</label>
              <input v-model.number="form.stock_quantity" type="number" class="input-field" />
            </div>
            <div>
              <label class="label-field">Low Stock Threshold</label>
              <input v-model.number="form.low_stock_threshold" type="number" class="input-field" />
            </div>
            <div class="flex items-end pb-1">
              <label class="flex items-center gap-2 text-sm text-gray-300">
                <input v-model="form.track_inventory" type="checkbox" class="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500" />
                Track inventory
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- SEO tab -->
      <div v-show="activeTab === 'seo'" class="card p-6 space-y-4">
        <div>
          <label class="label-field">SEO Title</label>
          <input v-model="form.seo_title" type="text" class="input-field" />
          <p class="mt-1 text-xs text-gray-500">{{ form.seo_title?.length || 0 }} / 60</p>
        </div>
        <div>
          <label class="label-field">SEO Description</label>
          <textarea v-model="form.seo_description" rows="3" class="input-field" />
          <p class="mt-1 text-xs text-gray-500">{{ form.seo_description?.length || 0 }} / 160</p>
        </div>
        <div>
          <label class="label-field">Keywords</label>
          <input v-model="form.seo_keywords" type="text" class="input-field" placeholder="keyword1, keyword2" />
        </div>
        <div>
          <label class="label-field">Canonical URL</label>
          <input v-model="form.canonical_url" type="url" class="input-field" />
        </div>
        <div class="mt-6 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500 mb-3">Search Preview</p>
          <p class="text-lg text-blue-400 hover:underline">{{ form.seo_title || form.title || 'Page Title' }}</p>
          <p class="text-sm text-emerald-400">{{ form.canonical_url || 'https://yourstore.com/products/...' }}</p>
          <p class="mt-1 text-sm text-gray-400">{{ form.seo_description || form.short_description || 'Add a meta description...' }}</p>
        </div>
      </div>

      <!-- Schema & Data tab -->
      <div v-show="activeTab === 'schema'" class="space-y-6">
        <!-- Schema Selector -->
        <div class="card p-5">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h3 class="text-base font-semibold text-white">Assigned Schema</h3>
              <p class="mt-0.5 text-sm text-gray-400">Select a schema to structure this product's dynamic data.</p>
            </div>
            <NuxtLink to="/schema" class="text-xs text-indigo-400 hover:text-indigo-300">
              Manage Schemas &rarr;
            </NuxtLink>
          </div>
          <select
            :value="selectedSchemaId || ''"
            class="input-field"
            @change="handleSchemaChange(($event.target as HTMLSelectElement).value)"
          >
            <option value="">No schema assigned</option>
            <option
              v-for="s in schemas"
              :key="s.id"
              :value="s.id"
            >
              {{ s.name }} ({{ s.workspace_id ? 'Workspace' : 'Global' }}) — v{{ s.version }}
            </option>
          </select>
        </div>

        <!-- Schema Data Editor -->
        <template v-if="resolvedSchema">
          <div class="flex items-center justify-between">
            <div class="flex rounded-lg border border-gray-800 bg-gray-900 p-0.5">
              <button
                v-for="v in [{ key: 'form', label: 'Form' }, { key: 'json', label: 'JSON Schema' }, { key: 'raw', label: 'Raw Data' }]"
                :key="v.key"
                :class="[
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                  schemaView === v.key ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white',
                ]"
                @click="schemaView = v.key as any"
              >
                {{ v.label }}
              </button>
            </div>
            <button
              v-if="schemaView !== 'json'"
              class="btn-primary text-xs"
              :disabled="schemaSaving"
              @click="handleSaveProductData"
            >
              {{ schemaSaving ? 'Saving...' : 'Save Data' }}
            </button>
          </div>

          <!-- Form View -->
          <div v-if="schemaView === 'form'" class="space-y-4">
            <div v-for="group in getSchemaFieldsGrouped()" :key="group.key" class="card overflow-hidden">
              <div class="border-b border-gray-800 bg-gray-900/50 px-4 py-3">
                <h4 class="text-sm font-semibold text-white capitalize">{{ group.key.replace(/_/g, ' ') }}</h4>
                <p v-if="group.description" class="text-xs text-gray-500 mt-0.5">{{ group.description }}</p>
              </div>
              <div class="p-4 space-y-3">
                <div v-for="field in group.fields" :key="field.path" class="grid grid-cols-3 gap-3 items-start">
                  <div class="pt-2">
                    <label class="text-sm font-medium text-gray-300">{{ field.key.replace(/_/g, ' ') }}</label>
                    <p v-if="field.property.description" class="text-xs text-gray-500">{{ field.property.description }}</p>
                  </div>
                  <div class="col-span-2">
                    <!-- Boolean -->
                    <label v-if="field.property.type === 'boolean'" class="flex items-center gap-2">
                      <input
                        type="checkbox"
                        :checked="!!getNestedValue(productData, field.path)"
                        class="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
                        @change="setNestedValue(productData, field.path, ($event.target as HTMLInputElement).checked)"
                      />
                      <span class="text-sm text-gray-400">{{ getNestedValue(productData, field.path) ? 'Yes' : 'No' }}</span>
                    </label>
                    <!-- Enum select -->
                    <select
                      v-else-if="field.property.enum"
                      :value="getNestedValue(productData, field.path) || ''"
                      class="input-field"
                      @change="setNestedValue(productData, field.path, ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="">—</option>
                      <option v-for="opt in field.property.enum" :key="opt" :value="opt">{{ opt }}</option>
                    </select>
                    <!-- Number / Integer -->
                    <input
                      v-else-if="field.property.type === 'number' || field.property.type === 'integer'"
                      type="number"
                      :step="field.property.type === 'integer' ? '1' : '0.01'"
                      :value="getNestedValue(productData, field.path) ?? ''"
                      class="input-field"
                      @input="setNestedValue(productData, field.path, ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null)"
                    />
                    <!-- Array (show as comma-separated) -->
                    <input
                      v-else-if="field.property.type === 'array'"
                      type="text"
                      :value="(getNestedValue(productData, field.path) || []).join(', ')"
                      class="input-field"
                      :placeholder="'Comma-separated values'"
                      @change="setNestedValue(productData, field.path, ($event.target as HTMLInputElement).value.split(',').map((s: string) => s.trim()).filter(Boolean))"
                    />
                    <!-- String (default) -->
                    <input
                      v-else
                      type="text"
                      :value="getNestedValue(productData, field.path) || ''"
                      class="input-field"
                      :placeholder="field.property.default !== undefined ? String(field.property.default) : ''"
                      @input="setNestedValue(productData, field.path, ($event.target as HTMLInputElement).value || null)"
                    />
                    <div class="mt-1 flex items-center gap-2">
                      <span class="text-xs text-gray-600">{{ field.property.type }}</span>
                      <span v-if="field.property.format" class="text-xs text-amber-600">{{ field.property.format }}</span>
                      <span v-if="field.property.maxLength" class="text-xs text-gray-600">max: {{ field.property.maxLength }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- JSON Schema View -->
          <div v-else-if="schemaView === 'json'" class="card overflow-hidden">
            <div class="border-b border-gray-800 bg-gray-900/50 px-4 py-3">
              <span class="text-sm font-medium text-white">Resolved JSON Schema</span>
            </div>
            <JsonView :data="resolvedSchema" max-height="600px" />
          </div>

          <!-- Raw Data View -->
          <div v-else-if="schemaView === 'raw'" class="card overflow-hidden">
            <div class="border-b border-gray-800 bg-gray-900/50 px-4 py-3">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-white">Raw Product Data (JSONB)</span>
                <span class="text-xs text-gray-500">Edit the JSON directly</span>
              </div>
            </div>
            <textarea
              :value="rawJsonText"
              class="w-full bg-transparent p-4 font-mono text-sm text-gray-300 focus:outline-none min-h-[400px] resize-y"
              @input="rawJsonText = ($event.target as HTMLTextAreaElement).value"
            />
          </div>
        </template>

        <!-- No schema assigned -->
        <div v-else class="card p-8 text-center">
          <svg class="mx-auto h-10 w-10 text-gray-700" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
          </svg>
          <h3 class="mt-3 text-sm font-medium text-white">No schema assigned</h3>
          <p class="mt-1 text-sm text-gray-400">Select a schema above to enable dynamic product data entry.</p>
        </div>
      </div>

      <!-- Forks / Renditions tab -->
      <div v-if="product.is_canonical" v-show="activeTab === 'forks'" class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-lg font-semibold text-white">Renditions</h3>
            <p class="mt-0.5 text-sm text-gray-400">Forks of this canonical product for different channels</p>
          </div>
          <button class="btn-primary" @click="showForkModal = true">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Create rendition
          </button>
        </div>

        <div v-if="!product.forks?.length">
          <EmptyState
            title="No renditions yet"
            description="Fork this canonical product to create tailored versions for different sales channels."
            action-label="Create rendition"
            @action="showForkModal = true"
          />
        </div>

        <div v-else class="space-y-2">
          <NuxtLink
            v-for="fork in product.forks"
            :key="fork.id"
            :to="`/products/${fork.id}`"
            class="card flex items-center justify-between p-4 transition-all hover:border-gray-700"
          >
            <div class="flex items-center gap-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-600/10">
                <svg class="h-5 w-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
                </svg>
              </div>
              <div>
                <p class="font-medium text-white">{{ fork.rendition_name || fork.title }}</p>
                <div class="mt-0.5 flex items-center gap-2">
                  <span v-if="fork.export_target" class="badge bg-orange-500/10 text-orange-400 ring-1 ring-inset ring-orange-500/20">
                    {{ fork.export_target }}
                  </span>
                  <StatusBadge :status="fork.status" />
                </div>
              </div>
            </div>
            <svg class="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </NuxtLink>
        </div>
      </div>

      <!-- Manuals tab -->
      <div v-show="activeTab === 'manuals'" class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-lg font-semibold text-white">Product Manuals</h3>
            <p class="mt-0.5 text-sm text-gray-400">Create documentation exportable as .md or .txt</p>
          </div>
          <button class="btn-primary" @click="openNewManual">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add manual
          </button>
        </div>

        <div v-if="manuals.length === 0">
          <EmptyState
            title="No manuals yet"
            description="Create product documentation that you can export to Markdown or plain text."
            action-label="Create manual"
            @action="openNewManual"
          />
        </div>

        <div v-else class="space-y-3">
          <div v-for="m in manuals" :key="m.id" class="card p-5">
            <div class="flex items-start justify-between">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <h4 class="font-semibold text-white">{{ m.title }}</h4>
                  <span class="text-xs text-gray-500">v{{ m.version }}</span>
                </div>
                <p class="mt-1 text-sm text-gray-400 line-clamp-2">{{ m.content || 'Empty manual' }}</p>
                <p class="mt-2 text-xs text-gray-500">Updated {{ new Date(m.updated_at).toLocaleDateString() }}</p>
              </div>
              <div class="ml-4 flex items-center gap-1 shrink-0">
                <button class="btn-ghost !p-1.5 text-indigo-400" title="Export .md" @click="exportManual(m, 'md')">
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                </button>
                <button class="btn-ghost !p-1.5" title="Edit" @click="openEditManual(m)">
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                  </svg>
                </button>
                <button class="btn-ghost !p-1.5 text-red-400" @click="handleDeleteManual(m.id)">
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
            <!-- Export buttons -->
            <div class="mt-3 flex gap-2 border-t border-gray-800 pt-3">
              <button class="btn-ghost !py-1 !px-2 !text-xs" @click="exportManual(m, 'md')">
                Export .md
              </button>
              <button class="btn-ghost !py-1 !px-2 !text-xs" @click="exportManual(m, 'txt')">
                Export .txt
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="py-20 text-center text-gray-400">
      {{ error || 'Product not found' }}
    </div>

    <!-- Fork Modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div v-if="showForkModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="showForkModal = false">
          <div class="card w-full max-w-md p-6">
            <h2 class="mb-1 text-lg font-semibold text-white">Fork Product</h2>
            <p class="mb-4 text-sm text-gray-400">
              Create a rendition of "{{ product?.title }}" for a specific channel or export.
            </p>
            <form class="space-y-4" @submit.prevent="handleFork">
              <div>
                <label class="label-field">Rendition Name *</label>
                <input v-model="forkForm.rendition_name" type="text" required class="input-field" placeholder="e.g. US Shopify, EU Amazon" />
              </div>
              <div>
                <label class="label-field">Export Target</label>
                <select v-model="forkForm.export_target" class="input-field">
                  <option value="">None</option>
                  <option value="shopify">Shopify</option>
                  <option value="woocommerce">WooCommerce</option>
                  <option value="amazon">Amazon</option>
                  <option value="ebay">eBay</option>
                  <option value="website">Website</option>
                  <option value="print_catalog">Print Catalog</option>
                  <option value="pos">Point of Sale</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div class="flex justify-end gap-3 pt-2">
                <button type="button" class="btn-secondary" @click="showForkModal = false">Cancel</button>
                <button type="submit" class="btn-primary" :disabled="forking">
                  {{ forking ? 'Forking...' : 'Create fork' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Manual Editor Modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div v-if="showManualModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="showManualModal = false">
          <div class="card w-full max-w-2xl p-6">
            <h2 class="mb-4 text-lg font-semibold text-white">
              {{ editingManual ? 'Edit Manual' : 'New Manual' }}
            </h2>
            <form class="space-y-4" @submit.prevent="handleSaveManual">
              <div class="grid grid-cols-3 gap-4">
                <div class="col-span-2">
                  <label class="label-field">Title *</label>
                  <input v-model="manualForm.title" type="text" required class="input-field" placeholder="e.g. User Guide, Safety Instructions" />
                </div>
                <div>
                  <label class="label-field">Version</label>
                  <input v-model="manualForm.version" type="text" class="input-field" placeholder="1.0" />
                </div>
              </div>
              <div>
                <label class="label-field">Content (Markdown)</label>
                <textarea
                  v-model="manualForm.content"
                  rows="16"
                  class="input-field font-mono text-sm"
                  placeholder="# Getting Started&#10;&#10;Write your product manual here using Markdown...&#10;&#10;## Features&#10;&#10;- Feature 1&#10;- Feature 2"
                />
              </div>
              <div class="flex justify-end gap-3 pt-2">
                <button type="button" class="btn-secondary" @click="showManualModal = false">Cancel</button>
                <button type="submit" class="btn-primary" :disabled="manualSaving">
                  {{ manualSaving ? 'Saving...' : editingManual ? 'Update' : 'Create' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
