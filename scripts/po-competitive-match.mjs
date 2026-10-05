#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shopeeListingUrl } from '../marketplace/shopee/urls.mjs'
import {
  buildMatchCatalog,
  matchPoLines,
  buildAliasIndex,
  matchStats,
  newestPricedObservation,
  parseCsv,
  parsePoRecords,
  renderMatchCsv,
  resolveBrandKey,
} from '../marketplace/poCompetitiveMatch.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

function loadDotEnv() {
  const path = resolve(ROOT, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match || process.env[match[1]] !== undefined) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
}

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      opts[key] = 'true'
      continue
    }
    opts[key] = next
    i++
  }
  return opts
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function loadPo(path) {
  const ext = extname(path).toLowerCase()
  if (ext === '.json') {
    const body = readJson(path)
    const records = Array.isArray(body) ? body : body.rows || body.products || []
    return parsePoRecords(records)
  }
  if (ext === '.csv' || ext === '.txt') return parseCsv(readFileSync(path, 'utf8'))
  if (ext === '.xlsx' || ext === '.xls') {
    const { readFile, utils } = await import('xlsx')
    const book = readFile(path)
    const sheet = book.Sheets[book.SheetNames[0]]
    return parsePoRecords(utils.sheet_to_json(sheet, { defval: '' }))
  }
  throw new Error(`Unsupported PO file ${ext || path}`)
}

function loadJsonCatalog(path) {
  if (!path) return null
  const body = readJson(path)
  return Array.isArray(body) ? body : body.rows || []
}

async function pageAll(build) {
  const out = []
  const size = 1000
  for (let offset = 0; ; offset += size) {
    const { data, error } = await build().range(offset, offset + size - 1)
    if (error) throw new Error(error.message)
    const rows = data || []
    out.push(...rows)
    if (rows.length < size) break
  }
  return out
}

async function fetchSnapshots(db, workspaceId, table, idField, ids, select, orderField) {
  const snaps = []

  async function pull(chunk) {
    if (!chunk.length) return
    const { data, error } = await db
      .from(table)
      .select(select)
      .eq('workspace_id', workspaceId)
      .in(idField, chunk)
      .order(orderField, { ascending: false })
      .limit(1000)
    if (error) throw new Error(error.message)
    const rows = data || []
    if (rows.length >= 1000 && chunk.length > 1) {
      const mid = Math.ceil(chunk.length / 2)
      await pull(chunk.slice(0, mid))
      await pull(chunk.slice(mid))
      return
    }
    snaps.push(...rows)
  }

  for (let i = 0; i < ids.length; i += 20) await pull(ids.slice(i, i + 20))
  return snaps
}

