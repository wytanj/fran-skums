<script setup lang="ts">
import type { ProductSchemaDefinition, SchemaProperty } from '~/types'

let Papa: typeof import('papaparse') | null = null
onMounted(async () => {
  Papa = (await import('papaparse')).default as any
})

const client = useSupabaseClient()
const { currentWorkspace } = useWorkspace()
const { schemas, fetchSchemas, resolveSchemaLocally, GLOBAL_BASE_SCHEMA_ID } = useProductSchema()

const activeTab = ref<'import' | 'export'>('import')

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

// Build a generous alias map from the schema field paths
function buildAliases(): Record<string, string[]> {
  const map: Record<string, string[]> = {
    title: ['title', 'name', 'product_name', 'product name', 'product title', 'item name', 'item_name', 'item'],
    sku: ['sku', 'variant_sku', 'variant sku', 'item_sku', 'product_sku', 'stock keeping unit', 'article_number'],
    upc: ['upc', 'barcode', 'bar code'],
    ean: ['ean', 'ean13', 'ean_13', 'ean-13'],
    gtin: ['gtin', 'gtin14', 'global trade item number'],
    status: ['status', 'published', 'active', 'state', 'visibility'],
    retail_price: ['price', 'retail_price', 'retail price', 'unit_price', 'unit price', 'list_price', 'list price', 'abw selling price usd', 'abw selling price'],
    sale_price: ['sale_price', 'sale price', 'discount_price', 'special_price'],
    cost_price: ['cost_price', 'cost price', 'cost', 'wholesale_price', 'wholesale'],
    currency: ['currency', 'currency_code', 'iso_currency'],
    stock_quantity: ['stock_quantity', 'stock quantity', 'quantity', 'qty', 'stock', 'inventory'],
    weight: ['weight', 'wholesale unit weight pc g', 'wholesale unit weight', 'unit weight'],
    weight_unit: ['weight_unit', 'weight unit'],
    pos_enabled: ['pos_enabled', 'pos enabled', 'sellable_in_pos', 'sellable in pos', 'enabled', 'active for pos'],
    storage_location_code: ['storage_location_code', 'storage location code', 'store_location_code', 'store location code', 'bin_location', 'bin location', 'shelf_location', 'shelf location', 'location_code', 'location code'],
    supplier_item: ['abw catalog no', 'abw catalog no.', 'catalog no', 'catalog no.', 'supplier item', 'supplier_item', 'supplier sku', 'supplier_sku'],
    supplier_availability: ['availability', 'supplier availability'],
    option_name: ['option name', 'option_name', 'variant title', 'variant_title', 'size'],
    tags_csv: ['tags', 'tag', 'labels', 'product_tags'],
    _brand: ['brand', 'brand_name', 'brand name', 'vendor', 'vendor_name', 'vendor name', 'maker', 'label'],
    _category: ['category', 'category_name', 'category name', 'product_type', 'product type', 'product_category', 'department', 'collection'],
  }

  for (const field of skumsFields.value) {
    if (map[field.key]) continue
    const key = field.key
    const lastPart = key.split('.').pop() || key
    const aliases = [
      lastPart,
      lastPart.replace(/_/g, ' '),
      key,
      key.replace(/\./g, '_'),
      key.replace(/\./g, ' '),
    ]

    // Extra known aliases for common fields
    const extras: Record<string, string[]> = {
      'identifiers.sku': ['sku', 'variant_sku', 'variant sku', 'item_sku', 'product_sku', 'stock keeping unit', 'article_number'],
      'identifiers.ean': ['ean', 'ean13', 'ean_13', 'ean-13', 'european article number', 'barcode'],
      'identifiers.upc': ['upc', 'upc_a', 'upc-a', 'upc12', 'universal product code'],
      'identifiers.gtin': ['gtin', 'gtin14', 'gtin_14', 'gtin-14', 'global trade item number'],
      'identifiers.isbn': ['isbn', 'isbn13', 'isbn_13'],
      'identifiers.asin': ['asin', 'amazon_id'],
      'identifiers.mpn': ['mpn', 'manufacturer_part_number', 'manufacturer part number', 'part_number', 'part number', 'model_number'],
      'core.name': ['name', 'product_name', 'product name', 'product title', 'item name'],
      'core.slug': ['slug', 'handle', 'url_key', 'url key'],
      'core.description': ['description', 'desc', 'product_description', 'long_description', 'body', 'body_html', 'content'],
      'core.short_description': ['short_description', 'short description', 'summary', 'excerpt', 'brief'],
      'core.type': ['product_type', 'product type', 'type'],
      'core.brand': ['core_brand'],
      'core.manufacturer': ['manufacturer', 'manufacturer_name', 'manufacturer name', 'mfg', 'mfr', 'producer', 'made_by'],
      'core.manufacturer_id': ['manufacturer_id', 'manufacturer_code', 'mfg_id', 'supplier_code'],
      'pricing.price': ['price', 'retail_price', 'retail price', 'unit_price', 'unit price', 'list_price', 'list price', 'msrp', 'variant_price', 'variant price'],
      'pricing.sale_price': ['sale_price', 'sale price', 'compare_at_price', 'compare at price', 'discount_price', 'special_price'],
      'pricing.cost_price': ['cost_price', 'cost price', 'cost', 'cogs', 'unit_cost', 'unit cost', 'wholesale_price', 'wholesale'],
      'pricing.currency': ['currency', 'currency_code', 'iso_currency'],
      'pricing.tax_class': ['tax_class', 'tax class'],
      'pricing.tax_code': ['tax_code', 'tax code'],
      'inventory.stock_quantity': ['stock_quantity', 'stock quantity', 'quantity', 'qty', 'stock', 'inventory', 'inventory_quantity', 'variant_inventory_qty', 'in_stock'],
      'inventory.stock_tracking': ['track_inventory', 'stock_tracking', 'inventory_tracking'],
      'inventory.low_stock_threshold': ['low_stock_threshold', 'low stock threshold', 'reorder_level', 'min_stock'],
      'inventory.stock_status': ['stock_status', 'stock status', 'availability'],
      'shipping.weight': ['weight', 'variant_weight', 'variant weight', 'shipping_weight', 'item_weight'],
      'shipping.weight_unit': ['weight_unit', 'weight unit', 'variant_weight_unit'],
      'shipping.length': ['length', 'product_length', 'package_length'],
      'shipping.width': ['width', 'product_width', 'package_width'],
      'shipping.height': ['height', 'product_height', 'package_height'],
      'shipping.dimension_unit': ['dimension_unit', 'dimension unit', 'size_unit'],
      'seo.meta_title': ['seo_title', 'seo title', 'meta_title', 'meta title', 'page_title'],
      'seo.meta_description': ['seo_description', 'seo description', 'meta_description', 'meta description'],
      'seo.meta_keywords': ['seo_keywords', 'seo keywords', 'meta_keywords', 'meta keywords', 'keywords'],
      'seo.canonical_url': ['canonical_url', 'canonical url', 'url', 'product_url'],
    }

    if (extras[key]) {
      aliases.push(...extras[key])
    }

    map[key] = [...new Set(aliases)]
  }
  return map
}

