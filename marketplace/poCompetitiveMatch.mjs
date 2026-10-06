import { tokenOverlap, tokenSet } from '../intelligence/match/catalogMatch.mjs'
import { brandKeyFromDisplayName } from './brandKey.mjs'

export const SHOPEE_MIN_OVERLAP = 0.6

/** Stronger Shopee band. Still the same match_source. Reported in the stats. */
export const SHOPEE_HIGH_OVERLAP = 0.7

export const MATCH_COLUMNS = [
  'barcode',
  'brand',
  'product_name',
  'match_source',
  'confidence',
  'price_sgd',
  'currency',
  'date_seen',
  'listing_url',
  'review_note',
]

const SIZE_RE = /(\d+(?:\.\d+)?)\s*(ml|kg|g|oz)\b/gi

/**
 * 12-digit UPC-A and 13-digit EAN-13 with a leading 0 are the same barcode.
 * A GTIN-14 with a leading 0 collapses to that EAN-13. Other lengths do not join.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function barcodeLookupKeys(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  const forms = new Set()
  if (digits.length === 14 && digits.startsWith('0')) forms.add(digits.slice(1))
  else forms.add(digits)

  const keys = new Set()
  for (const form of forms) {
    if (form.length === 12) {
      keys.add(form)
      keys.add(`0${form}`)
    } else if (form.length === 13) {
      keys.add(form)
      if (form.startsWith('0')) keys.add(form.slice(1))
    }
  }
  return [...keys]
}

/**
 * @param {string} header
 */
export function normHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

