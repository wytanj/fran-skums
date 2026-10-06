import { brandKeyFromDisplayName } from './brandKey.mjs'
import { shopCollectionListUrl } from './shopCollections.mjs'
import { parseShopeeItemIds } from './shopee/urls.mjs'

/**
 * PO brand with spaces and punctuation removed, mapped to a mall-harvest sheet key.
 * Taken from po_match.py. These are brand keys, not shop ids.
 */
export const COMPACT_BRAND_KEYS = {
  vt: 'vt-cosmetics',
  jungsaemmool: 'jung-saem-mool',
  drthea: 'dr-althea',
  dralthea: 'dr-althea',
  dearklairs: 'dear-klairs',
  tfit: 'tfit',
  roundlab: 'round-lab',
  cnp: 'cnp-laboratory',
  aprilskin: 'april-skin',
  bouquetgarni: 'bouquet-garni',
  houseofhur: 'house-of-hur',
  haruharuwonder: 'haruharu-wonder',
  axisy: 'axis-y',
  beautyofjoseon: 'beauty-of-joseon',
}

function compact(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function unverified(po_brand, brand_key = brandKeyFromDisplayName(po_brand)) {
  return {
    po_brand,
    brand_key,
    aliases: [po_brand],
    search_keyword: po_brand,
    shop_username: null,
    shop_verified: false,
    note: 'TODO shop username unverified',
  }
}

function verified(po_brand, brand_key, shop_username, aliases = [po_brand]) {
  return {
    po_brand,
    brand_key,
    aliases,
    search_keyword: po_brand,
    shop_username,
    shop_verified: true,
    note: 'shop username from mall-harvest-full.xlsx',
  }
}

/**
 * Top uncovered PO brands from the PR1 stats, in that order.
 * shop_username is set only when mall-harvest-full.xlsx has that sheet and a username on the row.
 */
export const PO_BRAND_ALIAS_PACK = [
  unverified('peripera'),
  verified('joocyee', 'joocyee', 'joocyee.sg'),
  verified('judydoll', 'judydoll', 'judydoll.sg'),
  verified('fwee', 'fwee', 'fwee.official.sg'),
  unverified('bbi@', 'bbi'),
  unverified('aztk'),
  unverified('clio'),
  unverified('maogeping'),
  unverified('veecci'),
  unverified('vdl'),
  verified('skintific', 'skintific', 'skintific.sg'),
  unverified('the saem', 'the-saem'),
  verified('t-fit', 'tfit', 'tfitkorea.sg', ['t-fit', 'tfit']),
  unverified('unleasia'),
  verified('tirtir', 'tirtir', 'tirtir_official.sg'),
  unverified('red chamber', 'red-chamber'),
  unverified('innisfree'),
  unverified('watercome'),
  unverified('coringco'),
  unverified('dewytree'),
  unverified('2an'),
  unverified('cell fusion c', 'cell-fusion-c'),
  unverified('huxley'),
  unverified('naming'),
  unverified('studio17'),
  unverified('marshique'),
  unverified('so natural', 'so-natural'),
  unverified('growus'),
  unverified('the face shop', 'the-face-shop'),
  unverified('fation'),
]

/**
 * @param {string} brand
 * @param {typeof PO_BRAND_ALIAS_PACK} [pack]
 */
export function resolveAlias(brand, pack = PO_BRAND_ALIAS_PACK) {
  const key = brandKeyFromDisplayName(brand)
  const folded = compact(brand)
  if (!key && !folded) return null
  for (const entry of pack) {
    const names = [entry.po_brand, entry.brand_key, ...(entry.aliases || [])]
    for (const name of names) {
      if (key && brandKeyFromDisplayName(name) === key) return entry
      if (folded && compact(name) === folded) return entry
    }
  }
  return null
}

/**
 * @param {string} brand
 * @param {typeof PO_BRAND_ALIAS_PACK} [pack]
 * @returns {string | null}
 */
export function brandKeyForPoBrand(brand, pack = PO_BRAND_ALIAS_PACK) {
  const entry = resolveAlias(brand, pack)
  if (entry) return entry.brand_key
  const folded = compact(brand)
  if (folded && COMPACT_BRAND_KEYS[folded]) return COMPACT_BRAND_KEYS[folded]
  return brandKeyFromDisplayName(brand) || null
}

function addBrand(map, brandKey, alias) {
  const key = String(brandKey || '').trim().toLowerCase()
  if (!key) return
  const row = map.get(key) || { brand_key: key, display_name: key, aliases: [] }
  if (alias) row.aliases.push(String(alias))
  map.set(key, row)
}

/**
 * Alias index for the matcher. Listing keys stay reachable, and the pack overrides t-fit to tfit.
 * @param {Array<{ brand?: string }>} lines
 * @param {Array<{ brand_key?: string }>} listings
 * @param {typeof PO_BRAND_ALIAS_PACK} [pack]
 */
export function brandsForLines(lines, listings, pack = PO_BRAND_ALIAS_PACK) {
  const map = new Map()
  for (const listing of listings || []) addBrand(map, listing.brand_key, listing.brand_key)
  for (const entry of pack) {
    addBrand(map, entry.brand_key, entry.po_brand)
    for (const alias of entry.aliases || []) addBrand(map, entry.brand_key, alias)
  }
  for (const [alias, brandKey] of Object.entries(COMPACT_BRAND_KEYS)) {
    addBrand(map, brandKey, alias)
  }
  for (const line of lines || []) {
    addBrand(map, brandKeyForPoBrand(line.brand, pack), line.brand)
  }
  return [...map.values()]
}

/**
 * @param {typeof PO_BRAND_ALIAS_PACK} [pack]
 * @param {{ brands?: string[], maxPages?: number, resume?: { brands?: Record<string, { pages_done?: number, done?: boolean }> } }} [opts]
 */
export function mallHarvestPlan(pack = PO_BRAND_ALIAS_PACK, opts = {}) {
  const filter = new Set((opts.brands || []).map((brand) => String(brand).trim().toLowerCase()).filter(Boolean))
  const maxPages = Math.min(Math.max(Number(opts.maxPages ?? 3) || 3, 1), 15)
  const resumeBrands = opts.resume?.brands || {}
  const selected = pack.filter((entry) => {
    if (!filter.size) return true
    return filter.has(entry.brand_key)
      || filter.has(String(entry.po_brand).toLowerCase())
      || filter.has(brandKeyFromDisplayName(entry.po_brand))
  })

  return selected.map((entry) => {
    const state = resumeBrands[entry.brand_key] || {}
    const base = {
      po_brand: entry.po_brand,
      brand_key: entry.brand_key,
      shop_username: entry.shop_verified ? entry.shop_username : null,
      shop_verified: entry.shop_verified === true,
    }
    if (!entry.shop_verified || !entry.shop_username) {
      return { ...base, skipped: 'unverified_shop', urls: [] }
    }
    const start = Number(state.pages_done || 0)
    if (state.done || start >= maxPages) {
      return { ...base, skipped: 'resume_done', urls: [] }
    }
    const urls = []
    for (let page = start; page < maxPages; page++) {
      urls.push(shopCollectionListUrl(entry.shop_username, { page, sort_by: 'pop', country: 'sg' }))
    }
    return { ...base, skipped: null, urls }
  })
}

/**
 * Shopee rows from the PR1 sheet whose price is blank and whose URL has a shop id and item id.
 * @param {Array<Record<string, unknown>>} rows
 */
export function shopeePriceRefreshTargets(rows) {
  const out = []
  const seen = new Set()
  for (const row of rows || []) {
    if (String(row.match_source || '') !== 'shopee') continue
    if (String(row.price_sgd || '').trim()) continue
    const ids = parseShopeeItemIds(row.listing_url || '')
    if (!ids) continue
    const key = `${ids.shop_id}:${ids.item_id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      barcode: String(row.barcode || ''),
      brand: String(row.brand || ''),
      product_name: String(row.product_name || ''),
      shop_id: ids.shop_id,
      item_id: ids.item_id,
      url: String(row.listing_url || ''),
    })
  }
  return out
}

/**
 * @param {Record<string, unknown>} row
 */
export function listingFromHarvestRow(row) {
  const brandKey = String(row?.brand_key || '').trim().toLowerCase()
  const title = String(row?.title || row?.name || '').trim()
  if (!brandKey || !title || brandKey.startsWith('(')) return null
  const price = row?.price === '' || row?.price == null ? null : Number(row.price)
  const priceSgd = row?.price_sgd === '' || row?.price_sgd == null ? null : Number(row.price_sgd)
  const numericPrice = Number.isFinite(price) ? price : (Number.isFinite(priceSgd) ? priceSgd : null)
  return {
    brand_key: brandKey,
    title,
    price: numericPrice,
    price_sgd: numericPrice,
    currency: String(row?.currency || 'SGD') || 'SGD',
    seller_type: String(row?.seller_type || 'mall') || 'mall',
    shop_id: String(row?.shop_id || ''),
    item_id: String(row?.item_id || ''),
    listing_url: String(row?.listing_url || row?.url || ''),
    crawled_at: row?.crawled_at || row?.seen_at || null,
    shop_username: String(row?.shop_username || '') || null,
  }
}

function hasPrice(row) {
  const price = row?.price == null || row?.price === '' ? null : Number(row.price)
  const priceSgd = row?.price_sgd == null || row?.price_sgd === '' ? null : Number(row.price_sgd)
  return Number.isFinite(price) || Number.isFinite(priceSgd)
}

function preferListing(prev, next) {
  if (next?.price_only) {
    return {
      ...prev,
      price: hasPrice(next) ? next.price : prev.price,
      price_sgd: hasPrice(next) ? (next.price_sgd ?? next.price) : prev.price_sgd,
      currency: next.currency || prev.currency,
      crawled_at: next.crawled_at || prev.crawled_at,
      title: prev.title || next.title,
      listing_url: prev.listing_url || next.listing_url,
    }
  }
  const prevPriced = hasPrice(prev)
  const nextPriced = hasPrice(next)
  if (nextPriced && !prevPriced) return { ...prev, ...next }
  if (prevPriced && !nextPriced) {
    return {
      ...next,
      ...prev,
      title: prev.title || next.title,
      listing_url: prev.listing_url || next.listing_url,
    }
  }
  const prevSeen = Date.parse(prev.crawled_at || '') || 0
  const nextSeen = Date.parse(next.crawled_at || '') || 0
  return nextSeen >= prevSeen ? { ...prev, ...next } : { ...next, ...prev }
}

/**
 * Later lists win when both sides have a price and the later crawl is newer.
 * A priced row beats an empty price.
 * @param {Array<Array<Record<string, unknown>>>} lists
 */
export function mergeListings(lists) {
  const byKey = new Map()
  for (const list of lists || []) {
    for (const row of list || []) {
      if (!row?.brand_key || !row?.title) continue
      const key = row.shop_id && row.item_id
        ? `${row.shop_id}:${row.item_id}`
        : `${row.brand_key}:${row.title}`
      const prev = byKey.get(key)
      byKey.set(key, prev ? preferListing(prev, row) : row)
    }
  }
  return [...byKey.values()]
}
