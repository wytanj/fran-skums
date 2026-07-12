<script setup lang="ts">
import type { ProductSchemaDefinition, SchemaProperty } from '~/types'
import { LARGE_IMPORT_ROW_THRESHOLD } from '../../core/import/index.mjs'

let Papa: typeof import('papaparse') | null = null
onMounted(async () => {
  Papa = (await import('papaparse')).default as any
})

const client = useSupabaseClient()
const { currentWorkspace } = useWorkspace()
const { schemas, fetchSchemas, resolveSchemaLocally, GLOBAL_BASE_SCHEMA_ID } = useProductSchema()

const activeTab = ref<'import' | 'export'>('import')
const dragOver = ref(false)

const {
  step,
  fileName,
  providerHint,
  csvHeaders,
  csvRows,
  columnMappings,
  mappingConfidence,
  importResult,
  importing,
  activeJobId,
  jobSnapshot,
  importProgress,
  importProgressPercent,
  isLargeImport,
  parseImportFile,
  runImport,
  resetImport,
} = useCatalogImport()

// ─── Schema-Driven Fields ───
const selectedSchemaId = ref<string | null>(null)
const resolvedSchema = ref<ProductSchemaDefinition | null>(null)
const schemaReady = ref(false)

interface SkumsField {
  key: string
  label: string
  group: string
  path: string
  type: string
  required?: boolean
  enumVals?: string[]
}

const skumsFields = ref<SkumsField[]>([])
const fieldGroups = computed(() => [...new Set(skumsFields.value.filter(f => f.group).map(f => f.group))])

function flattenSchemaToFields(schema: ProductSchemaDefinition, prefix = '', group = ''): SkumsField[] {
  const result: SkumsField[] = []
  if (!schema.properties) return result

  for (const [key, prop] of Object.entries(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key

    if (prop.type === 'object' && prop.properties) {
      const groupLabel = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      result.push(...flattenSchemaToFields(
        { type: 'object', properties: prop.properties } as ProductSchemaDefinition,
        path,
        groupLabel,
      ))
    } else if (prop.type === 'array' && prop.items?.type === 'string') {
      result.push({
        key: path,
        label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        group: group || 'Other',
        path,
        type: 'string_array',
        enumVals: prop.enum,
      })
    } else if (prop.type !== 'array' && prop.type !== 'object') {
      result.push({
        key: path,
        label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        group: group || 'Other',
        path,
        type: prop.type || 'string',
        required: !!(prop as any).required,
        enumVals: prop.enum,
      })
    }
  }

  return result
}

// Always include "title" as a top-level fixed field (it lives on the products table, not in product_data)
const FIXED_FIELDS: SkumsField[] = [
  { key: 'title', label: 'Title', group: 'Product', path: 'title', type: 'string', required: true },
  { key: 'sku', label: 'SKU', group: 'Product', path: 'sku', type: 'string' },
  { key: 'upc', label: 'UPC', group: 'Product', path: 'upc', type: 'string' },
  { key: 'ean', label: 'EAN', group: 'Product', path: 'ean', type: 'string' },
  { key: 'gtin', label: 'GTIN', group: 'Product', path: 'gtin', type: 'string' },
  { key: 'status', label: 'Status', group: 'Product', path: 'status', type: 'string', enumVals: ['draft', 'active', 'archived'] },
  { key: 'retail_price', label: 'Retail Price', group: 'Pricing', path: 'retail_price', type: 'number' },
  { key: 'sale_price', label: 'Sale Price', group: 'Pricing', path: 'sale_price', type: 'number' },
  { key: 'cost_price', label: 'Cost Price', group: 'Pricing', path: 'cost_price', type: 'number' },
  { key: 'currency', label: 'Currency', group: 'Pricing', path: 'currency', type: 'string' },
  { key: 'stock_quantity', label: 'Stock Quantity', group: 'Inventory', path: 'stock_quantity', type: 'integer' },
  { key: 'weight', label: 'Weight', group: 'Shipping', path: 'weight', type: 'number' },
  { key: 'weight_unit', label: 'Weight Unit', group: 'Shipping', path: 'weight_unit', type: 'string' },
  { key: 'pos_enabled', label: 'POS Enabled', group: 'POS', path: 'pos_enabled', type: 'boolean' },
  { key: 'storage_location_code', label: 'Storage Location Code', group: 'POS', path: 'storage_location_code', type: 'string' },
  { key: 'supplier_item', label: 'Supplier Item ID', group: 'Supplier', path: 'supplier_item', type: 'string' },
  { key: 'supplier_availability', label: 'Supplier Availability', group: 'Supplier', path: 'supplier_availability', type: 'string' },
  { key: 'option_name', label: 'Option Name', group: 'Supplier', path: 'option_name', type: 'string' },
  { key: 'tags_csv', label: 'Tags', group: 'Product', path: 'tags_csv', type: 'string_array' },
  { key: '_brand', label: 'Brand', group: 'Product', path: '_brand', type: 'string' },
  { key: '_category', label: 'Category', group: 'Product', path: '_category', type: 'string' },
]

async function resolveSelectedSchema() {
  if (!selectedSchemaId.value) {
    resolvedSchema.value = null
    skumsFields.value = [...FIXED_FIELDS]
    schemaReady.value = true
    return
  }

  const schema = schemas.value.find(s => s.id === selectedSchemaId.value)
  if (schema) {
    resolvedSchema.value = resolveSchemaLocally(schema, schemas.value)
    const dynamic = flattenSchemaToFields(resolvedSchema.value)
    skumsFields.value = [...FIXED_FIELDS, ...dynamic]
  } else {
    skumsFields.value = [...FIXED_FIELDS]
  }
  schemaReady.value = true
}

// ─── Import helpers (state lives in useCatalogImport) ───
function handleDrop(e: DragEvent) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) parseImportFile(file)
}

function handleFileSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) parseImportFile(file)
}

const mappedCount = computed(() =>
  Object.values(columnMappings.value).filter(v => v).length,
)

const hasTitleMapped = computed(() =>
  Object.values(columnMappings.value).includes('title'),
)

const previewRows = computed(() => csvRows.value.slice(0, 5))

function getFieldLabel(key: string) {
  const field = skumsFields.value.find(f => f.key === key)
  return field?.label || key
}

function getMatchConfidence(csvHeader: string): 'high' | 'low' | 'none' {
  const conf = mappingConfidence.value[csvHeader]
  if (conf === 'high' || conf === 'low' || conf === 'none') return conf
  return columnMappings.value[csvHeader] ? 'low' : 'none'
}

async function startImport() {
  await runImport({ demoCommit: true })
}

// ─── Export State ───
const exporting = ref(false)

const exportFieldSelections = computed(() => {
  return skumsFields.value.map(f => ({
    ...f,
    selected: ref(['title', 'status', 'tags_csv', 'identifiers.sku', 'identifiers.ean', 'identifiers.upc', 'pricing.price', 'pricing.cost_price', 'pricing.currency', 'inventory.stock_quantity', 'core.description'].includes(f.key)),
  }))
})

const exportFields = ref<Array<SkumsField & { selected: boolean }>>([])

function initExportFields() {
  const defaultSelected = new Set([
    'title', 'status', 'tags_csv',
    'identifiers.sku', 'identifiers.ean', 'identifiers.upc',
    'pricing.price', 'pricing.cost_price', 'pricing.currency',
    'inventory.stock_quantity',
    'core.description',
  ])
  exportFields.value = skumsFields.value.map(f => ({
    ...f,
    selected: defaultSelected.has(f.key),
  }))
}

function getNested(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((c, k) => c?.[k], obj)
}

