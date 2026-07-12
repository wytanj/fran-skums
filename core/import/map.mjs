/**
 * Deterministic column mapping for dirty supplier files.
 */

/** @typedef {{ key: string, label?: string, group?: string, type?: string, required?: boolean, enumVals?: string[] }} FieldDef */

export const FIXED_IMPORT_FIELDS = [
  { key: 'title', label: 'Title', group: 'Product', type: 'string', required: true },
  { key: 'sku', label: 'SKU', group: 'Product', type: 'string' },
  { key: 'upc', label: 'UPC', group: 'Product', type: 'string' },
  { key: 'ean', label: 'EAN', group: 'Product', type: 'string' },
  { key: 'gtin', label: 'GTIN', group: 'Product', type: 'string' },
  { key: 'status', label: 'Status', group: 'Product', type: 'string', enumVals: ['draft', 'active', 'archived'] },
  { key: 'retail_price', label: 'Retail Price', group: 'Pricing', type: 'number' },
  { key: 'sale_price', label: 'Sale Price', group: 'Pricing', type: 'number' },
  { key: 'cost_price', label: 'Cost Price', group: 'Pricing', type: 'number' },
  { key: 'currency', label: 'Currency', group: 'Pricing', type: 'string' },
  { key: 'stock_quantity', label: 'Stock Quantity', group: 'Inventory', type: 'integer' },
  { key: 'weight', label: 'Weight', group: 'Shipping', type: 'number' },
  { key: 'weight_unit', label: 'Weight Unit', group: 'Shipping', type: 'string' },
  { key: 'pos_enabled', label: 'POS Enabled', group: 'POS', type: 'boolean' },
  { key: 'storage_location_code', label: 'Storage Location Code', group: 'POS', type: 'string' },
  { key: 'supplier_item', label: 'Supplier Item ID', group: 'Supplier', type: 'string' },
  { key: 'supplier_availability', label: 'Supplier Availability', group: 'Supplier', type: 'string' },
  { key: 'option_name', label: 'Option Name', group: 'Supplier', type: 'string' },
  { key: 'tags_csv', label: 'Tags', group: 'Product', type: 'string_array' },
  { key: '_brand', label: 'Brand', group: 'Product', type: 'string' },
  { key: '_category', label: 'Category', group: 'Product', type: 'string' },
]

/**
 * @param {FieldDef[]} [extraFields]
 */
export function buildAliases(extraFields = []) {
  /** @type {Record<string, string[]>} */
  const map = {
    title: ['title', 'name', 'product_name', 'product name', 'product title', 'item name', 'item_name', 'item'],
    sku: ['sku', 'variant_sku', 'variant sku', 'item_sku', 'product_sku', 'stock keeping unit', 'article_number'],
    upc: ['upc', 'barcode', 'bar code'],
    ean: ['ean', 'ean13', 'ean_13', 'ean-13'],
    gtin: ['gtin', 'gtin14', 'global trade item number'],
    status: ['status', 'published', 'active', 'state', 'visibility'],
    // Wholesale sell-in aliases prefer cost_price; retail aliases stay on retail
    retail_price: ['price', 'retail_price', 'retail price', 'unit_price', 'unit price', 'list_price', 'list price', 'msrp'],
    sale_price: ['sale_price', 'sale price', 'discount_price', 'special_price'],
    cost_price: [
      'cost_price',
      'cost price',
      'cost',
      'wholesale_price',
      'wholesale',
      'abw selling price usd',
      'abw selling price',
      'abw selling price (usd)',
      'selling price',
      'selling_price',
    ],
    currency: ['currency', 'currency_code', 'iso_currency'],
    stock_quantity: ['stock_quantity', 'stock quantity', 'quantity', 'qty', 'stock', 'inventory'],
    weight: ['weight', 'wholesale unit weight pc g', 'wholesale unit weight', 'unit weight', 'weight / pc (g)', 'weight pc g'],
    weight_unit: ['weight_unit', 'weight unit'],
    pos_enabled: ['pos_enabled', 'pos enabled', 'sellable_in_pos', 'sellable in pos', 'enabled', 'active for pos'],
    storage_location_code: [
      'storage_location_code',
      'storage location code',
      'store_location_code',
      'store location code',
      'bin_location',
      'location_code',
    ],
    supplier_item: [
      'abw catalog no',
      'abw catalog no.',
      'catalog no',
      'catalog no.',
      'catalog_no',
      'supplier item',
      'supplier_item',
      'supplier sku',
      'supplier_sku',
    ],
    supplier_availability: ['availability', 'supplier availability'],
    option_name: ['option name', 'option_name', 'variant title', 'variant_title', 'size'],
    tags_csv: ['tags', 'tag', 'labels', 'product_tags'],
    _brand: ['brand', 'brand_name', 'brand name', 'vendor', 'vendor_name', 'vendor name', 'maker', 'label'],
    _category: ['category', 'category_name', 'category name', 'product_type', 'product type', 'department', 'collection'],
  }

  for (const field of extraFields) {
    if (map[field.key]) continue
    const key = field.key
    const lastPart = key.split('.').pop() || key
    map[key] = [
      lastPart,
      lastPart.replace(/_/g, ' '),
      key,
      key.replace(/\./g, '_'),
      key.replace(/\./g, ' '),
    ]
  }
  return map
}

/**
 * @param {string} header
 * @param {Record<string, string[]>} aliases
 */
export function autoMapColumn(header, aliases) {
  const normalized = header
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '')

  for (const [field, fieldAliases] of Object.entries(aliases)) {
    for (const alias of fieldAliases) {
      const normalizedAlias = alias.replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '')
      if (normalized === normalizedAlias) return { field, confidence: 'high' }
    }
  }

  for (const [field, fieldAliases] of Object.entries(aliases)) {
    for (const alias of fieldAliases) {
      const normalizedAlias = alias.replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '')
      if (!normalizedAlias || normalizedAlias.length < 3) continue
      if (normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized)) {
        return { field, confidence: 'low' }
      }
    }
  }

  return { field: '', confidence: 'none' }
}

/**
 * @param {string[]} headers
 * @param {{ fields?: FieldDef[], providerHint?: string }} [opts]
 */
export function proposeColumnMapping(headers, opts = {}) {
  const aliases = buildAliases(opts.fields || FIXED_IMPORT_FIELDS)
  /** @type {Record<string, string>} */
  const mapping = {}
  /** @type {Record<string, 'high'|'low'|'none'>} */
  const confidence = {}
  const used = new Set()

  // Prefer supplier wholesale price → cost for ABW
  if (opts.providerHint === 'abw') {
    // ensure cost aliases win before generic "price"
  }

  for (const header of headers) {
    const { field, confidence: conf } = autoMapColumn(header, aliases)
    if (field && !used.has(field)) {
      mapping[header] = field
      confidence[header] = conf
      used.add(field)
    } else {
      mapping[header] = ''
      confidence[header] = 'none'
    }
  }

  const mappedCount = Object.values(mapping).filter(Boolean).length
  const requiredOk = Object.values(mapping).includes('title')
  const score = mappedCount / Math.max(headers.length, 1)

  return {
    mapping,
    confidence,
    mapping_source: 'deterministic',
    mapped_count: mappedCount,
    has_title: requiredOk,
    confidence_score: Number(score.toFixed(3)),
  }
}
