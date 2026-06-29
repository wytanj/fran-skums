<script setup lang="ts">
import type { ProductSchemaDefinition, SchemaProperty, Brand, Category } from '~/types'

const router = useRouter()
const client = useSupabaseClient()
const { currentWorkspace } = useWorkspace()
const { createProduct } = useProducts()
const { schemas, fetchSchemas, resolveSchemaLocally, GLOBAL_BASE_SCHEMA_ID } = useProductSchema()

const saving = ref(false)
const error = ref('')

const title = ref('')
const brandId = ref<string | null>(null)
const categoryId = ref<string | null>(null)
const status = ref<'draft' | 'active' | 'archived'>('draft')
const tags = ref('')
const isCanonical = ref(false)
const selectedSchemaId = ref<string | null>(null)

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

const resolvedSchema = ref<ProductSchemaDefinition | null>(null)
const productData = ref<Record<string, any>>({})

function getSchemaGroups() {
  if (!resolvedSchema.value?.properties) return []
  return Object.entries(resolvedSchema.value.properties)
    .filter(([, v]) => v.type === 'object' && v.properties)
    .map(([key, val]) => ({
      key,
      label: key.replace(/_/g, ' '),
      description: val.description || '',
      fields: Object.entries(val.properties || {}).map(([fk, fv]) => ({
        path: `${key}.${fk}`,
        key: fk,
        label: fk.replace(/_/g, ' '),
        property: fv as SchemaProperty,
      })),
    }))
}

function getTopLevelFields() {
  if (!resolvedSchema.value?.properties) return []
  return Object.entries(resolvedSchema.value.properties)
    .filter(([, v]) => !(v.type === 'object' && v.properties))
    .map(([key, val]) => ({
      path: key,
      key,
      label: key.replace(/_/g, ' '),
      property: val as SchemaProperty,
    }))
}

function setNested(obj: Record<string, any>, path: string, value: any) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}
    cur = cur[parts[i]]
  }
  cur[parts[parts.length - 1]] = value
}

function getNested(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((c, k) => c?.[k], obj)
}

async function handleSchemaChange() {
  if (!selectedSchemaId.value) {
    resolvedSchema.value = null
    productData.value = {}
    return
  }
  const schema = schemas.value.find(s => s.id === selectedSchemaId.value)
  if (schema) {
    resolvedSchema.value = resolveSchemaLocally(schema, schemas.value)
    productData.value = {}
  }
}

async function handleSubmit() {
  if (!title.value.trim()) return
  saving.value = true
  error.value = ''

  try {
    const product = await createProduct({
      title: title.value.trim(),
      brand_id: brandId.value || null,
      category_id: categoryId.value || null,
      status: status.value,
      tags: tags.value ? tags.value.split(',').map(t => t.trim()) : [],
      is_canonical: isCanonical.value,
      schema_id: selectedSchemaId.value || null,
      product_data: productData.value,
    } as any)
    router.push(`/products/${product.id}`)
  } catch (e: any) {
    error.value = e.message || 'Failed to create product'
    saving.value = false
  }
}

