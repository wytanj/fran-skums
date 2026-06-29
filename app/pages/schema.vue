<script setup lang="ts">
import type { ProductSchema, ProductSchemaDefinition, SchemaProperty } from '~/types'

const {
  schemas,
  globalSchema,
  loading,
  GLOBAL_BASE_SCHEMA_ID,
  fetchSchemas,
  createSchema,
  updateSchema,
  deleteSchema,
  resolveSchemaLocally,
} = useProductSchema()

const activeSchemaId = ref<string | null>(null)
const activeSchema = computed(() => schemas.value.find(s => s.id === activeSchemaId.value) || null)
const resolvedSchema = computed(() => {
  if (!activeSchema.value) return null
  return resolveSchemaLocally(activeSchema.value, schemas.value)
})

const view = ref<'tree' | 'json' | 'resolved'>('tree')
const showCreateModal = ref(false)
const showAddPropertyModal = ref(false)
const saving = ref(false)
const errorMsg = ref('')

const createForm = reactive({
  name: '',
  slug: '',
  description: '',
})

const propertyForm = reactive({
  group: '',
  key: '',
  type: 'string' as string,
  description: '',
  enumValues: '',
  defaultValue: '',
  required: false,
  format: '',
})

const JSON_SCHEMA_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object']

function autoSlug() {
  createForm.slug = createForm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

async function handleCreate() {
  if (!createForm.name.trim() || !createForm.slug.trim()) return
  saving.value = true
  errorMsg.value = ''
  try {
    const newSchema = await createSchema({
      name: createForm.name,
      slug: createForm.slug,
      description: createForm.description || undefined,
      schema: { type: 'object', properties: {} },
      extends_schema_id: GLOBAL_BASE_SCHEMA_ID,
    })
    showCreateModal.value = false
    createForm.name = ''
    createForm.slug = ''
    createForm.description = ''
    await fetchSchemas()
    activeSchemaId.value = newSchema.id
  } catch (e: any) {
    errorMsg.value = e.message
  } finally {
    saving.value = false
  }
}

function openAddProperty(group = '') {
  propertyForm.group = group
  propertyForm.key = ''
  propertyForm.type = 'string'
  propertyForm.description = ''
  propertyForm.enumValues = ''
  propertyForm.defaultValue = ''
  propertyForm.required = false
  propertyForm.format = ''
  showAddPropertyModal.value = true
}

async function handleAddProperty() {
  if (!activeSchema.value || !propertyForm.key.trim()) return
  saving.value = true
  errorMsg.value = ''

  try {
    const schema = JSON.parse(JSON.stringify(activeSchema.value.schema)) as ProductSchemaDefinition
    if (!schema.properties) schema.properties = {}

    const prop: SchemaProperty = {
      type: propertyForm.type,
    }
    if (propertyForm.description) prop.description = propertyForm.description
    if (propertyForm.enumValues) prop.enum = propertyForm.enumValues.split(',').map(v => v.trim())
    if (propertyForm.format) prop.format = propertyForm.format
    if (propertyForm.defaultValue) {
      if (propertyForm.type === 'number' || propertyForm.type === 'integer') {
        prop.default = Number(propertyForm.defaultValue)
      } else if (propertyForm.type === 'boolean') {
        prop.default = propertyForm.defaultValue === 'true'
      } else {
        prop.default = propertyForm.defaultValue
      }
    }

    if (propertyForm.group) {
      if (!schema.properties[propertyForm.group]) {
        schema.properties[propertyForm.group] = { type: 'object', properties: {} }
      }
      const groupObj = schema.properties[propertyForm.group]
      if (!groupObj.properties) groupObj.properties = {}
      groupObj.properties[propertyForm.key] = prop
    } else {
      schema.properties[propertyForm.key] = prop
    }

    await updateSchema(activeSchema.value.id, { schema })
    showAddPropertyModal.value = false
    await fetchSchemas()
  } catch (e: any) {
    errorMsg.value = e.message
  } finally {
    saving.value = false
  }
}

async function removeProperty(group: string, key: string) {
  if (!activeSchema.value) return
  if (!confirm(`Remove property "${group ? group + '.' : ''}${key}"?`)) return

  const schema = JSON.parse(JSON.stringify(activeSchema.value.schema)) as ProductSchemaDefinition
  if (!schema.properties) return

  if (group && schema.properties[group]?.properties) {
    delete schema.properties[group].properties![key]
  } else {
    delete schema.properties[key]
  }

  await updateSchema(activeSchema.value.id, { schema })
  await fetchSchemas()
}

async function handleDeleteSchema() {
  if (!activeSchema.value) return
  if (!confirm(`Delete schema "${activeSchema.value.name}"? This cannot be undone.`)) return
  await deleteSchema(activeSchema.value.id)
  activeSchemaId.value = null
  await fetchSchemas()
}

function getTypeColor(type: string) {
  const map: Record<string, string> = {
    string: 'text-emerald-400',
    number: 'text-blue-400',
    integer: 'text-blue-400',
    boolean: 'text-amber-400',
    array: 'text-purple-400',
    object: 'text-cyan-400',
  }
  return map[type] || 'text-gray-400'
}

function getTypeBadge(type: string) {
  const map: Record<string, string> = {
    string: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
    number: 'bg-blue-500/10 text-blue-400 ring-blue-500/20',
    integer: 'bg-blue-500/10 text-blue-400 ring-blue-500/20',
    boolean: 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
    array: 'bg-purple-500/10 text-purple-400 ring-purple-500/20',
    object: 'bg-cyan-500/10 text-cyan-400 ring-cyan-500/20',
  }
  return map[type] || 'bg-gray-500/10 text-gray-400 ring-gray-500/20'
}

function formatJSON(obj: any) {
  return JSON.stringify(obj, null, 2)
}

function getPropertyGroups(schema: ProductSchemaDefinition | null) {
  if (!schema?.properties) return []
  return Object.entries(schema.properties)
    .filter(([, v]) => v.type === 'object' && v.properties)
    .map(([key, val]) => ({
      key,
      description: val.description || '',
      properties: Object.entries(val.properties || {}),
    }))
}

function getTopLevelProperties(schema: ProductSchemaDefinition | null) {
  if (!schema?.properties) return []
  return Object.entries(schema.properties).filter(([, v]) => v.type !== 'object' || !v.properties)
}

const isGlobalSchema = computed(() => activeSchema.value?.workspace_id === null)
const isWorkspaceSchema = computed(() => activeSchema.value?.workspace_id !== null)
const workspaceSchemas = computed(() => schemas.value.filter(s => s.workspace_id !== null))
const globalSchemas = computed(() => schemas.value.filter(s => s.workspace_id === null))

onMounted(async () => {
  await fetchSchemas()
  if (globalSchema.value) {
    activeSchemaId.value = globalSchema.value.id
  }
})
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-white">Product Schema Builder</h1>
        <p class="mt-1 text-sm text-gray-400">Define the structure of your product data. Extend the global base schema with workspace-specific properties.</p>
      </div>
      <button class="btn-primary" @click="showCreateModal = true">
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New Schema
      </button>
    </div>

    <div v-if="errorMsg" class="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{{ errorMsg }}</div>

    <div class="flex gap-6">
      <!-- Schema List (Left Panel) -->
      <div class="w-72 shrink-0 space-y-4">
        <!-- Global Schemas -->
        <div>
          <p class="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">Global Base</p>
          <div class="space-y-1">
            <button
              v-for="s in globalSchemas"
              :key="s.id"
              :class="[
                'w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-all',
                activeSchemaId === s.id
                  ? 'border-indigo-500/50 bg-indigo-500/10 text-white'
                  : 'border-gray-800 bg-gray-900 text-gray-400 hover:border-gray-700 hover:text-white',
              ]"
              @click="activeSchemaId = s.id"
            >
              <div class="flex items-center gap-2">
                <svg class="h-4 w-4 shrink-0 text-purple-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                </svg>
                <span class="truncate font-medium">{{ s.name }}</span>
              </div>
              <p class="mt-0.5 truncate text-xs text-gray-500">v{{ s.version }}</p>
            </button>
          </div>
        </div>

        <!-- Workspace Schemas -->
        <div>
          <p class="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">Workspace Extensions</p>
          <div v-if="workspaceSchemas.length === 0" class="rounded-lg border border-dashed border-gray-800 px-3 py-4 text-center text-xs text-gray-500">
            No custom schemas yet.<br />Create one to extend the base.
          </div>
          <div v-else class="space-y-1">
            <button
              v-for="s in workspaceSchemas"
              :key="s.id"
              :class="[
                'w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-all',
                activeSchemaId === s.id
                  ? 'border-indigo-500/50 bg-indigo-500/10 text-white'
                  : 'border-gray-800 bg-gray-900 text-gray-400 hover:border-gray-700 hover:text-white',
              ]"
              @click="activeSchemaId = s.id"
            >
              <div class="flex items-center gap-2">
                <svg class="h-4 w-4 shrink-0 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
                </svg>
                <span class="truncate font-medium">{{ s.name }}</span>
              </div>
              <p class="mt-0.5 truncate text-xs text-gray-500">{{ s.description || `v${s.version}` }}</p>
            </button>
          </div>
        </div>
      </div>

      <!-- Schema Detail (Right Panel) -->
      <div class="min-w-0 flex-1">
        <template v-if="activeSchema">
          <!-- Schema Header -->
          <div class="mb-4 flex items-start justify-between">
            <div>
              <div class="flex items-center gap-3">
                <h2 class="text-xl font-semibold text-white">{{ activeSchema.name }}</h2>
                <span v-if="isGlobalSchema" class="badge bg-purple-500/10 text-purple-400 ring-1 ring-inset ring-purple-500/20 text-xs">
                  Global
                </span>
                <span v-else class="badge bg-cyan-500/10 text-cyan-400 ring-1 ring-inset ring-cyan-500/20 text-xs">
                  Workspace
                </span>
              </div>
              <p v-if="activeSchema.description" class="mt-1 text-sm text-gray-400">{{ activeSchema.description }}</p>
              <p class="mt-0.5 text-xs text-gray-500">
                Slug: <code class="rounded bg-gray-800 px-1.5 py-0.5">{{ activeSchema.slug }}</code>
                &middot; Version {{ activeSchema.version }}
                <template v-if="activeSchema.extends_schema_id">
                  &middot; Extends:
                  <button class="text-indigo-400 hover:underline" @click="activeSchemaId = activeSchema.extends_schema_id">
                    {{ schemas.find(s => s.id === activeSchema.extends_schema_id)?.name || 'Parent' }}
                  </button>
                </template>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex rounded-lg border border-gray-800 bg-gray-900 p-0.5">
                <button
                  v-for="v in [{ key: 'tree', label: 'Tree' }, { key: 'json', label: 'JSON' }, { key: 'resolved', label: 'Resolved' }]"
                  :key="v.key"
                  :class="[
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                    view === v.key ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white',
                  ]"
                  @click="view = v.key as any"
                >
                  {{ v.label }}
                </button>
              </div>
              <button v-if="isWorkspaceSchema" class="btn-secondary text-xs" @click="openAddProperty()">
                + Add Property
              </button>
              <button v-if="isWorkspaceSchema" class="btn-ghost text-red-400 text-xs" @click="handleDeleteSchema">
                Delete
              </button>
            </div>
          </div>

          <!-- Tree View -->
          <div v-if="view === 'tree'" class="space-y-4">
            <template v-for="group in getPropertyGroups(resolvedSchema)" :key="group.key">
              <div class="card overflow-hidden">
                <div class="flex items-center justify-between border-b border-gray-800 bg-gray-900/50 px-4 py-3">
                  <div class="flex items-center gap-2">
                    <span :class="[getTypeBadge('object'), 'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset']">
                      object
                    </span>
                    <span class="font-mono text-sm font-semibold text-white">{{ group.key }}</span>
                    <span v-if="group.description" class="text-xs text-gray-500">— {{ group.description }}</span>
                  </div>
                  <button
                    v-if="isWorkspaceSchema"
                    class="text-xs text-indigo-400 hover:text-indigo-300"
                    @click="openAddProperty(group.key)"
                  >
                    + Add
                  </button>
                </div>
                <div class="divide-y divide-gray-800/50">
                  <div
                    v-for="[propKey, propVal] in group.properties"
                    :key="propKey"
                    class="group flex items-center justify-between px-4 py-2.5 hover:bg-gray-800/30"
                  >
                    <div class="flex items-center gap-3 min-w-0">
                      <span :class="[getTypeBadge(propVal.type), 'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset shrink-0']">
                        {{ propVal.type }}
                      </span>
                      <span class="font-mono text-sm text-white">{{ propKey }}</span>
                      <span v-if="propVal.description" class="truncate text-xs text-gray-500">{{ propVal.description }}</span>
                    </div>
                    <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span v-if="propVal.enum" class="text-xs text-gray-500">
                        {{ propVal.enum.join(' | ') }}
                      </span>
                      <span v-if="propVal.default !== undefined" class="text-xs text-gray-500">
                        default: {{ propVal.default }}
                      </span>
                      <span v-if="propVal.format" class="text-xs text-amber-500">
                        {{ propVal.format }}
                      </span>
                      <button
                        v-if="isWorkspaceSchema && activeSchema.schema?.properties?.[group.key]?.properties?.[propKey]"
                        class="text-red-400 hover:text-red-300"
                        @click="removeProperty(group.key, propKey)"
                      >
                        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Top-level non-object properties -->
            <div v-if="getTopLevelProperties(resolvedSchema).length > 0" class="card overflow-hidden">
              <div class="border-b border-gray-800 bg-gray-900/50 px-4 py-3">
                <span class="font-mono text-sm font-semibold text-white">Top-level Properties</span>
              </div>
              <div class="divide-y divide-gray-800/50">
                <div
                  v-for="[propKey, propVal] in getTopLevelProperties(resolvedSchema)"
                  :key="propKey"
                  class="group flex items-center justify-between px-4 py-2.5 hover:bg-gray-800/30"
                >
                  <div class="flex items-center gap-3 min-w-0">
                    <span :class="[getTypeBadge(propVal.type), 'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset shrink-0']">
                      {{ propVal.type }}
                    </span>
                    <span class="font-mono text-sm text-white">{{ propKey }}</span>
                    <span v-if="propVal.description" class="truncate text-xs text-gray-500">{{ propVal.description }}</span>
                  </div>
                  <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      v-if="isWorkspaceSchema && activeSchema.schema?.properties?.[propKey]"
                      class="text-red-400 hover:text-red-300"
                      @click="removeProperty('', propKey)"
                    >
                      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- JSON View (This Schema Only) -->
          <div v-else-if="view === 'json'" class="card overflow-hidden">
            <div class="border-b border-gray-800 bg-gray-900/50 px-4 py-3">
              <span class="text-sm font-medium text-white">Schema Definition (this level only)</span>
            </div>
            <JsonView :data="activeSchema.schema" max-height="600px" />
          </div>

          <!-- Resolved View (Merged with parent) -->
          <div v-else-if="view === 'resolved'" class="card overflow-hidden">
            <div class="border-b border-gray-800 bg-gray-900/50 px-4 py-3">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-white">Resolved Schema (merged with all parents)</span>
                <span class="text-xs text-gray-500">This is what GraphQL and products will use</span>
              </div>
            </div>
            <JsonView :data="resolvedSchema" max-height="600px" />
          </div>
        </template>

        <!-- Empty state -->
        <div v-else class="flex flex-col items-center justify-center py-20">
          <svg class="h-12 w-12 text-gray-700" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
          </svg>
          <h3 class="mt-4 text-base font-medium text-white">Select a schema</h3>
          <p class="mt-1 text-sm text-gray-400">Choose a schema from the left to view and edit its structure.</p>
        </div>
      </div>
    </div>

    <!-- Create Schema Modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div v-if="showCreateModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="showCreateModal = false">
          <div class="card w-full max-w-md p-6">
            <h2 class="mb-1 text-lg font-semibold text-white">New Schema Extension</h2>
            <p class="mb-4 text-sm text-gray-400">
              Create a workspace schema that extends the global base. Add properties specific to your business needs.
            </p>
            <form class="space-y-4" @submit.prevent="handleCreate">
              <div>
                <label class="label-field">Name *</label>
                <input v-model="createForm.name" type="text" required class="input-field" placeholder="e.g. Shopify Export, Legal Compliance" @input="autoSlug" />
              </div>
              <div>
                <label class="label-field">Slug</label>
                <input v-model="createForm.slug" type="text" required class="input-field font-mono text-sm" />
              </div>
              <div>
                <label class="label-field">Description</label>
                <textarea v-model="createForm.description" rows="3" class="input-field" placeholder="What is this schema extension for?" />
              </div>
              <div class="flex justify-end gap-3 pt-2">
                <button type="button" class="btn-secondary" @click="showCreateModal = false">Cancel</button>
                <button type="submit" class="btn-primary" :disabled="saving">
                  {{ saving ? 'Creating...' : 'Create Schema' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Add Property Modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div v-if="showAddPropertyModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="showAddPropertyModal = false">
          <div class="card w-full max-w-lg p-6">
            <h2 class="mb-1 text-lg font-semibold text-white">Add Property</h2>
            <p class="mb-4 text-sm text-gray-400">
              <template v-if="propertyForm.group">
                Adding to group <code class="rounded bg-gray-800 px-1.5 py-0.5 text-cyan-400">{{ propertyForm.group }}</code>
              </template>
              <template v-else>Adding as a top-level property or a new group</template>
            </p>
            <form class="space-y-4" @submit.prevent="handleAddProperty">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="label-field">Property Key *</label>
                  <input v-model="propertyForm.key" type="text" required class="input-field font-mono text-sm" placeholder="e.g. warranty_years" />
                </div>
                <div>
                  <label class="label-field">Type *</label>
                  <select v-model="propertyForm.type" class="input-field">
                    <option v-for="t in JSON_SCHEMA_TYPES" :key="t" :value="t">{{ t }}</option>
                  </select>
                </div>
              </div>
              <div>
                <label class="label-field">Description</label>
                <input v-model="propertyForm.description" type="text" class="input-field" placeholder="Human-readable description" />
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="label-field">Enum Values (comma-separated)</label>
                  <input v-model="propertyForm.enumValues" type="text" class="input-field" placeholder="option1, option2" />
                </div>
                <div>
                  <label class="label-field">Default Value</label>
                  <input v-model="propertyForm.defaultValue" type="text" class="input-field" />
                </div>
              </div>
              <div>
                <label class="label-field">Format (optional)</label>
                <select v-model="propertyForm.format" class="input-field">
                  <option value="">None</option>
                  <option value="uri">URI</option>
                  <option value="email">Email</option>
                  <option value="date">Date</option>
                  <option value="date-time">Date-Time</option>
                  <option value="uuid">UUID</option>
                </select>
              </div>
              <div v-if="!propertyForm.group">
                <label class="label-field">Group (optional)</label>
                <input v-model="propertyForm.group" type="text" class="input-field font-mono text-sm" placeholder="e.g. compliance, logistics" />
                <p class="mt-1 text-xs text-gray-500">Leave empty for a top-level property, or specify a group name to nest it.</p>
              </div>
              <div class="flex justify-end gap-3 pt-2">
                <button type="button" class="btn-secondary" @click="showAddPropertyModal = false">Cancel</button>
                <button type="submit" class="btn-primary" :disabled="saving">
                  {{ saving ? 'Adding...' : 'Add Property' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
