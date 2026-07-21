#!/usr/bin/env node
/**
 * Inspect recent extension / Mall harvest data for a workspace.
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
const ws = process.argv[2] || 'c21c057f-ea01-4e19-bc79-fafcf2626b19'
const url = process.env.SUPABASE_URL || process.env.NUXT_PUBLIC_SUPABASE_URL
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY
if (!url || !key) {
  console.error('Need SUPABASE_URL + SERVICE_ROLE_KEY')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

function sinceHours(h) {
  return new Date(Date.now() - h * 3600 * 1000).toISOString()
}

// 1) Brands with shop
const { data: brands, error: bErr } = await db
  .from('marketplace_brand_universe')
  .select(
    'brand_key,display_name,shop_username,shop_url,shop_id,shop_resolve_status,shop_resolve_source,shop_resolve_evidence,updated_at,metadata',
  )
  .eq('workspace_id', ws)
  .not('shop_username', 'is', null)
  .order('updated_at', { ascending: false })
  .limit(80)

console.log('\n=== 1. BRANDS WITH shop_username (by updated_at) ===')
if (bErr) console.log('error', bErr.message)
else {
  const rows = brands || []
  console.log(`total with shop (sample up to 80): ${rows.length}`)
  for (const b of rows) {
    const via =
      b.shop_resolve_evidence?.via ||
      b.shop_resolve_evidence?.source ||
      b.shop_resolve_source ||
      '?'
    const coll = Array.isArray(b.metadata?.shop_collections)
      ? b.metadata.shop_collections.filter((c) => !c.is_all_products).length
      : 0
    console.log(
      [
        (b.updated_at || '').slice(0, 19),
        b.brand_key,
        `@${b.shop_username}`,
        b.shop_resolve_status || '?',
        via,
        `shelves=${coll}`,
      ].join(' | '),
    )
  }
  const extLinked = rows.filter((b) =>
    String(b.shop_resolve_evidence?.via || '').includes('chrome_extension'),
  )
  console.log(`\nchrome_extension evidence: ${extLinked.length}`)
  for (const b of extLinked.slice(0, 30)) {
    console.log(
      `  ${b.brand_key} → @${b.shop_username} via ${b.shop_resolve_evidence?.via} @ ${b.updated_at?.slice(0, 19)}`,
    )
  }
}

// 2) Recent snapshots (48h) — sold lives on snapshots
const since = sinceHours(48)
const { data: snaps, error: sErr } = await db
  .from('marketplace_listing_snapshots')
  .select(
    'id,listing_id,crawled_at,sold_label,sold_count_lower_bound,search_query,signals,price,rank_position,seller_type',
  )
  .eq('workspace_id', ws)
  .gte('crawled_at', since)
  .order('crawled_at', { ascending: false })
  .limit(500)

console.log(`\n=== 2. LISTING SNAPSHOTS since ${since.slice(0, 19)} (max 500) ===`)
if (sErr) console.log('error', sErr.message)
else {
  const rows = snaps || []
  console.log(`count: ${rows.length}`)
  const byBrand = {}
  const bySource = {}
  const byCat = {}
  const withSold = rows.filter((s) => s.sold_label).length
  for (const s of rows) {
    const bk = s.signals?.brand_key || s.signals?.shop_username || '(none)'
    byBrand[bk] = (byBrand[bk] || 0) + 1
    const src =
      s.signals?.harvest_source ||
      s.signals?.via ||
      (s.search_query?.includes('shop:') ? 'shop_query' : null) ||
      '(none)'
    bySource[src] = (bySource[src] || 0) + 1
    const cat = s.signals?.shop_collection_name || s.signals?.category || '(none)'
    byCat[cat] = (byCat[cat] || 0) + 1
  }
  console.log('by brand_key/shop:', byBrand)
  console.log('by harvest_source/signals:', bySource)
  console.log('by category/shelf:', byCat)
  console.log(`with sold_label: ${withSold} / ${rows.length}`)
  console.log('\n— sample (newest 30) —')
  for (const s of rows.slice(0, 30)) {
    const title =
      s.signals?.title ||
      s.raw_observation?.name ||
      s.search_query ||
      ''
    console.log(
      [
        (s.crawled_at || '').slice(0, 19),
        s.signals?.brand_key || '-',
        s.signals?.shop_username || '-',
        s.signals?.category || s.signals?.shop_collection_name || '-',
        s.sold_label || '—',
        s.sold_count_lower_bound ?? '',
        String(title).slice(0, 55),
      ].join(' | '),
    )
  }
}

// 3) Listings last_seen recently (title on listing; sold on latest snapshot)
const { data: listings, error: lErr } = await db
  .from('marketplace_listings')
  .select(
    'id,item_id,shop_id,title,seller_type,shop_name,last_seen_at,listing_url,raw_identity',
  )
  .eq('workspace_id', ws)
  .gte('last_seen_at', since)
  .order('last_seen_at', { ascending: false })
  .limit(500)

console.log(`\n=== 3. LISTINGS last_seen since ${since.slice(0, 19)} (max 500) ===`)
if (lErr) console.log('error', lErr.message)
else {
  const rows = listings || []
  console.log(`count: ${rows.length}`)
  const byShop = {}
  for (const l of rows) {
    const k = l.shop_name || l.shop_id || '(none)'
    byShop[k] = (byShop[k] || 0) + 1
  }
  console.log('by shop_name/shop_id:', byShop)
  console.log('\n— sample (newest 30) —')
  for (const l of rows.slice(0, 30)) {
    console.log(
      [
        (l.last_seen_at || '').slice(0, 19),
        l.shop_id,
        l.seller_type || '-',
        l.shop_name || '-',
        String(l.title || '').slice(0, 55),
      ].join(' | '),
    )
  }
}

// 4) Shops table
const { data: shops, error: shErr } = await db
  .from('marketplace_shops')
  .select('shop_id,shop_name,seller_type,last_seen_at,country')
  .eq('workspace_id', ws)
  .order('last_seen_at', { ascending: false })
  .limit(40)
console.log('\n=== 4. MARKETPLACE_SHOPS (recent) ===')
if (shErr) console.log('error', shErr.message)
else {
  for (const s of shops || []) {
    console.log(
      [
        (s.last_seen_at || '').slice(0, 19),
        s.shop_name || '-',
        s.seller_type || '-',
        s.shop_id,
      ].join(' | '),
    )
  }
}

// 5) Join: latest snapshots with listing titles for extension harvests
const { data: joined, error: jErr } = await db
  .from('marketplace_listing_snapshots')
  .select(
    `id,crawled_at,sold_label,sold_count_lower_bound,search_query,signals,rank_position,
     listing:marketplace_listings(id,title,shop_id,item_id,shop_name,seller_type,listing_url,last_seen_at)`,
  )
  .eq('workspace_id', ws)
  .gte('crawled_at', since)
  .order('crawled_at', { ascending: false })
  .limit(100)

console.log('\n=== 5. SNAPSHOTS + LISTING TITLES (newest 40) ===')
if (jErr) console.log('error', jErr.message)
else {
  for (const s of (joined || []).slice(0, 40)) {
    const L = s.listing || {}
    console.log(
      [
        (s.crawled_at || '').slice(0, 19),
        s.signals?.brand_key || '-',
        s.signals?.shop_username || L.shop_name || '-',
        s.signals?.category || s.signals?.shop_collection_name || '-',
        s.sold_label || '—',
        String(L.title || s.signals?.name || '').slice(0, 50),
      ].join(' | '),
    )
  }
}

// 6) Full evidence dump for brands updated today
console.log('\n=== 6. BRAND RESOLVE EVIDENCE (JSON) ===')
for (const b of brands || []) {
  if (!b.updated_at || b.updated_at < sinceHours(72)) continue
  console.log(
    JSON.stringify(
      {
        brand_key: b.brand_key,
        shop_username: b.shop_username,
        shop_id: b.shop_id,
        shop_resolve_status: b.shop_resolve_status,
        shop_resolve_source: b.shop_resolve_source,
        shop_resolve_evidence: b.shop_resolve_evidence,
        collections: (b.metadata?.shop_collections || []).map((c) => ({
          name: c.name,
          id: c.shop_collection_id,
        })),
        updated_at: b.updated_at,
      },
      null,
      2,
    ),
  )
}

console.log('\nDone.')