// ─── Import State ───
type ImportStep = 'upload' | 'map' | 'preview' | 'importing' | 'done'
const step = ref<ImportStep>('upload')
const dragOver = ref(false)
const fileName = ref('')

const csvHeaders = ref<string[]>([])
const csvRows = ref<Record<string, string>[]>([])
const columnMappings = ref<Record<string, string>>({})
const importResult = ref<{ success: number; errors: number; messages: string[] } | null>(null)
const importing = ref(false)
const importProgress = ref({
  phase: 'Waiting',
  detail: '',
  current: 0,
  total: 0,
  success: 0,
  errors: 0,
})

const importProgressPercent = computed(() => {
  if (!importProgress.value.total) return 0
  return Math.min(100, Math.round((importProgress.value.current / importProgress.value.total) * 100))
})

function setImportProgress(update: Partial<typeof importProgress.value>) {
  importProgress.value = { ...importProgress.value, ...update }
}

function autoMapColumn(csvHeader: string, aliases: Record<string, string[]>): string {
  const normalized = csvHeader.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '')

  for (const [field, fieldAliases] of Object.entries(aliases)) {
    for (const alias of fieldAliases) {
      const normalizedAlias = alias.replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '')
      if (normalized === normalizedAlias) return field
    }
  }

  for (const [field, fieldAliases] of Object.entries(aliases)) {
    for (const alias of fieldAliases) {
      const normalizedAlias = alias.replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '')
      if (normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized)) return field
    }
  }

  return ''
}

