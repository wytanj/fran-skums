#!/usr/bin/env node
/** Extract Shopee + iHerb aggregates for the assortment advisory report.
 *  Read-only. Dumps JSON to stdout (pipe to a file). */
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const envp = resolve(ROOT, '.env')
if (existsSync(envp)) for (const line of readFileSync(envp, 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#')) continue; const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (!m || process.env[m[1]] !== undefined) continue; let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[m[1]] = v }

const ws = process.env.FRAN_MCP_WORKSPACE_ID
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function pageAll(table, select, apply) {
  let all = []
  let from = 0
  for (;;) {
    let q = db.from(table).select(select).eq('workspace_id', ws).range(from, from + 999)
    if (apply) q = apply(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    all = all.concat(data || [])
    if (!data || data.length < 1000) break
    from += 1000
  }
  return all
}

const num = (x) => (x == null ? null : Number(x))
const quantile = (arr, p) => {
  const a = arr.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y)
  if (!a.length) return null
  const i = (a.length - 1) * p
  const lo = Math.floor(i)
  return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (i - lo)
}
const band = (p) => (p == null ? 'unknown' : p < 10 ? '<10' : p < 20 ? '10–20' : p < 30 ? '20–30' : p < 50 ? '30–50' : '50+')

// ---------------------------------------------------------------- Shopee
const shopeeRows = await pageAll(
  'v_marketplace_listing_latest',
  'listing_id, crawled_at, price, currency, rating, review_count, sold_label, sold_count_lower_bound, seller_type, signals, brand_key, shop_username, shop_collection_name, platform_category_leaf, marketplace_listings(title, shop_name, status)',
)

const sh = { total: shopeeRows.length }
{
  const active = shopeeRows.filter((r) => r.marketplace_listings?.status !== 'inactive')
  sh.active = active.length
  sh.brands = new Set(active.map((r) => r.brand_key).filter(Boolean)).size
  sh.shops = new Set(active.map((r) => r.shop_username).filter(Boolean)).size
  sh.with_sold = active.filter((r) => r.sold_count_lower_bound != null).length
  sh.sold_sum_lifetime = active.reduce((s, r) => s + (r.sold_count_lower_bound || 0), 0)
  sh.latest_crawl = active.map((r) => r.crawled_at).sort().pop()
  sh.currency = [...new Set(active.map((r) => r.currency).filter(Boolean))]
  const prices = active.map((r) => num(r.price))
  sh.price = { p25: quantile(prices, 0.25), median: quantile(prices, 0.5), p75: quantile(prices, 0.75) }
  sh.price_bands = active.reduce((m, r) => ((m[band(num(r.price))] = (m[band(num(r.price))] || 0) + 1), m), {})

  const byBrand = new Map()
  for (const r of active) {
    const bk = r.brand_key || '(unattributed)'
    const b = byBrand.get(bk) || { listings: 0, sold: 0, prices: [], ratings: [], rev: 0 }
    b.listings++
    b.sold += r.sold_count_lower_bound || 0
    if (r.price != null) b.prices.push(num(r.price))
    if (r.rating != null) b.ratings.push(num(r.rating))
    b.rev += r.review_count || 0
    byBrand.set(bk, b)
  }
  sh.top_brands = [...byBrand.entries()]
    .filter(([k]) => k !== '(unattributed)')
    .sort((a, b) => b[1].sold - a[1].sold)
    .slice(0, 25)
    .map(([k, b]) => ({
      brand_key: k, listings: b.listings, sold_lifetime: b.sold, reviews: b.rev,
      median_price: quantile(b.prices, 0.5), avg_rating: b.ratings.length ? +(b.ratings.reduce((s, x) => s + x, 0) / b.ratings.length).toFixed(2) : null,
    }))

  sh.top_skus = active
    .filter((r) => r.sold_count_lower_bound != null)
    .sort((a, b) => b.sold_count_lower_bound - a.sold_count_lower_bound)
    .slice(0, 30)
    .map((r) => ({
      brand: r.brand_key, title: (r.marketplace_listings?.title || '').slice(0, 80),
      price: num(r.price), sold_lifetime: r.sold_count_lower_bound, rating: num(r.rating), reviews: r.review_count,
      leaf: r.platform_category_leaf, sales_rank: r.signals?.sales_rank ?? null,
    }))

  const byLeaf = new Map()
  for (const r of active) {
    const l = r.platform_category_leaf || '(no crumb)'
    const b = byLeaf.get(l) || { listings: 0, sold: 0, prices: [] }
    b.listings++; b.sold += r.sold_count_lower_bound || 0
    if (r.price != null) b.prices.push(num(r.price))
    byLeaf.set(l, b)
  }
  sh.top_leaves = [...byLeaf.entries()].sort((a, b) => b[1].sold - a[1].sold).slice(0, 22)
    .map(([l, b]) => ({ leaf: l, listings: b.listings, sold_lifetime: b.sold, median_price: quantile(b.prices, 0.5) }))

  const byShelf = new Map()
  for (const r of active) {
    if (!r.shop_collection_name) continue
    const b = byShelf.get(r.shop_collection_name) || { listings: 0, sold: 0 }
    b.listings++; b.sold += r.sold_count_lower_bound || 0
    byShelf.set(r.shop_collection_name, b)
  }
  sh.top_shelves = [...byShelf.entries()].sort((a, b) => b[1].sold - a[1].sold).slice(0, 12)
    .map(([s, b]) => ({ shelf: s, listings: b.listings, sold_lifetime: b.sold }))

  // Top Sales grid movers (MH-14): listings carrying a sales_rank signal
  const movers = active.filter((r) => r.signals?.sales_rank != null)
  sh.movers_count = movers.length
  sh.top_movers = movers.sort((a, b) => (a.signals.sales_rank) - (b.signals.sales_rank)).slice(0, 20)
    .map((r) => ({ rank: r.signals.sales_rank, brand: r.brand_key, title: (r.marketplace_listings?.title || '').slice(0, 70), price: num(r.price), sold_lifetime: r.sold_count_lower_bound }))
}

// ---------------------------------------------------------------- iHerb
let iproducts = await pageAll('iherb_products', 'id, brand_key, brand_name, part_number, name, gtin, url, category_leaf, category_path_text, metadata, last_seen_at')

// Redirect-contamination filter: discontinued PDPs bounce to a suggested
// product (Ancient Nutrition / NOW Foods / ALLMAX / PanOxyl…) and the write
// overwrote identity. Fingerprint: the name's brand prefix does not match
// brand_key (which the candidate loader preserved).
const CONTAM_NAMES = /^(ancient nutrition|now foods|allmax|panoxyl|sports research|herb pharm)/i
const contaminated = iproducts.filter((r) => CONTAM_NAMES.test(String(r.name || '').trim()))
const contamCount = contaminated.length
iproducts = iproducts.filter((r) => !CONTAM_NAMES.test(String(r.name || '').trim()))
const isnaps = await pageAll('iherb_product_snapshots', 'product_row_id, captured_at, price, list_price, currency, rating, review_count, sold_label, sold_lower_bound, in_stock, signals')

const latestSnap = new Map()
const latestFilled = new Map() // latest non-null sold/price per product (history merge)
{
  const sorted = isnaps.sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)))
  for (const s of sorted) {
    if (!latestSnap.has(s.product_row_id)) latestSnap.set(s.product_row_id, s)
    const f = latestFilled.get(s.product_row_id) || {}
    if (f.price == null && s.price != null) f.price = num(s.price)
    if (f.sold == null && s.sold_lower_bound != null) f.sold = s.sold_lower_bound
    if (f.rating == null && s.rating != null) { f.rating = num(s.rating); f.reviews = s.review_count }
    if (f.in_stock == null && s.in_stock != null) f.in_stock = s.in_stock
    latestFilled.set(s.product_row_id, f)
  }
}

