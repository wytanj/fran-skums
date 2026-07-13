/**
 * Normalize a dirty supplier row into a product write plan + identity plan.
 */

/**
 * @param {Record<string, any>} obj
 * @param {string} path
 * @param {any} value
 */
export function setNested(obj, path, value) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}
    cur = cur[parts[i]]
  }
  cur[parts[parts.length - 1]] = value
}

function cleanString(value) {
  return String(value ?? '').trim()
}

/**
 * @param {string} fieldKey
 * @param {string} raw
 * @param {{ type?: string, enumVals?: string[] } | null} field
 */
export function convertValue(fieldKey, raw, field = null) {
  if (!field) return raw.trim()
  if (field.type === 'number') {
    const n = parseFloat(String(raw).replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  if (field.type === 'integer') return parseInt(String(raw).replace(/[^0-9\-]/g, ''), 10) || 0
  if (field.type === 'boolean') return ['true', '1', 'yes', 'y'].includes(raw.toLowerCase().trim())
  if (field.type === 'string_array') return raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (field.enumVals?.length) {
    const s = raw.toLowerCase().trim()
    return field.enumVals.includes(s) ? s : raw.trim()
  }
  return raw.trim()
}

/**
 * @param {string} code
 */
export function classifyBarcode(code) {
  const v = cleanString(code)
  if (!v || /^tbc$/i.test(v) || !/^\d{6,14}$/.test(v)) return null
  if (v.length === 13 || v.length === 8) return { type: 'ean', value: v }
  if (v.length === 12) return { type: 'upc', value: v }
  if (v.length === 14) return { type: 'gtin', value: v }
  return { type: v.length >= 13 ? 'ean' : 'upc', value: v }
}

/**
 * @param {Record<string, string>} row
 * @param {number} rowIndex 0-based
 * @param {Record<string, string>} reverseMap skumsField → csvHeader
 * @param {{
 *   workspace_id: string,
 *   schema_id?: string | null,
 *   file_name?: string,
 *   provider_hint?: string,
 *   default_pos_enabled?: boolean,
 *   default_status?: string,
 *   default_currency?: string,
 *   supplier_source?: string,
 *   field_types?: Record<string, { type?: string, enumVals?: string[] }>,
 * }} opts
 */
export function normalizeProductFromRow(row, rowIndex, reverseMap, opts) {
  const titleHeader = reverseMap.title
  const titleVal = titleHeader ? cleanString(row[titleHeader]) : ''
  if (!titleVal) throw new Error(`Row ${rowIndex + 2}: Missing title value`)

  const optionValue = reverseMap.option_name ? cleanString(row[reverseMap.option_name]) : ''
  const provider = opts.provider_hint || opts.supplier_source || 'supplier'
  // M5: imports default to draft + POS-off; promote via product UI "Activate for POS"
  const posDefault = opts.default_pos_enabled === true
  const statusDefault = opts.default_status || 'draft'
  const currencyDefault = opts.default_currency || (provider === 'abw' ? 'USD' : 'USD')

  /** @type {Record<string, any>} */
  const product = {
    workspace_id: opts.workspace_id,
    title:
      optionValue && !titleVal.toLowerCase().includes(optionValue.toLowerCase())
        ? `${titleVal} - ${optionValue}`
        : titleVal,
    status: statusDefault,
    product_data: {
      pos_enabled: posDefault,
      sellable_in_pos: posDefault,
      import_source: opts.file_name || 'import',
      supplier: {
        source: opts.supplier_source || (provider === 'abw' ? 'ABW' : provider),
      },
    },
    schema_id: opts.schema_id || null,
    currency: currencyDefault,
  }

  const defaultTypes = {
    retail_price: { type: 'number' },
    sale_price: { type: 'number' },
    cost_price: { type: 'number' },
    stock_quantity: { type: 'integer' },
    weight: { type: 'number' },
    pos_enabled: { type: 'boolean' },
    tags_csv: { type: 'string_array' },
    status: { type: 'string', enumVals: ['draft', 'active', 'archived'] },
  }
  const fieldTypes = { ...defaultTypes, ...(opts.field_types || {}) }

  for (const [skumsField, csvHeader] of Object.entries(reverseMap)) {
    if (skumsField === 'title') continue
    const val = row[csvHeader]
    if (val === undefined || val === '') continue
    const converted = convertValue(skumsField, val, fieldTypes[skumsField] || null)

    if (skumsField === 'status') {
      product.status = ['active', 'draft', 'archived'].includes(String(converted).toLowerCase())
        ? String(converted).toLowerCase()
        : statusDefault
    } else if (skumsField === 'tags_csv') {
      product.tags = Array.isArray(converted)
        ? converted
        : String(converted)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
    } else if (skumsField === '_brand') {
      setNested(product.product_data, 'core.brand', cleanString(val))
      product._brand_name = cleanString(val)
    } else if (skumsField === '_category') {
      setNested(product.product_data, 'core.category', cleanString(val))
      product._category_name = cleanString(val)
    } else if (skumsField === 'pos_enabled') {
      product.product_data.pos_enabled = converted
      product.product_data.sellable_in_pos = converted
    } else if (skumsField === 'storage_location_code') {
      const locationCode = cleanString(val).toUpperCase()
      product.product_data.storage_location_code = locationCode
      product.product_data.store_location_code = locationCode
    } else if (skumsField === 'supplier_item') {
      setNested(product.product_data, 'supplier.item_id', cleanString(val))
      if (!product.sku) product.sku = cleanString(val)
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

  // Wholesale box tiers (ABW positional extras)
  const tierKeys = [
    ['Box Qty 1', 'Box Selling Price 1 (USD)', 'Price / piece 1 (USD)', 'Availability 1'],
    ['Box Qty 2', 'Box Selling Price 2 (USD)', 'Price / piece 2 (USD)', 'Availability 2'],
    ['Box Qty 3', 'Box Selling Price 3 (USD)', 'Price / piece 3 (USD)', 'Availability 3'],
  ]
  const tiers = []
  for (const [q, sell, piece, av] of tierKeys) {
    if (row[q]) {
      tiers.push({
        qty: Number(row[q]) || row[q],
        box_price: row[sell] ? Number(row[sell]) : null,
        unit_price: row[piece] ? Number(row[piece]) : null,
        availability: row[av] || null,
      })
    }
  }
  if (tiers.length) setNested(product.product_data, 'wholesale.tiers', tiers)

  if (product.weight && !product.weight_unit) product.weight_unit = 'g'

  // Normalize barcodes
  for (const key of ['upc', 'ean', 'gtin']) {
    if (!product[key]) continue
    const classified = classifyBarcode(String(product[key]))
    if (!classified) {
      delete product[key]
      continue
    }
    // Re-home to correct field
    delete product.upc
    delete product.ean
    delete product.gtin
    product[classified.type] = classified.value
    break
  }

  // Build identity plan
  const supplierItem = product.product_data?.supplier?.item_id || product.sku || null
  const supplierSource = product.product_data?.supplier?.source || 'supplier'

  const identifiers = [
    product.upc ? { identifier_type: 'upc', identifier_value: product.upc, source: 'supplier_upload' } : null,
    product.ean ? { identifier_type: 'ean', identifier_value: product.ean, source: 'supplier_upload' } : null,
    product.gtin ? { identifier_type: 'gtin', identifier_value: product.gtin, source: 'supplier_upload' } : null,
    supplierItem
      ? {
          identifier_type: 'supplier_item',
          identifier_value: supplierItem,
          issuer: supplierSource,
          source: 'supplier_upload',
        }
      : null,
  ].filter(Boolean)

  const sku_assignments = supplierItem
    ? [
        {
          sku: supplierItem,
          scope_type: 'supplier',
          scope_label: supplierSource,
          assignment_kind: 'supplier',
        },
      ]
    : []

  // Strip internal helper fields before insert
  const brandName = product._brand_name || null
  const categoryName = product._category_name || null
  delete product._brand_name
  delete product._category_name

  return {
    product,
    brand_name: brandName,
    category_name: categoryName,
    identity: { name: product.title, status: product.status },
    identifiers,
    sku_assignments,
    match_key: supplierItem ? `supplier:${supplierSource}:${supplierItem}` : null,
  }
}

/**
 * @param {string} importJobId
 * @param {string} workspaceId
 * @param {number} rowNumber 1-based
 * @param {Record<string, string>} rawRow
 * @param {ReturnType<typeof normalizeProductFromRow>} normalized
 */
export function buildImportJobRow(importJobId, workspaceId, rowNumber, rawRow, normalized) {
  return {
    workspace_id: workspaceId,
    import_job_id: importJobId,
    row_number: rowNumber,
    raw_data: rawRow,
    normalized_product: normalized.product,
    normalized_identity: normalized.identity,
    normalized_identifiers: normalized.identifiers,
    normalized_sku_assignments: normalized.sku_assignments,
    status: 'valid',
    approval_status: 'approved',
    normalization_confidence: 0.85,
  }
}

/**
 * Build reverse map: skums field → csv header
 * @param {Record<string, string>} columnMappings csvHeader → skumsField
 */
export function reverseColumnMap(columnMappings) {
  /** @type {Record<string, string>} */
  const reverse = {}
  for (const [csvHeader, skumsField] of Object.entries(columnMappings || {})) {
    if (skumsField) reverse[skumsField] = csvHeader
  }
  return reverse
}