onMounted(async () => {
  await Promise.all([fetchSchemas(), loadBrandsAndCategories()])
  // Auto-select global base schema if available
  const globalBase = schemas.value.find(s => s.id === GLOBAL_BASE_SCHEMA_ID)
  if (globalBase) {
    selectedSchemaId.value = globalBase.id
    await handleSchemaChange()
  }
})
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <!-- Header -->
    <div class="mb-6 flex items-center justify-between">
      <div class="flex items-center gap-4">
        <NuxtLink to="/products" class="btn-ghost !px-2">
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        </NuxtLink>
        <h1 class="text-2xl font-bold text-white">New Product</h1>
      </div>
      <div class="flex items-center gap-3">
        <NuxtLink to="/products" class="btn-secondary">Cancel</NuxtLink>
        <button class="btn-primary" :disabled="saving || !title.trim()" @click="handleSubmit">
          {{ saving ? 'Saving...' : 'Create product' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{{ error }}</div>

    <form class="space-y-6" @submit.prevent="handleSubmit">
      <!-- Essential Info (always shown) -->
      <div class="card p-6">
        <h2 class="mb-4 text-lg font-semibold text-white">Product</h2>
        <div class="space-y-4">
          <div>
            <label class="label-field">Title *</label>
            <input v-model="title" type="text" required class="input-field" placeholder="Product name" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label-field">Brand</label>
              <select v-model="brandId" class="input-field">
                <option :value="null">— No brand —</option>
                <option v-for="b in brands" :key="b.id" :value="b.id">{{ b.name }}</option>
              </select>
            </div>
            <div>
              <label class="label-field">Category</label>
              <select v-model="categoryId" class="input-field">
                <option :value="null">— No category —</option>
                <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label-field">Status</label>
              <select v-model="status" class="input-field">
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label class="label-field">Tags</label>
              <input v-model="tags" type="text" class="input-field" placeholder="tag1, tag2, tag3" />
            </div>
          </div>
          <div class="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
            <label class="flex items-center gap-3 cursor-pointer">
              <input v-model="isCanonical" type="checkbox" class="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500" />
              <div>
                <p class="text-sm font-medium text-white">Canonical (Base) Product</p>
                <p class="text-xs text-gray-400">Mark as the manufacturer's authoritative product definition.</p>
              </div>
            </label>
          </div>
          <div>
            <label class="label-field">Product Schema</label>
            <select v-model="selectedSchemaId" class="input-field" @change="handleSchemaChange">
              <option :value="null">No schema</option>
              <option v-for="s in schemas" :key="s.id" :value="s.id">
                {{ s.name }} ({{ s.workspace_id ? 'Workspace' : 'Global' }})
              </option>
            </select>
            <p class="mt-1 text-xs text-gray-500">The schema determines which fields appear below.</p>
          </div>
        </div>
      </div>

      <!-- Dynamic Schema Fields -->
      <template v-if="resolvedSchema">
        <div v-for="group in getSchemaGroups()" :key="group.key" class="card p-6">
          <h2 class="mb-1 text-lg font-semibold text-white capitalize">{{ group.label }}</h2>
          <p v-if="group.description" class="mb-4 text-sm text-gray-400">{{ group.description }}</p>
          <div class="grid grid-cols-2 gap-4" :class="{ 'sm:grid-cols-3': group.fields.length > 4 }">
            <div v-for="field in group.fields" :key="field.path">
              <label class="label-field capitalize">{{ field.label }}</label>

              <!-- Boolean -->
              <label v-if="field.property.type === 'boolean'" class="flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  :checked="!!getNested(productData, field.path)"
                  class="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
                  @change="setNested(productData, field.path, ($event.target as HTMLInputElement).checked)"
                />
                <span class="text-sm text-gray-400">{{ field.property.description || '' }}</span>
              </label>

              <!-- Enum select -->
              <select
                v-else-if="field.property.enum"
                :value="getNested(productData, field.path) || ''"
                class="input-field"
                @change="setNested(productData, field.path, ($event.target as HTMLSelectElement).value || null)"
              >
                <option value="">—</option>
                <option v-for="opt in field.property.enum" :key="opt" :value="opt">{{ opt }}</option>
              </select>

              <!-- Number -->
              <input
                v-else-if="field.property.type === 'number' || field.property.type === 'integer'"
                type="number"
                :step="field.property.type === 'integer' ? '1' : '0.01'"
                :value="getNested(productData, field.path) ?? ''"
                class="input-field"
                :placeholder="field.property.description || ''"
                @input="setNested(productData, field.path, ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null)"
              />

              <!-- Array -->
              <input
                v-else-if="field.property.type === 'array'"
                type="text"
                :value="(getNested(productData, field.path) || []).join(', ')"
                class="input-field"
                placeholder="Comma-separated"
                @change="setNested(productData, field.path, ($event.target as HTMLInputElement).value.split(',').map((s: string) => s.trim()).filter(Boolean))"
              />

              <!-- String (default) -->
              <input
                v-else
                type="text"
                :value="getNested(productData, field.path) || ''"
                class="input-field"
                :placeholder="field.property.description || ''"
                @input="setNested(productData, field.path, ($event.target as HTMLInputElement).value || null)"
              />

              <p v-if="field.property.description && field.property.type !== 'boolean'" class="mt-0.5 text-xs text-gray-600 truncate">{{ field.property.description }}</p>
            </div>
          </div>
        </div>

        <!-- Top-level non-object fields -->
        <div v-if="getTopLevelFields().length > 0" class="card p-6">
          <h2 class="mb-4 text-lg font-semibold text-white">Other Fields</h2>
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div v-for="field in getTopLevelFields()" :key="field.path">
              <label class="label-field capitalize">{{ field.label }}</label>
              <input
                v-if="field.property.type === 'string'"
                type="text"
                :value="getNested(productData, field.path) || ''"
                class="input-field"
                :placeholder="field.property.description || ''"
                @input="setNested(productData, field.path, ($event.target as HTMLInputElement).value || null)"
              />
              <input
                v-else-if="field.property.type === 'number' || field.property.type === 'integer'"
                type="number"
                :value="getNested(productData, field.path) ?? ''"
                class="input-field"
                @input="setNested(productData, field.path, ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null)"
              />
            </div>
          </div>
        </div>
      </template>

      <!-- No schema hint -->
      <div v-else class="card p-6 text-center">
        <svg class="mx-auto h-8 w-8 text-gray-700" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
        </svg>
        <p class="mt-2 text-sm text-gray-400">Select a schema above to see dynamic product fields.</p>
        <NuxtLink to="/schema" class="mt-1 text-xs text-indigo-400 hover:underline">Manage schemas &rarr;</NuxtLink>
      </div>
    </form>
  </div>
</template>