function handleDrop(e: DragEvent) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) parseImportFile(file)
}

function handleFileSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) parseImportFile(file)
}

function makeUniqueHeaders(headers: string[]) {
  const counts = new Map<string, number>()
  return headers.map((header, index) => {
    const base = String(header || `Column ${index + 1}`).replace(/\s+/g, ' ').trim() || `Column ${index + 1}`
    const count = counts.get(base) || 0
    counts.set(base, count + 1)
    return count === 0 ? base : `${base} ${count + 1}`
  })
}

function applyParsedRows(headers: string[], rows: Record<string, string>[]) {
  csvHeaders.value = headers
  csvRows.value = rows

  const aliases = buildAliases()
  const mappings: Record<string, string> = {}
  const usedFields = new Set<string>()

  for (const header of csvHeaders.value) {
    const match = autoMapColumn(header, aliases)
    if (match && !usedFields.has(match)) {
      mappings[header] = match
      usedFields.add(match)
    } else {
      mappings[header] = ''
    }
  }

  columnMappings.value = mappings
  step.value = 'map'
}

async function parseImportFile(file: File) {
  const lowerName = file.name.toLowerCase()
  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
    await parseXlsx(file)
    return
  }
  parseCSV(file)
}

async function parseXlsx(file: File) {
  fileName.value = file.name
  try {
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' })
      .map((row: string[]) => row.map(cell => String(cell ?? '').trim()))

    const headerIndex = matrix
      .slice(0, 25)
      .reduce((best, row, index) => {
        const filled = row.filter(Boolean).length
        return filled > best.filled ? { index, filled } : best
      }, { index: 0, filled: 0 }).index

    const headers = makeUniqueHeaders(matrix[headerIndex] || [])
    const rows = matrix
      .slice(headerIndex + 1)
      .map((row) => {
        const obj: Record<string, string> = {}
        headers.forEach((header, index) => { obj[header] = row[index] || '' })
        return obj
      })
      .filter(row => Object.values(row).some(Boolean))
      .filter(row => {
        const firstValue = Object.values(row).find(Boolean) || ''
        return !String(firstValue).startsWith('* Information in this catalog')
          && !String(firstValue).startsWith('# Due to packaging')
      })

    applyParsedRows(headers, rows)
  } catch (error: any) {
    importResult.value = { success: 0, errors: 1, messages: [`Failed to parse Excel file: ${error?.message || 'Unknown error'}`] }
  }
}

function parseCSV(file: File) {
  if (!file.name.endsWith('.csv') && !file.name.endsWith('.tsv') && !file.name.endsWith('.txt')) {
    importResult.value = { success: 0, errors: 1, messages: ['Please upload a CSV, TSV, TXT, XLS, or XLSX file'] }
    return
  }

  fileName.value = file.name

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      applyParsedRows(results.meta.fields || [], results.data as Record<string, string>[])
    },
    error: () => {
      importResult.value = { success: 0, errors: 1, messages: ['Failed to parse file'] }
    },
  })
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
  const mapping = columnMappings.value[csvHeader]
  if (!mapping) return 'none'
  const normalized = csvHeader.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_')
  const aliases = buildAliases()[mapping] || []
  for (const alias of aliases) {
    if (normalized === alias.replace(/[^a-z0-9]+/g, '_')) return 'high'
  }
  return 'low'
}

function convertValue(fieldKey: string, raw: string): any {
  const field = skumsFields.value.find(f => f.key === fieldKey)
  if (!field) return raw.trim()

  if (field.type === 'number') return parseFloat(raw) || null
  if (field.type === 'integer') return parseInt(raw) || 0
  if (field.type === 'boolean') return ['true', '1', 'yes', 'y'].includes(raw.toLowerCase().trim())
  if (field.type === 'string_array') return raw.split(',').map(s => s.trim()).filter(Boolean)
  if (field.enumVals?.length) {
    const s = raw.toLowerCase().trim()
    return field.enumVals.includes(s) ? s : raw.trim()
  }
  return raw.trim()
}

function cleanString(value: any) {
  return String(value ?? '').trim()
}

function importSourceType() {
  const lower = fileName.value.toLowerCase()
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx'
  if (lower.endsWith('.tsv')) return 'tsv'
  if (lower.endsWith('.json')) return 'json'
  return 'csv'
}

