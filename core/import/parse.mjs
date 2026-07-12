/**
 * Dirty supplier catalog parse: CSV/TSV/XLSX → headers + row objects.
 * Handles ABW-style multi-line headers and preamble metadata rows.
 */

/** @typedef {{ headers: string[], rows: Record<string, string>[], headerIndex: number, dataStartIndex: number, providerHint: string }} ParseResult */

export const TRAILER_PREFIXES = [
  '* Information in this catalog',
  '# Due to packaging',
]

/**
 * @param {string} line
 * @param {string} [delimiter]
 */
export function parseDelimitedLine(line, delimiter = ',') {
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
    else if (c === delimiter) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => String(s ?? '').trim())
}

/**
 * @param {string[]} headers
 */
export function makeUniqueHeaders(headers) {
  const counts = new Map()
  return headers.map((header, index) => {
    const base = String(header || `Column ${index + 1}`).replace(/\s+/g, ' ').trim() || `Column ${index + 1}`
    const count = counts.get(base) || 0
    counts.set(base, count + 1)
    return count === 0 ? base : `${base} ${count + 1}`
  })
}

/**
 * @param {string[]} row
 */
export function scoreHeaderRow(row) {
  const cells = row.map((c) => String(c || '').toLowerCase().trim())
  const joined = cells.join('|')
  let score = cells.filter(Boolean).length

  if (cells[0] === 'date' || joined.startsWith('date|')) score -= 40
  if (/^\d{6,}$/.test(cells[0] || '')) score -= 30

  const tokens = [
    'catalog',
    'upc',
    'ean',
    'barcode',
    'brand',
    'product name',
    'product_name',
    'sku',
    'title',
    'price',
    'availability',
    'option',
  ]
  for (const t of tokens) {
    if (joined.includes(t.replace(' ', '')) || joined.includes(t)) score += 8
  }
  if (joined.includes('catalog') && joined.includes('upc')) score += 25
  if (joined.includes('brand') && (joined.includes('product') || joined.includes('name'))) score += 15

  return score
}

/**
 * ABW multi-line quoted headers: real columns are positional.
 * Detect via preamble + first data row shape.
 * @param {string[][]} matrix
 */
export function looksLikeAbwMatrix(matrix) {
  const head = matrix
    .slice(0, 20)
    .map((r) => r.join(' ').toLowerCase())
    .join('\n')
  if (head.includes('abw') && head.includes('catalog')) return true
  // Multi-line header fragment pattern
  if (head.includes('catalog no') && head.includes('wholesale') && head.includes('box qty')) return true
  return false
}

export const ABW_HEADERS = [
  'Catalog No.',
  'UPC',
  'Brand',
  'Product Name',
  'Option Name',
  'Weight / pc (g)',
  'ABW Selling Price (USD)',
  'Availability',
  'Box Qty 1',
  'Box Selling Price 1 (USD)',
  'Price / piece 1 (USD)',
  'Availability 1',
  'Box Qty 2',
  'Box Selling Price 2 (USD)',
  'Price / piece 2 (USD)',
  'Availability 2',
  'Box Qty 3',
  'Box Selling Price 3 (USD)',
  'Price / piece 3 (USD)',
  'Availability 3',
]

/**
 * @param {string[][]} matrix
 * @returns {ParseResult}
 */
export function matrixToParseResult(matrix) {
  if (!matrix?.length) {
    return { headers: [], rows: [], headerIndex: 0, dataStartIndex: 0, providerHint: 'generic' }
  }

  if (looksLikeAbwMatrix(matrix)) {
    let dataStart = 0
    for (let i = 0; i < Math.min(40, matrix.length); i++) {
      const c0 = String(matrix[i][0] || '').trim()
      if (/^\d{6,}$/.test(c0) && matrix[i].filter(Boolean).length >= 5) {
        dataStart = i
        break
      }
    }
    const headers = makeUniqueHeaders(ABW_HEADERS)
    const rows = []
    for (let i = dataStart; i < matrix.length; i++) {
      const cells = matrix[i]
      const c0 = String(cells[0] || '').trim()
      if (!/^\d{6,}$/.test(c0)) continue
      const first = String(cells[0] || '')
      if (TRAILER_PREFIXES.some((p) => first.startsWith(p))) continue
      const obj = {}
      headers.forEach((h, idx) => {
        obj[h] = String(cells[idx] ?? '').trim()
      })
      if (!Object.values(obj).some(Boolean)) continue
      rows.push(obj)
    }
    return {
      headers,
      rows,
      headerIndex: Math.max(0, dataStart - 1),
      dataStartIndex: dataStart,
      providerHint: 'abw',
    }
  }

  // Generic: densest / best-scoring header in first 25 rows
  let headerIndex = 0
  let best = -Infinity
  for (let i = 0; i < Math.min(25, matrix.length); i++) {
    const s = scoreHeaderRow(matrix[i])
    if (s > best) {
      best = s
      headerIndex = i
    }
  }

  const headers = makeUniqueHeaders(matrix[headerIndex] || [])
  const rows = []
  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const cells = matrix[i]
    const first = String(cells[0] || '').trim()
    if (TRAILER_PREFIXES.some((p) => first.startsWith(p))) continue
    if (!cells.some((c) => String(c || '').trim())) continue
    const obj = {}
    headers.forEach((h, idx) => {
      obj[h] = String(cells[idx] ?? '').trim()
    })
    if (!Object.values(obj).some(Boolean)) continue
    rows.push(obj)
  }

  return {
    headers,
    rows,
    headerIndex,
    dataStartIndex: headerIndex + 1,
    providerHint: 'generic',
  }
}

/**
 * @param {string} text
 * @param {{ delimiter?: string }} [opts]
 * @returns {ParseResult}
 */
export function parseDelimitedText(text, opts = {}) {
  const delimiter = opts.delimiter || (text.includes('\t') && !text.slice(0, 500).includes(',') ? '\t' : ',')
  const lines = String(text || '').split(/\r?\n/)
  const matrix = lines
    .filter((l) => l.length > 0)
    .map((l) => parseDelimitedLine(l, delimiter))
  return matrixToParseResult(matrix)
}

/**
 * Parse XLSX ArrayBuffer using SheetJS-like API (caller passes XLSX module).
 * @param {ArrayBuffer} buffer
 * @param {any} XLSX
 * @returns {ParseResult}
 */
export function parseXlsxBuffer(buffer, XLSX) {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const matrix = XLSX.utils
    .sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
    .map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? '').trim()) : []))
  return matrixToParseResult(matrix)
}