async function handleExport() {
  if (!currentWorkspace.value) return
  exporting.value = true

  const { data } = await client
    .from('products')
    .select('*')
    .eq('workspace_id', currentWorkspace.value.id)

  if (data) {
    const selected = exportFields.value.filter(f => f.selected)
    const exportData = data.map((row: any) => {
      const obj: Record<string, any> = {}
      for (const field of selected) {
        let val: any
        if (field.key === 'title') {
          val = row.title
        } else if (field.key === 'status') {
          val = row.status
        } else if (field.key === 'tags_csv') {
          val = Array.isArray(row.tags) ? row.tags.join(', ') : row.tags
        } else if (field.key.includes('.')) {
          val = getNested(row.product_data || {}, field.key)
        } else {
          val = row[field.key]
        }
        obj[field.label] = Array.isArray(val) ? val.join(', ') : (val ?? '')
      }
      return obj
    })

    const csv = Papa.unparse(exportData)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `skums-products-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  exporting.value = false
}

function downloadTemplate() {
  const fields = skumsFields.value
  const headers = fields.map(f => f.label)
  const example = fields.map(f => {
    if (f.key === 'title') return 'Example Product'
    if (f.key === 'status') return 'draft'
    if (f.key === 'tags_csv') return 'tag1, tag2'
    if (f.type === 'number') return '0.00'
    if (f.type === 'integer') return '0'
    if (f.type === 'boolean') return 'false'
    if (f.enumVals?.length) return f.enumVals[0]
    return ''
  })

  const csv = Papa.unparse([headers, example])
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'skums-import-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Init ───
onMounted(async () => {
  await fetchSchemas()
  const globalBase = schemas.value.find(s => s.id === GLOBAL_BASE_SCHEMA_ID)
  if (globalBase) {
    selectedSchemaId.value = globalBase.id
  }
  await resolveSelectedSchema()
  initExportFields()
})
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-white">Import / Export</h1>
      <p class="mt-1 text-sm text-gray-400">Bulk manage your product data</p>
    </div>

    <!-- Schema Selector (shared by import & export) -->
    <div class="mb-6 card p-4">
      <div class="flex items-center gap-4">
        <div class="flex-1">
          <label class="text-xs font-medium text-gray-400">Target Schema</label>
          <select
            v-model="selectedSchemaId"
            class="input-field mt-1"
            @change="resolveSelectedSchema(); initExportFields()"
          >
            <option :value="null">No schema (fixed fields only)</option>
            <option v-for="s in schemas" :key="s.id" :value="s.id">
              {{ s.name }} ({{ s.workspace_id ? 'Workspace' : 'Global' }})
            </option>
          </select>
        </div>
        <div class="pt-5">
          <span class="inline-flex items-center rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-xs font-medium text-indigo-400">
            {{ skumsFields.length }} fields available
          </span>
        </div>
      </div>
      <p class="mt-1.5 text-xs text-gray-600">
        The selected schema determines which fields are available for mapping during import and export.
      </p>
    </div>

    <!-- Tabs -->
    <div class="mb-6 flex gap-1 rounded-lg border border-gray-800 bg-gray-900 p-1">
      <button
        v-for="tab in [{ key: 'import', label: 'Import' }, { key: 'export', label: 'Export' }]"
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

    <!-- ═══════ IMPORT ═══════ -->
    <div v-if="activeTab === 'import'">

      <!-- Step indicator -->
      <div v-if="step !== 'upload'" class="mb-6 flex items-center gap-2">
        <button
          v-for="(s, idx) in [
            { key: 'upload', label: '1. Upload' },
            { key: 'map', label: '2. Map Columns' },
            { key: 'preview', label: '3. Preview' },
            { key: 'done', label: '4. Import' },
          ]"
          :key="s.key"
          :class="[
            'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all',
            step === s.key || (step === 'importing' && s.key === 'done')
              ? 'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/30'
              : idx < ['upload', 'map', 'preview', 'done'].indexOf(step)
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-gray-800 text-gray-500',
          ]"
          :disabled="idx > ['upload', 'map', 'preview', 'done'].indexOf(step)"
          @click="step === 'done' ? null : (step = s.key as any)"
        >
          {{ s.label }}
        </button>
        <div class="flex-1" />
        <button class="btn-ghost text-xs text-gray-400" @click="resetImport">
          Start over
        </button>
      </div>

      <!-- STEP 1: Upload -->
      <div v-if="step === 'upload'" class="space-y-6">
        <div class="card p-6">
          <h2 class="mb-2 text-lg font-semibold text-white">Upload product sheet</h2>
          <p class="mb-4 text-sm text-gray-400">
            Drop a dirty supplier catalog (CSV / TSV / Excel). We detect headers (including ABW-style multi-line
            preambles), auto-map columns, and for large files ({{ LARGE_IMPORT_ROW_THRESHOLD.toLocaleString() }}+)
            persist job progress until completion.
          </p>

          <button class="btn-ghost mb-4 text-indigo-400 text-xs" @click="downloadTemplate">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download template for current schema
          </button>

          <!-- Drop zone -->
          <div
            :class="[
              'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-16 text-center transition-all cursor-pointer',
              dragOver ? 'border-indigo-500 bg-indigo-600/5' : 'border-gray-700 hover:border-gray-600',
            ]"
            @dragover.prevent="dragOver = true"
            @dragleave="dragOver = false"
            @drop.prevent="handleDrop"
            @click="($refs.fileInput as HTMLInputElement)?.click()"
          >
            <input ref="fileInput" type="file" accept=".csv,.tsv,.txt,.xls,.xlsx" class="hidden" @change="handleFileSelect" />

            <svg class="mb-4 h-12 w-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>

            <p class="text-sm font-medium text-white">Drop your product file here, or click to browse</p>
            <p class="mt-1 text-xs text-gray-500">CSV, TSV, XLS, and XLSX files are supported.</p>
          </div>
        </div>
      </div>

      <!-- STEP 2: Column Mapping -->
      <div v-if="step === 'map'" class="space-y-4">
        <div class="card p-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-lg font-semibold text-white">Map Your Columns</h2>
              <p class="mt-0.5 text-sm text-gray-400">
                We found <span class="text-white font-medium">{{ csvHeaders.length }}</span> columns
                in <span class="text-white font-medium">{{ fileName }}</span>
                ({{ csvRows.length.toLocaleString() }} rows
                <span v-if="providerHint === 'abw'" class="text-amber-400">· ABW catalog detected</span>).
                Auto-matched <span class="text-emerald-400 font-medium">{{ mappedCount }}</span> columns.
                <span v-if="isLargeImport" class="block mt-1 text-indigo-300">
                  Large file ({{ LARGE_IMPORT_ROW_THRESHOLD.toLocaleString() }}+ rows): progress is saved on an import job you can track to completion.
                </span>
              </p>
            </div>
          </div>

          <div v-if="!hasTitleMapped" class="mb-4 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-400">
            You must map at least one column to <strong>Title</strong> to import products.
          </div>

          <!-- Column mapping table -->
          <div class="overflow-hidden rounded-lg border border-gray-800">
            <table class="w-full">
              <thead>
                <tr class="border-b border-gray-800 bg-gray-900/50">
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-400">Your CSV Column</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-400">Sample Data</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-400">Maps To</th>
                  <th class="px-2 py-3 text-center text-xs font-medium text-gray-400 w-16">Match</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-800/50">
                <tr
                  v-for="header in csvHeaders"
                  :key="header"
                  class="hover:bg-gray-800/30 transition-colors"
                >
                  <td class="px-4 py-3">
                    <code class="rounded bg-gray-800 px-2 py-0.5 text-sm text-white">{{ header }}</code>
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-400 max-w-[200px] truncate">
                    {{ csvRows[0]?.[header] || '—' }}
                  </td>
                  <td class="px-4 py-3">
                    <select
                      v-model="columnMappings[header]"
                      :class="[
                        'input-field !py-1.5 text-sm',
                        columnMappings[header] ? 'ring-1 ring-emerald-500/30' : '',
                      ]"
                    >
                      <option value="">— Skip —</option>
                      <optgroup v-for="group in fieldGroups" :key="group" :label="group">
                        <option
                          v-for="f in skumsFields.filter(f => f.group === group)"
                          :key="f.key"
                          :value="f.key"
                          :disabled="Object.values(columnMappings).includes(f.key) && columnMappings[header] !== f.key"
                        >
                          {{ f.label }}{{ f.required ? ' *' : '' }}
                        </option>
                      </optgroup>
                    </select>
                  </td>
                  <td class="px-2 py-3 text-center">
                    <span v-if="getMatchConfidence(header) === 'high'" class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400" title="High confidence match">
                      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    </span>
                    <span v-else-if="getMatchConfidence(header) === 'low'" class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/10 text-amber-400" title="Partial match — verify">
                      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                      </svg>
                    </span>
                    <span v-else class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-gray-600">
                      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" />
                      </svg>
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mt-4 flex items-center justify-between">
            <p class="text-xs text-gray-500">
              {{ mappedCount }} of {{ csvHeaders.length }} columns mapped
            </p>
            <div class="flex gap-3">
              <button class="btn-secondary" @click="step = 'upload'">Back</button>
              <button class="btn-primary" :disabled="!hasTitleMapped" @click="step = 'preview'">
                Preview Import
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- STEP 3: Preview -->
      <div v-if="step === 'preview'" class="space-y-4">
        <div class="card p-6">
          <div class="mb-4">
            <h2 class="text-lg font-semibold text-white">Preview</h2>
            <p class="mt-0.5 text-sm text-gray-400">
              Here's how the first {{ Math.min(5, csvRows.length) }} rows will be imported. Unmapped columns are skipped.
            </p>
          </div>

          <div class="overflow-x-auto rounded-lg border border-gray-800">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-800 bg-gray-900/50">
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500">#</th>
                  <th
                    v-for="[csvH, skumsF] in Object.entries(columnMappings).filter(([, v]) => v)"
                    :key="csvH"
                    class="px-3 py-2 text-left text-xs font-medium text-gray-400"
                  >
                    {{ getFieldLabel(skumsF) }}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-800/50">
                <tr v-for="(row, idx) in previewRows" :key="idx" class="hover:bg-gray-800/20">
                  <td class="px-3 py-2 text-xs text-gray-600">{{ idx + 1 }}</td>
                  <td
                    v-for="[csvH] in Object.entries(columnMappings).filter(([, v]) => v)"
                    :key="csvH"
                    class="px-3 py-2 text-gray-300 max-w-[180px] truncate"
                  >
                    {{ row[csvH] || '' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mt-4 flex items-center justify-between">
            <div class="text-sm text-gray-400 space-y-1">
              <p>
                Ready to import <span class="text-white font-medium">{{ csvRows.length.toLocaleString() }}</span> products with
                <span class="text-white font-medium">{{ mappedCount }}</span> fields each.
              </p>
              <p v-if="providerHint === 'abw'" class="text-xs text-amber-400/90">
                ABW wholesale prices map to <strong>cost</strong>; POS is off by default for full catalogs. Re-import upserts by catalog no / SKU.
              </p>
            </div>
            <div class="flex gap-3">
              <button class="btn-secondary" @click="step = 'map'">Back</button>
              <button class="btn-primary" :disabled="importing" @click="startImport">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
                Import {{ csvRows.length.toLocaleString() }} Products
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- STEP 3.5: Importing progress + job status -->
      <div v-if="step === 'importing'" class="card p-6">
        <div class="flex items-start gap-4">
          <svg class="mt-1 h-8 w-8 shrink-0 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <h3 class="text-lg font-semibold text-white">{{ importProgress.phase }}</h3>
                <p class="mt-1 truncate text-sm text-gray-400">{{ importProgress.detail || 'Starting import' }}</p>
                <p v-if="activeJobId" class="mt-2 text-xs font-mono text-gray-500">
                  Job {{ activeJobId }}
                  <span v-if="jobSnapshot?.status" class="ml-2 rounded bg-gray-800 px-1.5 py-0.5 text-indigo-300">
                    {{ jobSnapshot.status }}
                  </span>
                </p>
              </div>
              <div class="shrink-0 text-right">
                <p class="text-2xl font-bold text-white">{{ importProgressPercent }}%</p>
                <p class="text-xs text-gray-500">
                  {{ importProgress.current.toLocaleString() }} / {{ importProgress.total.toLocaleString() }} rows
                </p>
              </div>
            </div>

            <div class="mt-5 h-2 overflow-hidden rounded-full bg-gray-800">
              <div
                class="h-full rounded-full bg-indigo-500 transition-all duration-300"
                :style="{ width: `${importProgressPercent}%` }"
              />
            </div>

            <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div class="rounded-lg bg-gray-900/70 p-3">
                <p class="text-xs text-gray-500">Processed</p>
                <p class="mt-1 text-lg font-semibold text-white">{{ importProgress.current.toLocaleString() }}</p>
              </div>
              <div class="rounded-lg bg-emerald-500/10 p-3">
                <p class="text-xs text-emerald-400/70">Committed</p>
                <p class="mt-1 text-lg font-semibold text-emerald-400">{{ importProgress.success.toLocaleString() }}</p>
              </div>
              <div class="rounded-lg bg-sky-500/10 p-3">
                <p class="text-xs text-sky-400/70">Created / Updated</p>
                <p class="mt-1 text-lg font-semibold text-sky-300">
                  {{ importProgress.created.toLocaleString() }} / {{ importProgress.updated.toLocaleString() }}
                </p>
              </div>
              <div class="rounded-lg bg-red-500/10 p-3">
                <p class="text-xs text-red-400/70">Errors</p>
                <p class="mt-1 text-lg font-semibold text-red-400">{{ importProgress.errors.toLocaleString() }}</p>
              </div>
            </div>

            <p class="mt-4 text-xs text-gray-500">
              Progress is written to the import job every batch
              <span v-if="isLargeImport"> (large catalog mode — keep this tab open until complete)</span>.
              Status updates every few seconds from the job record.
            </p>
          </div>
        </div>
      </div>

      <!-- STEP 4: Results / job completion -->
      <div v-if="step === 'done' && importResult" class="space-y-4">
        <div class="card p-6">
          <div class="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 class="text-lg font-semibold text-white">
                {{ importResult.errors && !importResult.success ? 'Import Finished with Errors' : 'Import Complete' }}
              </h2>
              <p v-if="importResult.jobId" class="mt-1 text-xs font-mono text-gray-500">
                Job {{ importResult.jobId }}
                <span v-if="jobSnapshot?.status" class="ml-2 text-emerald-400">· {{ jobSnapshot.status }}</span>
              </p>
            </div>
            <span
              v-if="jobSnapshot?.status === 'completed' || importResult.success"
              class="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-400"
            >
              Completed
            </span>
          </div>

          <div class="grid grid-cols-2 gap-4 mb-4 sm:grid-cols-4">
            <div class="rounded-lg bg-emerald-500/10 p-5 text-center">
              <p class="text-3xl font-bold text-emerald-400">{{ importResult.success.toLocaleString() }}</p>
              <p class="mt-1 text-sm text-emerald-400/70">Committed</p>
            </div>
            <div class="rounded-lg bg-sky-500/10 p-5 text-center">
              <p class="text-3xl font-bold text-sky-300">{{ (importResult.created || 0).toLocaleString() }}</p>
              <p class="mt-1 text-sm text-sky-400/70">Created</p>
            </div>
            <div class="rounded-lg bg-indigo-500/10 p-5 text-center">
              <p class="text-3xl font-bold text-indigo-300">{{ (importResult.updated || 0).toLocaleString() }}</p>
              <p class="mt-1 text-sm text-indigo-400/70">Updated</p>
            </div>
            <div class="rounded-lg bg-red-500/10 p-5 text-center">
              <p class="text-3xl font-bold text-red-400">{{ importResult.errors.toLocaleString() }}</p>
              <p class="mt-1 text-sm text-red-400/70">Errors</p>
            </div>
          </div>

          <div v-if="importResult.messages.length > 0" class="mb-4">
            <p class="mb-2 text-xs font-medium text-gray-400">Error details (first {{ importResult.messages.length }}):</p>
            <div class="max-h-48 overflow-y-auto rounded-lg bg-gray-800 p-3 space-y-1">
              <p v-for="(msg, i) in importResult.messages" :key="i" class="text-xs text-gray-400 font-mono">
                {{ msg }}
              </p>
            </div>
          </div>

          <div class="flex gap-3">
            <button class="btn-secondary" @click="resetImport">Import More</button>
            <NuxtLink to="/products" class="btn-primary">
              View Products
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════ EXPORT ═══════ -->
    <div v-if="activeTab === 'export'" class="card p-6">
      <h2 class="mb-2 text-lg font-semibold text-white">Export Products</h2>
      <p class="mb-4 text-sm text-gray-400">
        Select the fields you want to include in the export. Fields come from your selected schema.
      </p>

      <div class="mb-6 space-y-4">
        <template v-for="group in fieldGroups" :key="group">
          <div>
            <p class="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wider">{{ group }}</p>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <label
                v-for="field in exportFields.filter(f => f.group === group)"
                :key="field.key"
                :class="[
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all cursor-pointer',
                  field.selected ? 'bg-indigo-600/10 text-indigo-400 ring-1 ring-indigo-500/20' : 'bg-gray-800 text-gray-400 hover:bg-gray-700',
                ]"
              >
                <input
                  v-model="field.selected"
                  type="checkbox"
                  class="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
                />
                {{ field.label }}
              </label>
            </div>
          </div>
        </template>
      </div>

      <div class="flex items-center gap-3">
        <button
          class="btn-primary"
          :disabled="exporting || exportFields.filter(f => f.selected).length === 0"
          @click="handleExport"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {{ exporting ? 'Exporting...' : 'Export CSV' }}
        </button>
        <span class="text-xs text-gray-500">
          {{ exportFields.filter(f => f.selected).length }} fields selected
        </span>
      </div>
    </div>
  </div>
</template>