const ih = { total: iproducts.length, brands: new Set(iproducts.map((r) => r.brand_key).filter(Boolean)).size }
{
  const rows = iproducts.map((p) => {
    const f = latestFilled.get(p.id) || {}
    const meta = p.metadata || {}
    return {
      brand: p.brand_key, part: p.part_number, name: p.name, leaf: p.category_leaf,
      price: f.price ?? null, sold30: f.sold ?? null, rating: f.rating ?? null, reviews: f.reviews ?? null,
      in_stock: f.in_stock ?? null,
      rank: meta.rank_best?.rank ?? null, rank_cat: meta.rank_best?.category ?? null,
      vol_ml: meta.package_quantity_ml ?? null, ppml: meta.price_per_ml ?? null,
      ingredients: meta.ingredients_text || null,
    }
  })
  ih.with_sold30 = rows.filter((r) => r.sold30 != null).length
  ih.sold30_sum = rows.reduce((s, r) => s + (r.sold30 || 0), 0)
  ih.with_rank = rows.filter((r) => r.rank != null).length
  ih.rank_no1 = rows.filter((r) => r.rank === 1).length
  ih.latest_seen = iproducts.map((r) => r.last_seen_at).sort().pop()
  const prices = rows.map((r) => r.price)
  ih.price = { p25: quantile(prices, 0.25), median: quantile(prices, 0.5), p75: quantile(prices, 0.75) }
  ih.price_bands = rows.reduce((m, r) => ((m[band(r.price)] = (m[band(r.price)] || 0) + 1), m), {})

  const byBrand = new Map()
  for (const r of rows) {
    const b = byBrand.get(r.brand) || { skus: 0, sold30: 0, prices: [], no1: 0, ranked: 0, reviews: 0 }
    b.skus++; b.sold30 += r.sold30 || 0
    if (r.price != null) b.prices.push(r.price)
    if (r.rank === 1) b.no1++
    if (r.rank != null) b.ranked++
    b.reviews += r.reviews || 0
    byBrand.set(r.brand, b)
  }
  ih.top_brands = [...byBrand.entries()].sort((a, b) => b[1].sold30 - a[1].sold30).slice(0, 25)
    .map(([k, b]) => ({ brand_key: k, skus: b.skus, sold_30d: b.sold30, no1_ranks: b.no1, median_price: quantile(b.prices, 0.5), reviews: b.reviews }))

  ih.top_skus = rows.filter((r) => r.sold30 != null).sort((a, b) => b.sold30 - a.sold30).slice(0, 30)
    .map((r) => ({ brand: r.brand, part: r.part, name: (r.name || '').slice(0, 80), price: r.price, sold_30d: r.sold30, rank: r.rank, rank_cat: r.rank_cat, ppml: r.ppml }))

  ih.no1_skus = rows.filter((r) => r.rank === 1).sort((a, b) => (b.sold30 || 0) - (a.sold30 || 0)).slice(0, 40)
    .map((r) => ({ brand: r.brand, name: (r.name || '').slice(0, 75), cat: r.rank_cat, price: r.price, sold_30d: r.sold30 }))

  const byLeaf = new Map()
  for (const r of rows) {
    const l = r.leaf || '(none)'
    const b = byLeaf.get(l) || { skus: 0, sold30: 0, prices: [], ppml: [] }
    b.skus++; b.sold30 += r.sold30 || 0
    if (r.price != null) b.prices.push(r.price)
    if (r.ppml != null) b.ppml.push(r.ppml)
    byLeaf.set(l, b)
  }
  ih.top_leaves = [...byLeaf.entries()].sort((a, b) => b[1].sold30 - a[1].sold30).slice(0, 25)
    .map(([l, b]) => ({ leaf: l, skus: b.skus, sold_30d: b.sold30, median_price: quantile(b.prices, 0.5), median_ppml: quantile(b.ppml, 0.5) }))

  // ---------- ingredient trend mining over the INCI corpus ----------
  const FAMILIES = {
    'heartleaf (houttuynia)': /houttuynia/i,
    'centella / cica': /centella|madecassoside|asiaticoside|asiatic acid|madecassic/i,
    'snail mucin': /snail secretion|snail mucin/i,
    'rice (oryza)': /oryza sativa/i,
    'niacinamide': /niacinamide/i,
    'PDRN / DNA': /\bpdrn\b|sodium dna|deoxyribonucle/i,
    'peptides': /peptide|palmitoyl (tri|tetra|penta|hexa)|copper tripeptide/i,
    'mugwort (artemisia)': /artemisia/i,
    'propolis / honey': /propolis|honey extract|\bmel\b/i,
    'hyaluronic acid': /hyaluron/i,
    'ceramides': /ceramide/i,
    'azelaic acid': /azeloyl|azelaic/i,
    'BHA (salicylic)': /salicylic|betaine salicylate/i,
    'AHA (glycolic/lactic)': /glycolic|lactic acid/i,
    'PHA (gluconolactone)': /gluconolactone|lactobionic/i,
    'retinol / retinal': /retinol|retinal|retinyl/i,
    'vitamin C': /ascorb/i,
    'tranexamic acid': /tranexamic/i,
    'tea tree': /melaleuca/i,
    'green tea': /camellia sinensis/i,
    'birch juice': /betula/i,
    'ferments / probiotics': /ferment|galactomyces|bifida|lactobacillus|saccharomyces/i,
    'collagen': /collagen/i,
    'exosomes': /exosome/i,
    'glutathione': /glutathione/i,
  }
  const withIngr = rows.filter((r) => r.ingredients)
  ih.ingredient_corpus = withIngr.length
  ih.ingredient_trends = Object.entries(FAMILIES).map(([fam, re]) => {
    const hits = withIngr.filter((r) => re.test(r.ingredients))
    const sold = hits.reduce((s, r) => s + (r.sold30 || 0), 0)
    const no1 = hits.filter((r) => r.rank === 1).length
    const topBrands = Object.entries(hits.reduce((m, r) => ((m[r.brand] = (m[r.brand] || 0) + 1), m), {}))
      .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([b]) => b)
    return { family: fam, skus: hits.length, sold_30d: sold, no1_ranks: no1, top_brands: topBrands }
  }).sort((a, b) => b.sold_30d - a.sold_30d)
}

