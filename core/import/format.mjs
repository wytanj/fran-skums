/**
 * Canonical SKUMS catalog import sheet — what Claude must emit
 * as reformatted.xlsx / .csv before HQ Import / Export upload.
 *
 * Keep this the only header contract. HQ Import auto-maps these
 * exact names (high confidence). Do not invent extra columns.
 */

/** @typedef {{
 *   key: string
 *   header: string
 *   required?: boolean
 *   recommended?: boolean
 *   kind: 'planogram' | 'full'
 *   maps_to: string
 *   notes: string
 * }} FormatColumn */

/** Official header row, in order. */
export const SKUMS_IMPORT_HEADERS = [
  'title',
  'title_ko',
  'upc',
  'brand',
  'sku',
  'category',
  'shelf',
  'priority',
]

/** @type {FormatColumn[]} */
export const SKUMS_IMPORT_COLUMNS = [
  {
    key: 'title',
    header: 'title',
    required: true,
    kind: 'planogram',
    maps_to: 'products.title',
    notes: 'English / SG selling name. Required. Never invent.',
  },
  {
    key: 'title_ko',
    header: 'title_ko',
    recommended: true,
    kind: 'planogram',
    maps_to: 'product_localizations.title (locale=ko)',
    notes: 'Supplier Korean name if present. Empty if the sheet has none. Do not AI-translate.',
  },
  {
    key: 'upc',
    header: 'upc',
    required: true,
    kind: 'planogram',
    maps_to: 'products.upc / ean / gtin (classified by digit length)',
    notes: 'Digits only, 8–14. Identity key. 13-digit Korean EANs belong here. Never invent or pad.',
  },
  {
    key: 'brand',
    header: 'brand',
    recommended: true,
    kind: 'planogram',
    maps_to: 'brands.name (resolved / created)',
    notes: 'From preamble (“Brand name: Medicube”) or a brand column. Exact supplier spelling.',
  },
  {
    key: 'sku',
    header: 'sku',
    kind: 'full',
    maps_to: 'products.sku',
    notes: 'Only if the supplier printed a SKU. Leave blank on planograms. Do not invent from the title.',
  },
  {
    key: 'category',
    header: 'category',
    kind: 'full',
    maps_to: 'categories.name',
    notes: 'Optional. Leave blank if unsure.',
  },
  {
    key: 'shelf',
    header: 'shelf',
    kind: 'planogram',
    maps_to: 'product_data.planogram.shelf',
    notes: 'Planogram shelf number / label (e.g. 4). Keep if present.',
  },
  {
    key: 'priority',
    header: 'priority',
    kind: 'planogram',
    maps_to: 'product_data.planogram.priority',
    notes: '★ / ☆ / blank from merch sheets. Do not invent.',
  },
]

export const SKUMS_IMPORT_RULES = [
  'Output one sheet named products. First row = exact headers below, lowercase, this order.',
  'Skip lightbox / visual panel / bay / preamble rows. Those are merch, not products.',
  'One output row per sellable SKU. Variant rows (3A / 3B) stay separate if UPCs differ.',
  'title is required. upc is required. Drop the row if either is missing.',
  'upc = digits only (strip spaces). Never invent, guess, or reuse another row’s code.',
  'title_ko = supplier Korean string only. Empty if absent. Never machine-translate.',
  'brand = one value for the whole file when the source only names it in the preamble.',
  'Do not invent sku, price, cost, stock, status, or pos_enabled.',
  'Do not include IMAGE, KR/EN duplicate title columns, or lightbox copy.',
  'Status/POS are applied by SKUMS (draft, POS off). Do not add those columns.',
  'Save as .xlsx or .csv and tell the human to upload at /import-export (Import tab).',
]

export const SKUMS_IMPORT_EXAMPLE_ROWS = [
  {
    title: 'PDRN PINK PEPTIDE SERUM 30ml',
    title_ko: 'PDRN 핑크 펩타이드 세럼 30ml',
    upc: '8800256108053',
    brand: 'Medicube',
    sku: '',
    category: '',
    shelf: '4',
    priority: '★',
  },
  {
    title: 'ZERO PORE PAD 2.0',
    title_ko: '2024 제로 모공 패드 2.0',
    upc: '8800256114665',
    brand: 'Medicube',
    sku: '',
    category: '',
    shelf: '2',
    priority: '★',
  },
]

/**
 * @param {'planogram' | 'full'} [kind]
 */
export function importFormatSpec(kind = 'planogram') {
  const columns =
    kind === 'full'
      ? SKUMS_IMPORT_COLUMNS
      : SKUMS_IMPORT_COLUMNS.filter((c) => c.kind === 'planogram' || c.required || c.recommended)
  const headers = columns.map((c) => c.header)
  return {
    format: 'skums_catalog_import_v1',
    kind,
    sheet_name: 'products',
    headers,
    columns,
    rules: SKUMS_IMPORT_RULES,
    example_rows: SKUMS_IMPORT_EXAMPLE_ROWS.map((row) => {
      /** @type {Record<string, string>} */
      const slim = {}
      for (const h of headers) slim[h] = row[h] ?? ''
      return slim
    }),
    upload: {
      path: '/import-export',
      tab: 'Import',
      note: 'Drop the reformatted file. Headers above auto-map. Confirm Title + UPC, then Import. Rows land as draft / POS off.',
    },
    identity: {
      match: 'upc (classified to ean/upc/gtin by length), else sku if present',
      never_match: 'title',
    },
    locales: {
      default_title: 'en (products.title)',
      title_ko: 'product_localizations locale=ko',
    },
  }
}

/**
 * @param {ReturnType<typeof importFormatSpec>} spec
 */
export function importFormatCsv(spec) {
  const headers = spec.headers
  const lines = [headers.join(',')]
  for (const row of spec.example_rows) {
    lines.push(
      headers
        .map((h) => {
          const v = String(row[h] ?? '')
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
        })
        .join(','),
    )
  }
  return lines.join('\n') + '\n'
}

/**
 * @param {ReturnType<typeof importFormatSpec>} spec
 * @param {any} XLSX
 * @returns {Buffer}
 */
export function importFormatXlsxBuffer(spec, XLSX) {
  const rows = [spec.headers, ...spec.example_rows.map((r) => spec.headers.map((h) => r[h] ?? ''))]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, spec.sheet_name)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
