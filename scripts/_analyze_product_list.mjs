import { readFileSync, statSync } from 'node:fs'

/**
 * product-list.csv is an ABW export:
 *  - line 1: Date metadata
 *  - lines 2–15-ish: multi-line quoted header (broken across newlines)
 *  - line 16+: product rows with stable positional columns
 *
 * Positional layout (from sample rows):
 *  0 Catalog No
 *  1 UPC
 *  2 Brand
 *  3 Product Name
 *  4 Option Name
 *  5 Weight / pc (g)
 *  6 ABW Selling Price (USD)
 *  7 Availability
 *  8 Box Qty 1
 *  9 Box Selling Price 1
 * 10 Price / piece 1
 * 11 Availability box 1
 * 12 Box Qty 2
 * 13 Box Selling Price 2
 * 14 Price / piece 2
 * 15 Availability box 2
 * 16 Box Qty 3
 * 17 Box Selling Price 3
 * 18 Price / piece 3
 * 19 Availability box 3
 */

const path = 'product-list.csv'
const raw = readFileSync(path, 'utf8')
const lines = raw.split(/\r?\n/)

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else q = false
      } else cur += c
    } else if (c === '"') q = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const HEADERS = [
  'catalog_no',
  'upc',
  'brand',
  'product_name',
  'option_name',
  'weight_g',
  'selling_price_usd',
  'availability',
  'box_qty_1',
  'box_selling_1',
  'price_piece_1',
  'availability_1',
  'box_qty_2',
  'box_selling_2',
  'price_piece_2',
  'availability_2',
  'box_qty_3',
  'box_selling_3',
  'price_piece_3',
  'availability_3',
]

// Find first data row: catalog_no looks numeric / long id
let dataStart = 0
for (let i = 0; i < Math.min(50, lines.length); i++) {
  const cells = parseCsvLine(lines[i] || '')
  if (/^\d{6,}$/.test(cells[0] || '') && cells.length >= 6) {
    dataStart = i
    break
  }
}

const rows = []
let colMismatch = 0
for (let i = dataStart; i < lines.length; i++) {
  const line = lines[i]
  if (!line?.trim()) continue
  const cells = parseCsvLine(line)
  if (!/^\d{6,}$/.test(cells[0] || '')) continue // skip trailers / junk
  if (cells.length < 6) {
    colMismatch++
    continue
  }
  const obj = {}
  HEADERS.forEach((h, idx) => {
    obj[h] = cells[idx] || ''
  })
  rows.push({ rowNum: i + 1, obj, cellCount: cells.length })
}

function countMap() {
  return new Map()
}
function bump(m, k) {
  if (!k) return
  m.set(k, (m.get(k) || 0) + 1)
}
function dups(m) {
  let keys = 0
  let rowSum = 0
  for (const c of m.values()) {
    if (c > 1) {
      keys++
      rowSum += c
    }
  }
  return { distinct: m.size, keysWithDups: keys, rowsInDupKeys: rowSum }
}
function top(m, n = 15) {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value: String(value).slice(0, 80), count }))
}

const upcM = countMap()
const catalogM = countMap()
const brandM = countMap()
const nameM = countMap()
const nameOptM = countMap()
const availM = countMap()
const brandNamePairs = countMap()

let missingUpc = 0
let missingName = 0
let missingBrand = 0
let missingPrice = 0
let zeroPrice = 0
let hasBox1 = 0
let hasBox2 = 0
let hasBox3 = 0
let multiTokenUpc = 0
let invalidUpc = 0
let optionEmpty = 0
let optionFilled = 0
const prices = []
const weights = []
const samples = []
const dupUpcExamples = []

for (const { obj } of rows) {
  const { catalog_no, upc, brand, product_name, option_name, weight_g, selling_price_usd, availability } =
    obj

  if (!product_name) missingName++
  if (!brand) missingBrand++
  if (!upc) missingUpc++
  else {
    const parts = upc.split(/[|;/\s]+/).filter(Boolean)
    if (parts.length > 1) multiTokenUpc++
    for (const p of parts) {
      bump(upcM, p)
      if (!/^\d{8,14}$/.test(p)) invalidUpc++
    }
  }

  bump(catalogM, catalog_no)
  bump(brandM, brand)
  bump(nameM, product_name)
  bump(nameOptM, `${product_name}||${option_name}`)
  bump(availM, availability)
  bump(brandNamePairs, brand)

  if (!option_name) optionEmpty++
  else optionFilled++

  const price = Number(String(selling_price_usd).replace(/[^0-9.\-]/g, ''))
  if (!selling_price_usd || !Number.isFinite(price)) missingPrice++
  else {
    prices.push(price)
    if (price === 0) zeroPrice++
  }

  const w = Number(weight_g)
  if (Number.isFinite(w) && w > 0) weights.push(w)

  if (obj.box_qty_1) hasBox1++
  if (obj.box_qty_2) hasBox2++
  if (obj.box_qty_3) hasBox3++

  if (samples.length < 4) samples.push(obj)
}