// ---------------- routine-step basket analysis (clean iHerb corpus) --------
{
  const STEPS = [
    ['makeup remover / cleansing oil', /makeup remover|cleansing oil|cleansing balm/i],
    ['cleanser (foam/gel)', /face wash|cleanser/i],
    ['exfoliator / peel', /exfoliat|peeling|scrub/i],
    ['toner', /\btoner\b(?! pad)/i],
    ['toner pads', /toner pad/i],
    ['essence / serum / ampoule', /serum|essence|ampoule/i],
    ['eye care', /eye cream|eye mask/i],
    ['moisturizer / cream', /moisturizer|cream(?!y)|lotion/i],
    ['sunscreen', /sunscreen|sun care/i],
    ['sheet masks', /sheet mask|beauty face mask|face mask/i],
    ['pimple patches', /pimple patch|blemish patch/i],
    ['lip care / tint', /\blip\b/i],
    ['mist', /face mist|mist/i],
    ['hair & scalp', /hair|shampoo|scalp/i],
    ['body', /body/i],
    ['makeup (color)', /mascara|eyeliner|eyeshadow|blush|foundation|concealer|highlighter|eyebrow|lipstick|setting/i],
  ]
  const rows = iproducts.map((p) => {
    const f = latestFilled.get(p.id) || {}
    const meta = p.metadata || {}
    return {
      brand: p.brand_key, name: p.name, leaf: p.category_leaf || '',
      price: f.price ?? null, sold30: f.sold ?? null, rank: meta.rank_best?.rank ?? null,
    }
  })
  const stepOf = (r) => {
    const hay = `${r.leaf} ${r.name}`
    for (const [step, re] of STEPS) if (re.test(hay)) return step
    return 'other'
  }
  const byStep = new Map()
  for (const r of rows) {
    const s = stepOf(r)
    const b = byStep.get(s) || { skus: 0, sold30: 0, prices: [], under10: 0, no1: 0 }
    b.skus++; b.sold30 += r.sold30 || 0
    if (r.price != null) { b.prices.push(r.price); if (r.price < 10) b.under10++ }
    if (r.rank === 1) b.no1++
    byStep.set(s, b)
  }
  globalThis.__basket = [...byStep.entries()].map(([step, b]) => ({
    step, skus: b.skus, sold_30d: b.sold30, no1_ranks: b.no1, under_S$10: b.under10,
    p25: quantile(b.prices, 0.25), median: quantile(b.prices, 0.5), p75: quantile(b.prices, 0.75),
  })).sort((a, b) => b.sold_30d - a.sold_30d)

  // attach candidates: cheap, high-velocity items that ride along any basket
  globalThis.__attach = rows
    .filter((r) => r.price != null && r.price <= 12 && (r.sold30 || 0) >= 1000)
    .sort((a, b) => (b.sold30 || 0) - (a.sold30 || 0))
    .slice(0, 20)
    .map((r) => ({ brand: r.brand, name: (r.name || '').slice(0, 70), price: r.price, sold_30d: r.sold30 }))

  // line depth: brands with a hero (>=2000/30d) AND >=8 additional SKUs priced under the hero
  const byBrand = new Map()
  for (const r of rows) {
    const b = byBrand.get(r.brand) || []
    b.push(r); byBrand.set(r.brand, b)
  }
  globalThis.__linedepth = [...byBrand.entries()].map(([brand, list]) => {
    const hero = list.filter((r) => (r.sold30 || 0) >= 2000).sort((a, b) => b.sold30 - a.sold30)[0]
    if (!hero) return null
    const cheaper = list.filter((r) => r !== hero && r.price != null && r.price <= (hero.price ?? 99)).length
    const steps = new Set(list.map(stepOf))
    return { brand, hero: (hero.name || '').slice(0, 60), hero_price: hero.price, hero_sold_30d: hero.sold30, attachable_skus: cheaper, routine_steps_covered: steps.size }
  }).filter(Boolean).sort((a, b) => b.hero_sold_30d - a.hero_sold_30d).slice(0, 18)
}

// ---------------------------------------------------------------- overlap
const shopeeBrands = new Set(shopeeRows.map((r) => r.brand_key).filter(Boolean))
const iherbBrands = new Set(iproducts.map((r) => r.brand_key).filter(Boolean))
const overlap = [...iherbBrands].filter((b) => shopeeBrands.has(b))

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  shopee: sh,
  iherb: { ...ih, contaminated_rows_excluded: contamCount },
  basket: { steps: globalThis.__basket, attach_candidates: globalThis.__attach, line_depth: globalThis.__linedepth },
  overlap: { count: overlap.length, brands: overlap.sort() },
}, null, 1))