async function loadFromDatabase(workspaceId, lines) {
  const url = process.env.SUPABASE_URL || process.env.NUXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --iherb and --shopee')
  const { createClient } = await import('@supabase/supabase-js')
  const db = createClient(url, key, { auth: { persistSession: false } })

  const brandRows = await pageAll(() => db
    .from('marketplace_brand_universe')
    .select('brand_key, display_name, metadata')
    .eq('workspace_id', workspaceId)
    .eq('enabled', true))
  const brands = brandRows.map((row) => {
    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
    return {
      brand_key: row.brand_key,
      display_name: row.display_name,
      aliases: Array.isArray(meta.aliases) ? meta.aliases : [],
    }
  })

  const products = await pageAll(() => db
    .from('iherb_products')
    .select('id, gtin, url')
    .eq('workspace_id', workspaceId)
    .not('gtin', 'is', null))
  const iherbSnaps = await fetchSnapshots(
    db,
    workspaceId,
    'iherb_product_snapshots',
    'product_row_id',
    products.map((row) => row.id),
    'product_row_id, captured_at, price, currency',
    'captured_at',
  )
  const iherbPrice = newestPricedObservation(iherbSnaps, 'product_row_id')
  const iherb = products.map((product) => {
    const snap = iherbPrice.get(product.id) || {}
    return {
      gtin: product.gtin,
      url: product.url,
      price: snap.price ?? null,
      currency: snap.currency ?? null,
      captured_at: snap.captured_at ?? null,
    }
  })

  const aliasToBrandKey = buildAliasIndex(brands)
  const brandKeys = [...new Set(
    (lines || []).map((line) => resolveBrandKey(line.brand, aliasToBrandKey)).filter(Boolean),
  )]
  const listings = []
  for (let i = 0; i < brandKeys.length; i += 40) {
    const chunk = brandKeys.slice(i, i + 40)
    const page = await pageAll(() => db
      .from('v_marketplace_listing_latest')
      .select(`
        listing_id,
        crawled_at,
        price,
        currency,
        seller_type,
        brand_key,
        marketplace_listings ( title, listing_url, shop_id, item_id, seller_type )
      `)
      .eq('workspace_id', workspaceId)
      .in('brand_key', chunk))
    listings.push(...page)
  }

  const shopeeBase = listings.map((snap) => {
    const listing = snap.marketplace_listings || {}
    const shopId = listing.shop_id || ''
    const itemId = listing.item_id || ''
    return {
      listing_id: snap.listing_id,
      brand_key: snap.brand_key,
      title: listing.title || '',
      seller_type: snap.seller_type || listing.seller_type || '',
      price: snap.price,
      currency: snap.currency,
      crawled_at: snap.crawled_at,
      listing_url: listing.listing_url || (shopId && itemId ? shopeeListingUrl(shopId, itemId) : ''),
    }
  })

  const priced = await fetchSnapshots(
    db,
    workspaceId,
    'marketplace_listing_snapshots',
    'listing_id',
    shopeeBase.map((row) => row.listing_id).filter(Boolean),
    'listing_id, crawled_at, price, price_sgd, currency',
    'crawled_at',
  )
  const shopeePrice = newestPricedObservation(
    priced.map((snap) => ({ ...snap, captured_at: snap.crawled_at })),
    'listing_id',
  )
  const shopee = shopeeBase.map((row) => {
    const snap = shopeePrice.get(row.listing_id)
    if (!snap) return row
    return {
      ...row,
      price: snap.price ?? row.price,
      price_sgd: snap.price_sgd ?? null,
      currency: snap.currency || row.currency,
      crawled_at: snap.crawled_at || row.crawled_at,
    }
  })

  return { iherb, shopee, brands }
}

function usage() {
  return [
    'Usage: node scripts/po-competitive-match.mjs --po <file.csv|json|xlsx> --out <file.csv>',
    '       [--iherb <json> --shopee <json> [--brands <json>]]',
    '       [--workspace <uuid>]',
    'Offline JSON skips the database. Database mode is a read of iHerb and Shopee Mall.',
  ].join('\n')
}

async function main() {
  loadDotEnv()
  const args = parseArgs(process.argv.slice(2))
  if (!args.po || !args.out) {
    console.error(usage())
    process.exit(2)
  }

  const lines = await loadPo(resolve(args.po))
  const offline = Boolean(args.iherb || args.shopee)
  let catalogInput
  if (offline) {
    catalogInput = {
      iherb: loadJsonCatalog(args.iherb) || [],
      shopee: loadJsonCatalog(args.shopee) || [],
      brands: args.brands ? loadJsonCatalog(args.brands) : null,
    }
  } else {
    const workspaceId = args.workspace
      || process.env.MARKETPLACE_WORKSPACE_ID
      || process.env.FRAN_MCP_WORKSPACE_ID
    if (!workspaceId) throw new Error('Pass --workspace or set MARKETPLACE_WORKSPACE_ID')
    catalogInput = await loadFromDatabase(workspaceId, lines)
  }

  const catalog = buildMatchCatalog(catalogInput)
  const rows = matchPoLines(lines, catalog)
  const csv = renderMatchCsv(rows)
  const out = resolve(args.out)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, csv)

  const stats = matchStats(rows)
  const unresolved = new Set()
  if (catalogInput.brands) {
    for (const line of lines) {
      if (!resolveBrandKey(line.brand, catalog.aliasToBrandKey)) unresolved.add(line.brand)
    }
  }
  const statsBody = {
    ...stats,
    unresolved_brands: [...unresolved].filter(Boolean).sort(),
  }
  const statsPath = resolve(dirname(out), 'match-stats.json')
  writeFileSync(statsPath, `${JSON.stringify(statsBody, null, 2)}\n`)

  console.log(
    `rows=${stats.rows} iherb=${stats.iherb} (${stats.iherb_pct}%) shopee=${stats.shopee} (${stats.shopee_pct}%) none=${stats.none} (${stats.none_pct}%) shopee_overlap_ge_0.7=${stats.shopee_high}`,
  )
  console.log(out)
  console.log(statsPath)
}

main().catch((error) => {
  console.error(error?.message || error)
  process.exit(1)
})
