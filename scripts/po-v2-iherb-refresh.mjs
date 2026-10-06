#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildMatchCatalog,
  dateSeen,
  findIherbHit,
  iherbRefreshPlan,
  parseCsvObjects,
  priceSgd,
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

function usage() {
  return [
    'Usage: node scripts/po-v2-iherb-refresh.mjs --po <pr1.csv> --out <iherb-refresh.json>',
    '       [--iherb <products.json>] [--workspace <uuid>] [--live]',
    'Reads iherb_products and the latest iherb_product_snapshots. Default is read-only.',
    '--live re-fetches a blank price from the iHerb PDP in the connected Chrome. Default off.',
    'Offline --iherb skips Supabase.',
  ].join('\n')
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

async function fetchSnapshots(db, workspaceId, ids) {
  const snaps = []

  async function pull(chunk) {
    if (!chunk.length) return
    const { data, error } = await db
      .from('iherb_product_snapshots')
      .select('product_row_id, captured_at, price, currency')
      .eq('workspace_id', workspaceId)
      .in('product_row_id', chunk)
      .order('captured_at', { ascending: false })
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

async function loadIherbFromDatabase(workspaceId) {
  const url = process.env.SUPABASE_URL || process.env.NUXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --iherb')
  const { createClient } = await import('@supabase/supabase-js')
  const { newestPricedObservation } = await import('../marketplace/poCompetitiveMatch.mjs')
  const db = createClient(url, key, { auth: { persistSession: false } })
  const products = await pageAll(() => db
    .from('iherb_products')
    .select('id, gtin, url')
    .eq('workspace_id', workspaceId)
    .not('gtin', 'is', null))
  const snaps = await fetchSnapshots(db, workspaceId, products.map((row) => row.id))
  const priced = newestPricedObservation(snaps, 'product_row_id')
  return products.map((product) => {
    const snap = priced.get(product.id) || {}
    return {
      gtin: product.gtin,
      url: product.url,
      price: snap.price ?? null,
      currency: snap.currency ?? null,
      captured_at: snap.captured_at ?? null,
    }
  })
}

function hitFrom(line, product) {
  return {
    barcode: line.barcode,
    brand: line.brand,
    product_name: line.product_name,
    price_sgd: priceSgd(product),
    url: String(product.url || product.listing_url || ''),
    seen_at: dateSeen(product.captured_at || product.date_seen || product.seen_at),
    confidence: 1,
    priority: line.priority,
  }
}

async function fillLivePrices(hits) {
  const pending = hits.filter((hit) => hit.url && !hit.price_sgd)
  if (!pending.length) return hits
  const { connectComputerBrowser } = await import('../marketplace/computerHarvest.mjs')
  const { openAndParseIherbPdp } = await import('../marketplace/iherb/pdpEnrich.mjs')
  const { browser } = await connectComputerBrowser(process.env.SHOPEE_CDP_URL || 'http://127.0.0.1:9222')
  try {
    const pages = await browser.pages()
    const page = pages[0] || await browser.newPage()
    for (const hit of pending) {
      const result = await openAndParseIherbPdp(page, hit.url, { label: hit.barcode })
      if (result.health === 'blocked' || result.health === 'login_required') {
        throw new Error(`iHerb PDP ${result.health} at ${hit.url}. Clear it in Chrome and rerun.`)
      }
      const pdp = result.pdp || {}
      if (!pdp.found) continue
      const refreshed = hitFrom(hit, {
        url: result.url || hit.url,
        price: pdp.price,
        currency: pdp.currency,
        captured_at: pdp.captured_at || new Date().toISOString(),
      })
      hit.price_sgd = refreshed.price_sgd
      hit.url = refreshed.url || hit.url
      hit.seen_at = refreshed.seen_at || hit.seen_at
    }
  } finally {
    await browser.disconnect()
  }
  return hits
}

async function main() {
  loadDotEnv()
  const args = parseArgs(process.argv.slice(2))
  if (!args.po || !args.out) {
    console.error(usage())
    process.exit(2)
  }

  const sheet = parseCsvObjects(readFileSync(resolve(args.po), 'utf8'))
  const plan = iherbRefreshPlan(sheet)
  let products
  if (args.iherb) {
    const body = JSON.parse(readFileSync(resolve(args.iherb), 'utf8'))
    products = Array.isArray(body) ? body : body.rows || body.products || []
  } else {
    const workspaceId = args.workspace
      || process.env.MARKETPLACE_WORKSPACE_ID
      || process.env.FRAN_MCP_WORKSPACE_ID
    if (!workspaceId) throw new Error('Pass --workspace or set MARKETPLACE_WORKSPACE_ID')
    products = await loadIherbFromDatabase(workspaceId)
  }

  const catalog = buildMatchCatalog({ iherb: products, shopee: [], brands: null })
  const hits = []
  for (const line of plan.queue) {
    const product = findIherbHit(line, catalog)
    if (product) hits.push(hitFrom(line, product))
  }

  if (args.live === 'true') await fillLivePrices(hits)

  const body = {
    generated_at: new Date().toISOString(),
    read_only: true,
    live: args.live === 'true',
    queue_counts: {
      empty_price: plan.empty_price.length,
      none: plan.none.length,
    },
    hits,
  }
  const out = resolve(args.out)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`)
  const priced = hits.filter((hit) => hit.price_sgd).length
  console.log(
    `queue_empty_price=${plan.empty_price.length} queue_none=${plan.none.length} hits=${hits.length} priced=${priced}`,
  )
  console.log(out)
}

main().catch((error) => {
  console.error(error?.message || error)
  process.exit(1)
})