function pick(obj, names) {
  for (const name of names) {
    const value = obj[name]
    if (value == null) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

/**
 * @param {Record<string, unknown>} raw
 */
export function normalizePoRecord(raw) {
  const obj = {}
  for (const [key, value] of Object.entries(raw || {})) obj[normHeader(key)] = value
  return {
    barcode: pick(obj, ['upc', 'ean', 'gtin', 'barcode']),
    brand: pick(obj, ['brand', 'brand_name']),
    product_name: pick(obj, ['product_name', 'product', 'name', 'title']),
  }
}

/**
 * @param {Array<Record<string, unknown>>} records
 */
export function parsePoRecords(records) {
  const out = []
  for (const raw of records || []) {
    const row = normalizePoRecord(raw)
    if (!row.barcode && !row.brand && !row.product_name) continue
    out.push(row)
  }
  return out
}

/**
 * @param {string} text
 */
/**
 * Every column, header names normalized. Does not drop match columns.
 * @param {string} text
 * @returns {Array<Record<string, string>>}
 */
export function parseCsvObjects(text) {
  const source = String(text || '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }

  const header = rows[0]
  if (!header || !header.some((h) => String(h).trim())) return []
  const names = header.map(normHeader)
  const records = []
  for (const cells of rows.slice(1)) {
    if (!cells.some((c) => String(c).trim())) continue
    const obj = {}
    names.forEach((name, index) => {
      if (!name) return
      obj[name] = cells[index] ?? ''
    })
    records.push(obj)
  }
  return records
}

/**
 * @param {string} text
 */
export function parseCsv(text) {
  return parsePoRecords(parseCsvObjects(text))
}

/**
 * PR1 stores currency and the Singapore day in one cell, for example "SGD 2026-08-11".
 * @param {unknown} value
 * @returns {{ currency: string, date: string }}
 */
export function parseCurrencyDate(value) {
  const text = String(value ?? '').trim()
  if (!text) return { currency: '', date: '' }
  const both = text.match(/^([A-Za-z]{3})\s+(\d{4}-\d{2}-\d{2})$/)
  if (both) return { currency: both[1].toUpperCase(), date: both[2] }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { currency: '', date: text }
  if (/^[A-Za-z]{3}$/.test(text)) return { currency: text.toUpperCase(), date: '' }
  return { currency: '', date: '' }
}

/**
 * Singapore calendar day. Harvest timestamps are UTC.
 * @param {unknown} value
 */
export function dateSeen(value) {
  if (value == null || value === '') return ''
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function finiteNumber(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * SGD only. A blank currency is SGD. An explicit other currency stays blank in price_sgd.
 * @param {Record<string, unknown>} row
 */
export function priceSgd(row) {
  const explicit = finiteNumber(row?.price_sgd)
  const currency = String(row?.currency || 'SGD').trim().toUpperCase()
  if (explicit != null && (currency === 'SGD' || row?.currency == null || row?.currency === '')) {
    return explicit.toFixed(2)
  }
  if (currency !== 'SGD') return ''
  const price = finiteNumber(row?.price)
  return price == null ? '' : price.toFixed(2)
}

function sizeMap(text) {
  const map = new Map()
  for (const match of String(text || '').toLowerCase().matchAll(SIZE_RE)) {
    const unit = match[2]
    const amount = String(Number(match[1]))
    if (!map.has(unit)) map.set(unit, new Set())
    map.get(unit).add(amount)
  }
  return map
}

/**
 * Same unit, no shared amount. Different units do not conflict.
 * @param {string} a
 * @param {string} b
 */
export function sizesConflict(a, b) {
  const left = sizeMap(a)
  const right = sizeMap(b)
  for (const [unit, amounts] of left) {
    const other = right.get(unit)
    if (!other) continue
    let shared = false
    for (const amount of amounts) {
      if (other.has(amount)) shared = true
    }
    if (!shared) return true
  }
  return false
}

function escapeReg(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripBrand(title, brand) {
  const spaced = brandKeyFromDisplayName(brand).replace(/-/g, ' ')
  const needles = [String(brand || '').trim(), spaced].filter((n) => n.length >= 3)
  let out = String(title || '')
  for (const needle of needles) {
    out = out.replace(new RegExp(escapeReg(needle), 'ig'), ' ')
  }
  return out
}

function bindAlias(map, alias, brandKey) {
  if (!alias || !brandKey) return
  if (!map.has(alias)) {
    map.set(alias, brandKey)
    return
  }
  if (map.get(alias) !== brandKey) map.set(alias, '')
}

/**
 * null when no universe was supplied. The caller then uses brandKeyFromDisplayName.
 * An empty map means a universe was supplied and nothing resolved.
 * @param {Array<{ brand_key?: string, display_name?: string, aliases?: string[] }> | null | undefined} brands
 * @returns {Map<string, string> | null}
 */
export function buildAliasIndex(brands) {
  if (!brands) return null
  const map = new Map()
  for (const brand of brands) {
    const brandKey = String(brand?.brand_key || '').trim().toLowerCase()
    if (!brandKey) continue
    bindAlias(map, brandKey, brandKey)
    bindAlias(map, brandKeyFromDisplayName(brand.display_name || ''), brandKey)
    bindAlias(map, brandKeyFromDisplayName(brandKey), brandKey)
    for (const alias of brand.aliases || []) {
      bindAlias(map, brandKeyFromDisplayName(alias), brandKey)
    }
  }
  return map
}

/**
 * @param {string} brand
 * @param {Map<string, string> | null} aliasToBrandKey
 */
export function resolveBrandKey(brand, aliasToBrandKey) {
  const key = brandKeyFromDisplayName(brand)
  if (!key) return null
  if (!aliasToBrandKey) return key
  return aliasToBrandKey.get(key) || null
}

function keepMall(sellerType) {
  if (sellerType == null || sellerType === '') return true
  const seller = String(sellerType).toLowerCase()
  return seller === 'mall' || seller === 'unknown'
}

function iherbScore(row) {
  const priced = priceSgd(row) ? 1 : 0
  const seen = Date.parse(String(row.captured_at || row.date_seen || '')) || 0
  return priced * 1e15 + seen
}

/**
 * @param {Array<Record<string, unknown>>} products
 */
export function indexIherb(products) {
  const map = new Map()
  for (const product of products || []) {
    const keys = barcodeLookupKeys(product?.gtin ?? product?.barcode)
    if (!keys.length) continue
    for (const key of keys) {
      const current = map.get(key)
      if (!current || iherbScore(product) >= iherbScore(current)) map.set(key, product)
    }
  }
  return map
}

/**
 * @param {Array<Record<string, unknown>>} listings
 */
export function indexShopee(listings) {
  const map = new Map()
  for (const listing of listings || []) {
    if (!keepMall(listing?.seller_type)) continue
    const brandKey = String(listing?.brand_key || '').trim().toLowerCase()
    const title = String(listing?.title || '').trim()
    if (!brandKey || !title) continue
    if (!map.has(brandKey)) map.set(brandKey, [])
    map.get(brandKey).push(listing)
  }
  return map
}

/**
 * @param {{
 *   iherb?: Array<Record<string, unknown>>,
 *   shopee?: Array<Record<string, unknown>>,
 *   brands?: Array<{ brand_key?: string, display_name?: string, aliases?: string[] }> | null,
 * }} input
 */
export function buildMatchCatalog(input) {
  return {
    iherbByBarcode: indexIherb(input.iherb || []),
    shopeeByBrand: indexShopee(input.shopee || []),
    aliasToBrandKey: buildAliasIndex(input.brands),
  }
}

/**
 * Newest row that has a price. The date is that row's date, not a later empty price.
 * @param {Array<Record<string, unknown>>} snaps
 * @param {string} [idField]
 */
export function newestPricedObservation(snaps, idField = 'product_row_id') {
  const byId = new Map()
  for (const snap of snaps || []) {
    const id = snap?.[idField]
    if (!id) continue
    if (!byId.has(id)) byId.set(id, [])
    byId.get(id).push(snap)
  }
  const out = new Map()
  for (const [id, list] of byId) {
    list.sort((a, b) => String(b.captured_at || b.crawled_at || '').localeCompare(String(a.captured_at || a.crawled_at || '')))
    const priced = list.find((snap) => finiteNumber(snap.price) != null || finiteNumber(snap.price_sgd) != null)
    out.set(String(id), priced || list[0])
  }
  return out
}

function bestShopee(productName, brand, candidates) {
  const wanted = tokenSet(productName)
  let best = null
  for (const listing of candidates) {
    const title = String(listing.title || '')
    if (sizesConflict(productName, title)) continue
    const score = tokenOverlap(wanted, tokenSet(stripBrand(title, brand)))
    if (score < SHOPEE_MIN_OVERLAP) continue
    const seen = Date.parse(String(listing.crawled_at || listing.date_seen || '')) || 0
    if (
      !best
      || score > best.confidence
      || (score === best.confidence && seen > best.seen)
    ) {
      best = { listing, confidence: score, seen }
    }
  }
  return best
}

/**
 * @param {{ barcode?: string }} line
 * @param {ReturnType<typeof buildMatchCatalog>} catalog
 */
export function findIherbHit(line, catalog) {
  for (const key of barcodeLookupKeys(line?.barcode)) {
    const hit = catalog.iherbByBarcode.get(key)
    if (hit) return hit
  }
  return null
}

/**
 * @param {{ brand?: string, product_name?: string }} line
 * @param {ReturnType<typeof buildMatchCatalog>} catalog
 */
export function findShopeeHit(line, catalog) {
  const brand = String(line?.brand ?? '').trim()
  const productName = String(line?.product_name ?? '').trim()
  const brandKey = resolveBrandKey(brand, catalog.aliasToBrandKey)
  const candidates = brandKey ? catalog.shopeeByBrand.get(brandKey) || [] : []
  return bestShopee(productName, brand, candidates)
}

/**
 * Empty iHerb prices first, then rows with no match. Priced rows stay out of the queue.
 * @param {Array<Record<string, unknown>>} rows
 */
export function iherbRefreshPlan(rows) {
  const emptyPrice = []
  const none = []
  for (const row of rows || []) {
    const source = String(row.match_source || '')
    const price = String(row.price_sgd || '').trim()
    const line = {
      barcode: String(row.barcode || '').trim(),
      brand: String(row.brand || '').trim(),
      product_name: String(row.product_name || '').trim(),
      listing_url: String(row.listing_url || '').trim(),
      priority: source === 'iherb' && !price ? 'empty_price' : 'none',
    }
    if (!line.barcode) continue
    if (source === 'iherb' && !price) emptyPrice.push(line)
    else if (source === 'none') none.push(line)
  }
  return {
    empty_price: emptyPrice,
    none,
    queue: [...emptyPrice, ...none],
  }
}

/**
 * @param {{ barcode?: string, brand?: string, product_name?: string }} line
 * @param {ReturnType<typeof buildMatchCatalog>} catalog
 */
export function matchPoLine(line, catalog) {
  const barcode = String(line?.barcode ?? '').trim()
  const brand = String(line?.brand ?? '').trim()
  const product_name = String(line?.product_name ?? '').trim()
  const base = {
    barcode,
    brand,
    product_name,
    review_note: '',
  }

  const hit = findIherbHit(line, catalog)
  if (hit) {
    return {
      ...base,
      match_source: 'iherb',
      confidence: 1,
      price_sgd: priceSgd(hit),
      currency: String(hit.currency || (priceSgd(hit) ? 'SGD' : '')),
      date_seen: dateSeen(hit.captured_at || hit.date_seen),
      listing_url: String(hit.url || hit.listing_url || ''),
    }
  }

  const shopee = findShopeeHit(line, catalog)
  if (shopee) {
    const listing = shopee.listing
    return {
      ...base,
      match_source: 'shopee',
      confidence: Math.round(shopee.confidence * 1000) / 1000,
      price_sgd: priceSgd(listing),
      currency: String(listing.currency || (priceSgd(listing) ? 'SGD' : '')),
      date_seen: dateSeen(listing.crawled_at || listing.date_seen),
      listing_url: String(listing.listing_url || listing.url || ''),
    }
  }

  return {
    ...base,
    match_source: 'none',
    confidence: '',
    price_sgd: '',
    currency: '',
    date_seen: '',
    listing_url: '',
  }
}

/**
 * @param {Array<{ barcode?: string, brand?: string, product_name?: string }>} lines
 * @param {ReturnType<typeof buildMatchCatalog>} catalog
 */
export function matchPoLines(lines, catalog) {
  return (lines || []).map((line) => matchPoLine(line, catalog))
}

/**
 * @param {Array<Record<string, unknown>>} rows
 */
export function matchStats(rows) {
  const list = rows || []
  const n = list.length
  const count = (source) => list.filter((row) => row.match_source === source).length
  const pct = (hits) => (n ? Math.round((hits / n) * 1000) / 10 : 0)
  const iherb = count('iherb')
  const shopee = count('shopee')
  const none = count('none')
  const shopee_high = list.filter(
    (row) => row.match_source === 'shopee' && Number(row.confidence) >= SHOPEE_HIGH_OVERLAP,
  ).length
  return {
    rows: n,
    iherb,
    shopee,
    none,
    iherb_pct: pct(iherb),
    shopee_pct: pct(shopee),
    none_pct: pct(none),
    shopee_high,
    shopee_min_overlap: SHOPEE_MIN_OVERLAP,
    shopee_high_overlap: SHOPEE_HIGH_OVERLAP,
  }
}

function csvCell(value) {
  const text = value == null ? '' : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/**
 * @param {Array<Record<string, unknown>>} rows
 */
export function renderMatchCsv(rows) {
  const lines = [MATCH_COLUMNS.join(',')]
  for (const row of rows || []) {
    lines.push(MATCH_COLUMNS.map((column) => csvCell(row[column])).join(','))
  }
  return `${lines.join('\n')}\n`
}

export const WIDE_COLUMNS = [
  'barcode',
  'brand',
  'product_name',
  'iherb_price_sgd',
  'iherb_url',
  'iherb_seen_at',
  'iherb_confidence',
  'shopee_price_sgd',
  'shopee_url',
  'shopee_title',
  'shopee_seen_at',
  'shopee_confidence',
  'match_source',
  'confidence',
  'price_sgd',
  'seen_at',
  'review_note',
]

const WIDE_CONFIDENCE = new Set(['iherb_confidence', 'shopee_confidence', 'confidence'])

function formatConfidence(value) {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  if (n === 1) return '1.0'
  return String(Math.round(n * 1000) / 1000)
}

/**
 * Both channels stay on the row. The pick is iHerb, then Shopee at the 0.6 overlap, then none.
 * @param {{ barcode?: string, brand?: string, product_name?: string }} line
 * @param {ReturnType<typeof buildMatchCatalog>} catalog
 */
export function toWideRow(line, catalog) {
  const iherb = findIherbHit(line, catalog)
  const shopee = findShopeeHit(line, catalog)
  const iherbPrice = iherb ? priceSgd(iherb) : ''
  const shopeePrice = shopee ? priceSgd(shopee.listing) : ''
  const iherbSeen = iherb ? dateSeen(iherb.captured_at || iherb.date_seen || iherb.seen_at) : ''
  const shopeeSeen = shopee
    ? dateSeen(shopee.listing.crawled_at || shopee.listing.date_seen || shopee.listing.seen_at)
    : ''
  const shopeeConfidence = shopee ? Math.round(shopee.confidence * 1000) / 1000 : ''

  let match_source = 'none'
  let confidence = ''
  let price_sgd = ''
  let seen_at = ''
  if (iherb) {
    match_source = 'iherb'
    confidence = 1
    price_sgd = iherbPrice
    seen_at = iherbSeen
  } else if (shopee) {
    match_source = 'shopee'
    confidence = shopeeConfidence
    price_sgd = shopeePrice
    seen_at = shopeeSeen
  }

  return {
    barcode: String(line?.barcode ?? '').trim(),
    brand: String(line?.brand ?? '').trim(),
    product_name: String(line?.product_name ?? '').trim(),
    iherb_price_sgd: iherbPrice,
    iherb_url: iherb ? String(iherb.url || iherb.listing_url || '') : '',
    iherb_seen_at: iherbSeen,
    iherb_confidence: iherb ? 1 : '',
    shopee_price_sgd: shopeePrice,
    shopee_url: shopee ? String(shopee.listing.listing_url || shopee.listing.url || '') : '',
    shopee_title: shopee ? String(shopee.listing.title || '') : '',
    shopee_seen_at: shopeeSeen,
    shopee_confidence: shopeeConfidence,
    match_source,
    confidence,
    price_sgd,
    seen_at,
    review_note: '',
  }
}

/**
 * @param {Array<Record<string, unknown>>} rows
 */
export function wideStats(rows) {
  const list = rows || []
  const base = matchStats(list)
  const iherbRows = list.filter((row) => row.iherb_confidence !== '' && row.iherb_confidence != null)
  const shopeeRows = list.filter((row) => row.shopee_confidence !== '' && row.shopee_confidence != null)
  const blank = (value) => !String(value || '').trim()
  return {
    ...base,
    iherb_channel: iherbRows.length,
    shopee_channel: shopeeRows.length,
    empty_iherb_price: iherbRows.filter((row) => blank(row.iherb_price_sgd)).length,
    empty_shopee_price: shopeeRows.filter((row) => blank(row.shopee_price_sgd)).length,
  }
}

/**
 * @param {Array<Record<string, unknown>>} rows
 */
export function renderWideCsv(rows) {
  const lines = [WIDE_COLUMNS.join(',')]
  for (const row of rows || []) {
    lines.push(WIDE_COLUMNS.map((column) => {
      const value = WIDE_CONFIDENCE.has(column) ? formatConfidence(row[column]) : row[column]
      return csvCell(value)
    }).join(','))
  }
  return `${lines.join('\n')}\n`
}