function normalizeProductFromRow(row: Record<string, string>, rowIndex: number, reverseMap: Record<string, string>) {
  const titleHeader = reverseMap.title
  const titleVal = cleanString(row[titleHeader])
  if (!titleVal) throw new Error(`Row ${rowIndex + 2}: Missing title value`)

  const optionValue = reverseMap.option_name ? cleanString(row[reverseMap.option_name]) : ''
  const product: Record<string, any> = {
    workspace_id: currentWorkspace.value!.id,
    title: optionValue && !titleVal.toLowerCase().includes(optionValue.toLowerCase())
      ? `${titleVal} - ${optionValue}`
      : titleVal,
    status: 'active',
    product_data: {
      pos_enabled: true,
      sellable_in_pos: true,
      import_source: fileName.value,
    },
    schema_id: selectedSchemaId.value || null,
    currency: 'USD',
  }

  for (const [skumsField, csvHeader] of Object.entries(reverseMap)) {
    if (skumsField === 'title') continue
    const val = row[csvHeader]
    if (val === undefined || val === '') continue

    const converted = convertValue(skumsField, val)

    if (skumsField === 'status') {
      product.status = ['active', 'draft', 'archived'].includes(String(converted).toLowerCase())
        ? String(converted).toLowerCase() : 'active'
    } else if (skumsField === 'tags_csv') {
      product.tags = Array.isArray(converted) ? converted : String(converted).split(',').map(s => s.trim()).filter(Boolean)
    } else if (skumsField === '_brand') {
      setNested(product.product_data, 'core.brand', cleanString(val))
    } else if (skumsField === '_category') {
      setNested(product.product_data, 'core.category', cleanString(val))
    } else if (skumsField === 'pos_enabled') {
      product.product_data.pos_enabled = converted
      product.product_data.sellable_in_pos = converted
    } else if (skumsField === 'storage_location_code') {
      const locationCode = cleanString(val).toUpperCase()
      product.product_data.storage_location_code = locationCode
      product.product_data.store_location_code = locationCode
    } else if (skumsField === 'supplier_item') {
      setNested(product.product_data, 'supplier.item_id', cleanString(val))
      setNested(product.product_data, 'supplier.source', 'ABW')
    } else if (skumsField === 'supplier_availability') {
      setNested(product.product_data, 'supplier.availability', cleanString(val))
      product.product_data.availability = cleanString(val)
    } else if (skumsField === 'option_name') {
      setNested(product.product_data, 'supplier.option_name', cleanString(val))
    } else if (skumsField === 'core.manufacturer' || skumsField === 'core.brand') {
      setNested(product.product_data, skumsField, converted)
    } else if (skumsField.includes('.')) {
      setNested(product.product_data, skumsField, converted)
    } else {
      product[skumsField] = converted
    }
  }

  if (product.weight && !product.weight_unit) product.weight_unit = 'g'
  if (product.upc && !/^\d{6,14}$/.test(String(product.upc))) delete product.upc
  if (product.ean && !/^\d{6,14}$/.test(String(product.ean))) delete product.ean
  if (product.gtin && !/^\d{6,14}$/.test(String(product.gtin))) delete product.gtin

  return product
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

// Brand/category resolution caches (populated per import run)
const brandCache = ref<Record<string, string>>({}) // lowercase name → brand uuid
const categoryCache = ref<Record<string, string>>({}) // lowercase name → category uuid

async function resolveBrandId(name: string): Promise<string | null> {
  if (!name.trim() || !currentWorkspace.value) return null
  const key = name.trim().toLowerCase()

  if (brandCache.value[key]) return brandCache.value[key]

  // Try to find existing brand (case-insensitive)
  const { data: existing } = await client
    .from('brands')
    .select('id, name')
    .eq('workspace_id', currentWorkspace.value.id)
    .ilike('name', name.trim())
    .limit(1)

  if (existing && existing.length > 0) {
    brandCache.value[key] = existing[0].id
    return existing[0].id
  }

  // Create new brand
  const { data: created, error } = await client
    .from('brands')
    .insert({ workspace_id: currentWorkspace.value.id, name: name.trim() })
    .select('id')
    .single()

  if (error || !created) return null
  brandCache.value[key] = created.id
  return created.id
}

async function resolveCategoryId(name: string): Promise<string | null> {
  if (!name.trim() || !currentWorkspace.value) return null
  const key = name.trim().toLowerCase()

  if (categoryCache.value[key]) return categoryCache.value[key]

  const { data: existing } = await client
    .from('categories')
    .select('id, name')
    .eq('workspace_id', currentWorkspace.value.id)
    .ilike('name', name.trim())
    .limit(1)

  if (existing && existing.length > 0) {
    categoryCache.value[key] = existing[0].id
    return existing[0].id
  }

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const { data: created, error } = await client
    .from('categories')
    .insert({ workspace_id: currentWorkspace.value.id, name: name.trim(), slug })
    .select('id')
    .single()

  if (error || !created) return null
  categoryCache.value[key] = created.id
  return created.id
}

const IMPORT_BATCH_SIZE = 100

interface PendingProductInsert {
  rowNumber: number
  product: Record<string, any>
}

function buildImportJobRow(importJobId: string, rowNumber: number, row: Record<string, string>, product: Record<string, any>) {
  return {
    workspace_id: currentWorkspace.value!.id,
    import_job_id: importJobId,
    row_number: rowNumber,
    raw_data: row,
    normalized_product: product,
    normalized_identity: { name: product.title, status: product.status },
    normalized_identifiers: [
      product.upc ? { identifier_type: 'upc', identifier_value: product.upc, source: 'supplier_upload' } : null,
      product.ean ? { identifier_type: 'ean', identifier_value: product.ean, source: 'supplier_upload' } : null,
      product.gtin ? { identifier_type: 'gtin', identifier_value: product.gtin, source: 'supplier_upload' } : null,
      product.product_data?.supplier?.item_id ? { identifier_type: 'supplier_item', identifier_value: product.product_data.supplier.item_id, issuer: 'ABW', source: 'supplier_upload' } : null,
    ].filter(Boolean),
    normalized_sku_assignments: product.product_data?.supplier?.item_id
      ? [{ sku: product.product_data.supplier.item_id, scope_type: 'supplier', scope_label: 'ABW', assignment_kind: 'supplier' }]
      : [],
    status: 'valid',
    approval_status: 'approved',
    normalization_confidence: 0.8,
  }
}

async function flushImportBatch(
  importJobId: string | null,
  stagedRows: Record<string, any>[],
  pendingProducts: PendingProductInsert[],
  messages: string[],
) {
  let success = 0
  let errors = 0
  const firstRow = pendingProducts[0]?.rowNumber || stagedRows[0]?.row_number || 0
  const lastRow = pendingProducts[pendingProducts.length - 1]?.rowNumber || stagedRows[stagedRows.length - 1]?.row_number || firstRow

  if (importJobId && stagedRows.length > 0) {
    const { error } = await client.from('import_job_rows').insert(stagedRows as any[])
    if (error) {
      messages.push(`Rows ${firstRow}-${lastRow}: staging failed: ${error.message}`)
    }
  }

  if (pendingProducts.length === 0) {
    return { success, errors }
  }

  const { error } = await client.from('products').insert(pendingProducts.map(item => item.product))
  if (!error) {
    return { success: pendingProducts.length, errors }
  }

  messages.push(`Rows ${firstRow}-${lastRow}: batch product insert failed, retrying rows individually`)
  for (const item of pendingProducts) {
    const { error: rowError } = await client.from('products').insert(item.product)
    if (rowError) {
      errors++
      messages.push(`Row ${item.rowNumber + 1}: ${rowError.message}`)
    } else {
      success++
    }
  }

  return { success, errors }
}

function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

async function runImport() {
  if (!currentWorkspace.value || !hasTitleMapped.value) return

  step.value = 'importing'
  importing.value = true
  setImportProgress({
    phase: 'Preparing import',
    detail: 'Loading workspace brands and categories',
    current: 0,
    total: csvRows.value.length,
    success: 0,
    errors: 0,
  })
  let success = 0
  let errors = 0
  const messages: string[] = []

  // Reset caches for this import run
  brandCache.value = {}
  categoryCache.value = {}

  // Pre-warm caches with existing brands and categories
  const [brandsRes, categoriesRes] = await Promise.all([
    client.from('brands').select('id, name').eq('workspace_id', currentWorkspace.value.id),
    client.from('categories').select('id, name').eq('workspace_id', currentWorkspace.value.id),
  ])
  for (const b of brandsRes.data || []) {
    brandCache.value[b.name.toLowerCase()] = b.id
  }
  for (const c of categoriesRes.data || []) {
    categoryCache.value[c.name.toLowerCase()] = c.id
  }
  setImportProgress({
    phase: 'Creating import job',
    detail: `Preparing staged review records for ${csvRows.value.length} rows`,
  })

  const reverseMap: Record<string, string> = {}
  for (const [csvHeader, skumsField] of Object.entries(columnMappings.value)) {
    if (skumsField) reverseMap[skumsField] = csvHeader
  }

  let importJobId: string | null = null
  const importJobBase = {
    workspace_id: currentWorkspace.value.id,
    source_type: importSourceType(),
    source_name: 'LISE staff upload',
    file_name: fileName.value,
    status: 'validated',
    column_mapping: columnMappings.value,
    import_options: {
      demo_commit: true,
      default_status: 'active',
      default_pos_enabled: true,
    },
    total_rows: csvRows.value.length,
    valid_rows: csvRows.value.length,
  }
  const { data: createdJob, error: createJobError } = await client
    .from('import_jobs')
    .insert({
      ...importJobBase,
      mapping_source: 'deterministic',
      inferred_column_mapping: columnMappings.value,
      review_status: 'approved',
    })
    .select('id')
    .single()

  if (createJobError) {
    const { data: fallbackJob } = await client
      .from('import_jobs')
      .insert(importJobBase)
      .select('id')
      .single()
    importJobId = fallbackJob?.id || null
  } else {
    importJobId = createdJob?.id || null
  }

  const stagedRows: Record<string, any>[] = []
  const pendingProducts: PendingProductInsert[] = []
  const totalBatches = Math.max(1, Math.ceil(csvRows.value.length / IMPORT_BATCH_SIZE))

  for (let i = 0; i < csvRows.value.length; i++) {
    const row = csvRows.value[i]
    let product: Record<string, any>
    setImportProgress({
      phase: importJobId ? 'Staging and committing rows' : 'Committing rows',
      detail: `Row ${i + 1} of ${csvRows.value.length}`,
      current: i,
      success,
      errors,
    })
    try {
      product = normalizeProductFromRow(row, i, reverseMap)
    } catch (error: any) {
      errors++
      messages.push(error.message)
      setImportProgress({
        detail: `Skipped row ${i + 1}: ${error.message}`,
        current: i + 1,
        success,
        errors,
      })
      continue
    }
    setImportProgress({
      detail: `Row ${i + 1} of ${csvRows.value.length}: ${product.title}`,
    })

    if (reverseMap._brand) {
      const val = row[reverseMap._brand]
      if (val) {
        const brandId = await resolveBrandId(String(val))
        if (brandId) product.brand_id = brandId
      }
    }
    if (reverseMap._category) {
      const val = row[reverseMap._category]
      if (val) {
        const categoryId = await resolveCategoryId(String(val))
        if (categoryId) product.category_id = categoryId
      }
    }

    if (importJobId) stagedRows.push(buildImportJobRow(importJobId, i + 1, row, product))
    pendingProducts.push({ rowNumber: i + 1, product })

    if (pendingProducts.length >= IMPORT_BATCH_SIZE || i === csvRows.value.length - 1) {
      const batchNumber = Math.ceil((i + 1) / IMPORT_BATCH_SIZE)
      const firstRow = pendingProducts[0]?.rowNumber || i + 1
      const lastRow = pendingProducts[pendingProducts.length - 1]?.rowNumber || i + 1
      setImportProgress({
        phase: `Writing batch ${batchNumber} of ${totalBatches}`,
        detail: `Rows ${firstRow}-${lastRow}: staging and committing ${pendingProducts.length} products`,
        current: i + 1,
        success,
        errors,
      })

      const result = await flushImportBatch(importJobId, stagedRows, pendingProducts, messages)
      success += result.success
      errors += result.errors
      stagedRows.length = 0
      pendingProducts.length = 0

      setImportProgress({
        current: i + 1,
        success,
        errors,
        detail: `Completed batch ${batchNumber} of ${totalBatches}`,
      })
      await yieldToBrowser()
    }
  }

  setImportProgress({
    phase: 'Finalizing import',
    detail: 'Updating import job totals',
    current: csvRows.value.length,
    success,
    errors,
  })
  importResult.value = { success, errors, messages }
  if (importJobId) {
    await client.from('import_jobs').update({
      status: errors > 0 ? 'completed' : 'completed',
      committed_rows: success,
      error_rows: errors,
      approved_row_count: success,
      rejected_row_count: errors,
      committed_at: new Date().toISOString(),
    } as any).eq('id', importJobId)
  }
  importing.value = false
  step.value = 'done'
}

function resetImport() {
  step.value = 'upload'
  fileName.value = ''
  csvHeaders.value = []
  csvRows.value = []
  columnMappings.value = {}
  importResult.value = null
  importing.value = false
  setImportProgress({
    phase: 'Waiting',
    detail: '',
    current: 0,
    total: 0,
    success: 0,
    errors: 0,
  })
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
          @click="step === 'done' ? null : (step = s.key as ImportStep)"
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
            Drop any CSV, TSV, or Excel file - we'll auto-detect columns and map them to the
            <span class="text-white font-medium">{{ skumsFields.length }}</span> fields from your selected schema.
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
                ({{ csvRows.length }} rows).
                Auto-matched <span class="text-emerald-400 font-medium">{{ mappedCount }}</span> columns
                to <span class="text-indigo-400 font-medium">{{ skumsFields.length }}</span> schema fields.
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
            <p class="text-sm text-gray-400">
              Ready to import <span class="text-white font-medium">{{ csvRows.length }}</span> products with
              <span class="text-white font-medium">{{ mappedCount }}</span> fields each.
            </p>
            <div class="flex gap-3">
              <button class="btn-secondary" @click="step = 'map'">Back</button>
              <button class="btn-primary" @click="runImport">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
                Import {{ csvRows.length }} Products
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- STEP 3.5: Importing progress -->
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
              </div>
              <div class="shrink-0 text-right">
                <p class="text-2xl font-bold text-white">{{ importProgressPercent }}%</p>
                <p class="text-xs text-gray-500">{{ importProgress.current }} / {{ importProgress.total }} rows</p>
              </div>
            </div>

            <div class="mt-5 h-2 overflow-hidden rounded-full bg-gray-800">
              <div
                class="h-full rounded-full bg-indigo-500 transition-all duration-300"
                :style="{ width: `${importProgressPercent}%` }"
              />
            </div>

            <div class="mt-5 grid grid-cols-3 gap-3">
              <div class="rounded-lg bg-gray-900/70 p-3">
                <p class="text-xs text-gray-500">Processed</p>
                <p class="mt-1 text-lg font-semibold text-white">{{ importProgress.current }}</p>
              </div>
              <div class="rounded-lg bg-emerald-500/10 p-3">
                <p class="text-xs text-emerald-400/70">Imported</p>
                <p class="mt-1 text-lg font-semibold text-emerald-400">{{ importProgress.success }}</p>
              </div>
              <div class="rounded-lg bg-red-500/10 p-3">
                <p class="text-xs text-red-400/70">Errors</p>
                <p class="mt-1 text-lg font-semibold text-red-400">{{ importProgress.errors }}</p>
              </div>
            </div>

            <p class="mt-4 text-xs text-gray-500">
              Staging rows for review and committing approved product records. Large files may take a moment.
            </p>
          </div>
        </div>
      </div>

      <!-- STEP 4: Results -->
      <div v-if="step === 'done' && importResult" class="space-y-4">
        <div class="card p-6">
          <h2 class="mb-4 text-lg font-semibold text-white">Import Complete</h2>

          <div class="grid grid-cols-2 gap-4 mb-4">
            <div class="rounded-lg bg-emerald-500/10 p-5 text-center">
              <p class="text-3xl font-bold text-emerald-400">{{ importResult.success }}</p>
              <p class="mt-1 text-sm text-emerald-400/70">Products imported</p>
            </div>
            <div class="rounded-lg bg-red-500/10 p-5 text-center">
              <p class="text-3xl font-bold text-red-400">{{ importResult.errors }}</p>
              <p class="mt-1 text-sm text-red-400/70">Errors</p>
            </div>
          </div>

          <div v-if="importResult.messages.length > 0" class="mb-4">
            <p class="mb-2 text-xs font-medium text-gray-400">Error details:</p>
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