// find upc dups examples
const upcDupKeys = [...upcM.entries()].filter(([, c]) => c > 1).slice(0, 5)
for (const [u] of upcDupKeys) {
  const hits = rows.filter((r) => r.obj.upc === u || r.obj.upc.includes(u)).slice(0, 3)
  dupUpcExamples.push({
    upc: u,
    count: upcM.get(u),
    titles: hits.map((h) => `${h.obj.brand} | ${h.obj.product_name} | ${h.obj.option_name}`),
  })
}

prices.sort((a, b) => a - b)
weights.sort((a, b) => a - b)
const pct = (arr, p) => (arr.length ? arr[Math.floor((arr.length - 1) * p)] : null)

// current importer scale math
const BATCH = 100
const brandCount = brandM.size
const stagingJsonBytesApprox = rows.length * 1800 // raw+normalized rough
const browserParseMb = Number((statSync(path).size / 1e6).toFixed(2))

const out = {
  file: {
    bytes: statSync(path).size,
    total_lines: lines.length,
    data_start_line_1based: dataStart + 1,
    product_rows: rows.length,
    col_mismatch_or_skipped: colMismatch,
  },
  schema: {
    headers: HEADERS,
    notes:
      'ABW multi-line quoted header; positional parse required. CSV header:true will fail.',
  },
  quality: {
    missing_name: missingName,
    missing_brand: missingBrand,
    missing_upc: missingUpc,
    missing_price: missingPrice,
    zero_price: zeroPrice,
    invalid_upc_tokens: invalidUpc,
    multi_token_upc_rows: multiTokenUpc,
    option_empty: optionEmpty,
    option_filled: optionFilled,
    has_box_tier_1: hasBox1,
    has_box_tier_2: hasBox2,
    has_box_tier_3: hasBox3,
    price: {
      n: prices.length,
      min: prices[0] ?? null,
      p50: pct(prices, 0.5),
      p90: pct(prices, 0.9),
      max: prices[prices.length - 1] ?? null,
    },
    weight_g: {
      n: weights.length,
      p50: pct(weights, 0.5),
      max: weights[weights.length - 1] ?? null,
    },
    identity: {
      upc: dups(upcM),
      catalog_no: dups(catalogM),
      product_name: dups(nameM),
      name_plus_option: dups(nameOptM),
    },
    top_brands: top(brandM),
    top_availability: top(availM, 15),
    dup_upc_examples: dupUpcExamples,
    sample_rows: samples,
  },
  importer_stress: {
    rows: rows.length,
    distinct_brands: brandCount,
    batches_at_100: Math.ceil(rows.length / BATCH),
    // current UI: stage import_job_rows + insert products per batch
    supabase_writes_min: Math.ceil(rows.length / BATCH) * 2,
    brand_resolve_if_uncached: brandCount,
    estimated_staged_json_mb: Number((stagingJsonBytesApprox / 1e6).toFixed(1)),
    file_mb: browserParseMb,
    // browser holds all rows in memory as objects
    risk: [
      'Papa header:true treats Date row as headers → mapping broken',
      'Entire 59k rows held in Vue reactive state',
      'Per-row brand_id/category_id resolve still possible under cache miss storms',
      'import_job_rows duplicates full raw+normalized → ~100MB+ payload',
      'auto-commit demo path creates 59k products with no dedupe/upsert',
      'currency hardcoded USD (correct for ABW) but retail vs wholesale conflated',
      'GTIN validation strips non 6-14 digit — JP EANs ok; multi-UPC lost',
      'no catalog_no → sku/supplier_item mapping unless user maps manually',
      'box tiers ignored by current FIXED_FIELDS',
      're-import creates duplicates (insert only, no identity match)',
    ],
  },
  recommended_mapping: {
    title: 'product_name (+ option_name suffix if present)',
    sku_or_supplier_item: 'catalog_no',
    ean_or_upc: 'upc (prefer ean for 13-digit JP/KR)',
    brand: 'brand → brands table',
    cost_or_wholesale: 'selling_price_usd → cost_price (ABW sell-in, not retail)',
    weight: 'weight_g + weight_unit g',
    availability: 'supplier_availability / product_data.supplier.availability',
    option_name: 'product_data.supplier.option_name or variant title',
    currency: 'USD',
    pos_enabled: 'default false for full catalog dump; true only for POS subset',
    box_tiers: 'product_data.wholesale.tiers[] or trade_units',
  },
}

console.log(JSON.stringify(out, null, 2))
