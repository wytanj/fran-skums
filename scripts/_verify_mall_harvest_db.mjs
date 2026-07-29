#!/usr/bin/env node
/**
 * Read-only: verify Mall harvest brand data landed in Supabase.
 * Compares .mall-cycle-state.json list_products vs DB listing/snapshot counts.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv() {
  const p = resolve('.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m || process.env[m[1]] !== undefined) continue
    let v = m[2].trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    process.env[m[1]] = v
  }
}

loadEnv()

const WS = process.argv[2] || 'c21c057f-ea01-4e19-bc79-fafcf2626b19'
const url = process.env.SUPABASE_URL || process.env.NUXT_PUBLIC_SUPABASE_URL
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY

if (!url || !key) {
  console.error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })

const BRANDS = [
  // post-resume focus
  'benton',
  'beplain',
  'bouquet-garni',
  'celimax',
  // A-brands list-ok before
  'amuse',
  'anua',
  'april-skin',
  'arencia',
  'axis-y',
  'beauty-of-joseon',
  'banila-co',
  'biodance',
  'cosrx',
  '3ce',
  // extra recent from state
  'centellian24',
  'chill-lab',
  'cnp-laboratory',
  'dalba',
]

let state = { brands: {} }
const statePath = resolve('.mall-cycle-state.json')
if (existsSync(statePath)) {
  state = JSON.parse(readFileSync(statePath, 'utf8'))
}

async function countSnaps(brandKey) {
  // exact count via head
  const { count, error } = await db
    .from('marketplace_listing_snapshots')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', WS)
    .contains('signals', { brand_key: brandKey })
  return { count: count ?? 0, error: error?.message || null }
}

async function fetchSnapsSample(brandKey, limit = 800) {
  const { data, error } = await db
    .from('marketplace_listing_snapshots')
    .select(
      `
      id,
      listing_id,
      crawled_at,
      price,
      currency,
      rating,
      review_count,
      sold_label,
      sold_count_lower_bound,
      signals,
      marketplace_listings (
        id,
        title,
        shop_name,
        shop_id,
        item_id,
        listing_url,
        metadata,
        last_seen_at
      )
    `,
    )
    .eq('workspace_id', WS)
    .contains('signals', { brand_key: brandKey })
    .order('crawled_at', { ascending: false })
    .limit(limit)
  return { data: data || [], error: error?.message || null }
}

async function brandUniverse(brandKey) {
  const { data, error } = await db
    .from('marketplace_brand_universe')
    .select('brand_key,display_name,shop_username,shop_id,shop_url,shop_resolve_status,updated_at')
    .eq('workspace_id', WS)
    .eq('brand_key', brandKey)
    .maybeSingle()
  return { data, error: error?.message || null }
}

// Also try listing metadata brand_key if used
async function countListingsByMetadata(brandKey) {
  const { count, error } = await db
    .from('marketplace_listings')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', WS)
    .contains('metadata', { brand_key: brandKey })
  return { count: count ?? 0, error: error?.message || null }
}

const rows = []
const errors = []

console.log(`Workspace: ${WS}`)
console.log(`State updated_at: ${state.updated_at || '?'}`)
console.log(`Querying ${BRANDS.length} brands...\n`)

for (const brand_key of BRANDS) {
  const st = state.brands?.[brand_key] || {}
  const [snapCountRes, sampleRes, uniRes, metaListRes] = await Promise.all([
    countSnaps(brand_key),
    fetchSnapsSample(brand_key, 1000),
    brandUniverse(brand_key),
    countListingsByMetadata(brand_key),
  ])

  if (snapCountRes.error) errors.push(`${brand_key} snapCount: ${snapCountRes.error}`)
  if (sampleRes.error) errors.push(`${brand_key} sample: ${sampleRes.error}`)
  if (uniRes.error) errors.push(`${brand_key} universe: ${uniRes.error}`)
  if (metaListRes.error) errors.push(`${brand_key} metaList: ${metaListRes.error}`)

  const snaps = sampleRes.data
  const listingIds = new Set(snaps.map((s) => s.listing_id).filter(Boolean))
  const latest = snaps[0]?.crawled_at || null
  const oldestInSample = snaps.length ? snaps[snaps.length - 1]?.crawled_at : null

  // field presence on latest 20
  const sampleN = snaps.slice(0, 20)
  const fields = {
    title: sampleN.filter((s) => s.marketplace_listings?.title).length,
    sold_label: sampleN.filter((s) => s.sold_label).length,
    shop_collection: sampleN.filter(
      (s) => s.signals?.shop_collection_name || s.signals?.category,
    ).length,
    platform_category: sampleN.filter(
      (s) =>
        s.signals?.platform_category_path_text ||
        s.signals?.platform_category_leaf ||
        (Array.isArray(s.signals?.platform_category_path) &&
          s.signals.platform_category_path.length),
    ).length,
    price: sampleN.filter((s) => s.price != null).length,
    rating: sampleN.filter((s) => s.rating != null).length,
  }

  const shopFromSignals = [
    ...new Set(snaps.map((s) => s.signals?.shop_username).filter(Boolean)),
  ]
  const shelves = {}
  for (const s of snaps) {
    const sh = s.signals?.shop_collection_name || s.signals?.category
    if (sh) shelves[sh] = (shelves[sh] || 0) + 1
  }

  const sampleTitles = snaps.slice(0, 3).map((s) => ({
    title: (s.marketplace_listings?.title || s.signals?.name || '').slice(0, 70),
    sold: s.sold_label,
    price: s.price,
    rating: s.rating,
    shelf: s.signals?.shop_collection_name || s.signals?.category || null,
    platform: s.signals?.platform_category_leaf || null,
    crawled_at: s.crawled_at,
  }))

  const row = {
    brand_key,
    list_ok_state: st.list_ok ?? null,
    list_error: st.list_error ?? null,
    state_products: st.list_products ?? null,
    state_list_at: st.list_at ?? null,
    shop_username_state: st.shop_username ?? null,
    shop_username_db: uniRes.data?.shop_username ?? null,
    shop_id_db: uniRes.data?.shop_id ?? null,
    db_snaps_total: snapCountRes.count,
    db_snaps_sampled: snaps.length,
    db_listings_unique: listingIds.size,
    db_listings_meta: metaListRes.count,
    latest_crawl: latest,
    oldest_in_sample: oldestInSample,
    fields_in_sample20: fields,
    shops_in_signals: shopFromSignals,
    shelf_top: Object.entries(shelves)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6),
    sample: sampleTitles,
    mh4_ok: st.mh4_ok ?? null,
    mh4_count: st.mh4_count ?? null,
    delta_state_vs_db:
      st.list_products != null ? listingIds.size - Number(st.list_products) : null,
  }
  rows.push(row)

  console.log(
    [
      brand_key.padEnd(20),
      `list_ok=${String(st.list_ok)}`.padEnd(14),
      `state=${String(st.list_products ?? '-')}`.padEnd(12),
      `db_list=${listingIds.size}`.padEnd(12),
      `db_snap=${snapCountRes.count}`.padEnd(12),
      `latest=${latest ? latest.slice(0, 19) : '-'}`,
      `shop=${st.shop_username || uniRes.data?.shop_username || '-'}`,
    ].join(' '),
  )
}

console.log('\n========== DETAILED JSON ==========')
console.log(JSON.stringify({ workspace_id: WS, brands: rows, errors }, null, 2))

// Summary verdicts
console.log('\n========== VERDICTS ==========')
const focus = ['benton', 'beplain', 'bouquet-garni', 'celimax']
for (const k of focus) {
  const r = rows.find((x) => x.brand_key === k)
  const landed = r && r.db_listings_unique > 0
  console.log(
    `${k}: ${landed ? 'YES' : 'NO'} landed — listings=${r?.db_listings_unique} snaps=${r?.db_snaps_total} state=${r?.state_products} delta=${r?.delta_state_vs_db}`,
  )
}

const amuse = rows.find((x) => x.brand_key === 'amuse')
console.log('\n--- AMUSE ---')
console.log(
  JSON.stringify(
    {
      list_ok: amuse?.list_ok_state,
      list_error: amuse?.list_error,
      state_products: amuse?.state_products,
      state_list_at: amuse?.state_list_at,
      db_listings: amuse?.db_listings_unique,
      db_snaps: amuse?.db_snaps_total,
      latest_crawl: amuse?.latest_crawl,
      shop_username_state: amuse?.shop_username_state,
      shop_username_db: amuse?.shop_username_db,
      shop_id_db: amuse?.shop_id_db,
      fields: amuse?.fields_in_sample20,
      sample: amuse?.sample,
      shelves: amuse?.shelf_top,
      assessment:
        amuse?.db_listings_unique >= 50
          ? 'ALREADY_DONE_GOOD_DATA'
          : amuse?.db_listings_unique > 0
            ? 'PARTIAL_DATA'
            : 'EMPTY_WILL_SCRAPE_FROM_ZERO',
    },
    null,
    2,
  ),
)
