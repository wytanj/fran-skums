#!/usr/bin/env node
/**
 * Harvest iHerb K-Beauty via brand facet `bids=` codes.
 *
 * Discovers brands from the sidebar filter on /c/k-beauty, then paginates
 * each brand with ?bids=CODE (preserving bids across pages).
 *
 * Usage:
 *   node scripts/iherb-kbeauty-cycle.mjs -w <uuid> --connect --discover-only
 *   node scripts/iherb-kbeauty-cycle.mjs -w <uuid> --connect --bids CRX,SIO --dry-run
 *   node scripts/iherb-kbeauty-cycle.mjs -w <uuid> --connect --all --max-brands 10
 *   node scripts/iherb-kbeauty-cycle.mjs -w <uuid> --connect --min-count 20
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectComputerBrowser } from '../marketplace/computerHarvest.mjs'
import { createHarvestNotifier, nullNotifier } from '../marketplace/harvestNotify.mjs'
import {
  discoverKBeautyBrands,
  harvestKBeautyByBids,
  resetIherbNavCount,
} from '../marketplace/iherb/harvestWorker.mjs'
import { brandKeyFromDisplayName } from '../marketplace/brandKey.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

function loadDotEnv() {
  const p = resolve(ROOT, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m || process.env[m[1]] !== undefined) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    process.env[m[1]] = v
  }
}

function parseArgs(argv) {
  const opts = {
    workspace: process.env.MARKETPLACE_WORKSPACE_ID || process.env.FRAN_MCP_WORKSPACE_ID || null,
    connect: process.env.SHOPEE_CDP_URL || process.env.IHERB_CDP_URL || null,
    bids: null,
    all: false,
    discoverOnly: false,
    maxBrands: 200,
    minCount: 0,
    maxPages: 40,
    delayMs: 3500,
    brandGapMs: 6000,
    dryRun: false,
    notify: true,
    maxConsecutiveBlocked: 3,
    recoveryMinutes: 10,
    saveDiscover: resolve(ROOT, '.iherb-kbeauty-brands.json'),
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-w' || a === '--workspace') opts.workspace = argv[++i]
    else if (a === '--connect') {
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) opts.connect = argv[++i]
      else opts.connect = opts.connect || 'http://127.0.0.1:9222'
    } else if (a === '--bids') {
      opts.bids = String(argv[++i] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (a === '--all') opts.all = true
    else if (a === '--discover-only') opts.discoverOnly = true
    else if (a === '--max-brands') opts.maxBrands = Number(argv[++i]) || 200
    else if (a === '--min-count') opts.minCount = Number(argv[++i]) || 0
    else if (a === '--max-pages') opts.maxPages = Number(argv[++i]) || 40
    else if (a === '--delay-ms') opts.delayMs = Number(argv[++i]) || 3500
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--no-notify') opts.notify = false
    else if (a === '--recovery-minutes') opts.recoveryMinutes = Number(argv[++i]) || 10
    else if (a === '--save-discover') opts.saveDiscover = argv[++i]
    else if (a === '--help' || a === '-h') {
      console.log(`iHerb K-Beauty harvest (bids= brand filter)

Usage:
  node scripts/iherb-kbeauty-cycle.mjs -w <uuid> --connect --discover-only
  node scripts/iherb-kbeauty-cycle.mjs -w <uuid> --connect --bids CRX,SIO,AUU
  node scripts/iherb-kbeauty-cycle.mjs -w <uuid> --connect --all --max-brands 15 --dry-run

Options:
  --discover-only   Scrape Brands facet only; write .iherb-kbeauty-brands.json
  --bids CRX,SIO    Harvest these brand codes (from facet data-id)
  --all             Discover then harvest every brand (respect --max-brands / --min-count)
  --min-count N     Skip brands with facet count < N
  --max-brands N    Cap brands when using --all (default 200)
  --max-pages N     Pages per brand (default 40)
  --dry-run         Parse only, no DB write
  --connect [url]   CDP (default http://127.0.0.1:9222)
`)
      process.exit(0)
    }
  }
  return opts
}

async function main() {
  loadDotEnv()
  const opts = parseArgs(process.argv.slice(2))

  if (!opts.workspace) {
    console.error('Need -w <workspace_id>')
    process.exit(1)
  }
  if (!opts.connect) {
    console.error('Need --connect')
    process.exit(1)
  }
  if (!opts.discoverOnly && !opts.bids?.length && !opts.all) {
    console.error('Need --discover-only, --bids CRX,SIO, or --all')
    process.exit(1)
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_KEY
  if (!opts.discoverOnly && !opts.dryRun && (!url || !key)) {
    console.error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for writes')
    process.exit(1)
  }

  const db = url && key
    ? createClient(url, key, { auth: { persistSession: false } })
    : null

  const notifier = opts.notify
    ? createHarvestNotifier({ workspaceId: opts.workspace, runId: `iherb-kb-${Date.now()}` })
    : nullNotifier()

  const { browser } = await connectComputerBrowser(opts.connect)
  resetIherbNavCount()
  let page = (await browser.pages())[0] || (await browser.newPage())
  try {
    page = await browser.newPage()
  } catch { /* reuse */ }

  const summary = { discover: null, brands: [] }
  let consecutiveBlocked = 0

  try {
    let queue = []

    if (opts.bids?.length) {
      queue = opts.bids.map((code) => ({
        code,
        name: null,
        count: null,
        brand_key: null,
        url: null,
      }))
    } else {
      const disc = await discoverKBeautyBrands(page)
      summary.discover = {
        brand_count: disc.brands.length,
        listCount: disc.listCount,
        hub_result_count: disc.resultCount,
      }
      if (opts.saveDiscover) {
        writeFileSync(
          opts.saveDiscover,
          JSON.stringify({ captured_at: new Date().toISOString(), ...disc }, null, 2),
        )
        console.error(`[iherb-kbeauty] saved ${opts.saveDiscover}`)
      }
      if (opts.discoverOnly) {
        console.log(JSON.stringify({ ok: true, ...summary }, null, 2))
        return
      }
      queue = disc.brands
        .filter((b) => (b.count == null || b.count >= opts.minCount))
        .slice(0, opts.maxBrands)
    }

    console.error(`[iherb-kbeauty] harvest queue=${queue.length} dry_run=${opts.dryRun}`)

    for (let i = 0; i < queue.length; i++) {
      const b = queue[i]
      const brand_key = b.brand_key || (b.name ? brandKeyFromDisplayName(b.name) : null)
      console.error(`\n[iherb-kbeauty] (${i + 1}/${queue.length}) ${b.code} ${b.name || ''} count=${b.count ?? '?'}`)

      try {
        const result = await harvestKBeautyByBids(page, {
          workspace_id: opts.workspace,
          codes: [b.code],
          brand_name: b.name || undefined,
          brand_key: brand_key || undefined,
          db,
          dry_run: opts.dryRun,
          max_pages: opts.maxPages,
          delay_ms: opts.delayMs,
          recoveryDeadlineMs: opts.recoveryMinutes * 60 * 1000,
          onBlocked: async (info) => {
            console.error(`[iherb-kbeauty] blocked: ${info?.label || b.code}`)
          },
          onResolved: async (info) => {
            if (info?.recovered) {
              await notifier.recovered({
                brand_key: brand_key || b.code,
                marketplace: 'iherb',
                waited_ms: info.waitedMs,
              })
            }
          },
        })

        if (result.sustained_blocked) {
          consecutiveBlocked += 1
          await notifier.blocked({
            brand_key: brand_key || b.code,
            marketplace: 'iherb',
            reason: result.stop_reason,
            consecutive: consecutiveBlocked,
          })
          if (consecutiveBlocked >= opts.maxConsecutiveBlocked) {
            console.error(`[iherb-kbeauty] exit 2: ${consecutiveBlocked} consecutive blocks`)
            summary.brands.push({ code: b.code, error: result.stop_reason })
            console.log(JSON.stringify({ ok: false, exit: 2, summary }, null, 2))
            process.exit(2)
          }
        } else {
          consecutiveBlocked = 0
        }

        summary.brands.push({
          code: b.code,
          name: b.name,
          brand_key,
          facet_count: b.count,
          products: result.product_count,
          pages: result.pages_fetched,
          with_sold: result.coverage?.with_sold,
          written: result.writes?.map((w) => ({
            brand_key: w.brand_key,
            products: w.products_upserted,
          })),
          stop_reason: result.stop_reason,
        })
      } catch (e) {
        console.error(`[iherb-kbeauty] ${b.code} failed: ${e?.message || e}`)
        summary.brands.push({ code: b.code, name: b.name, error: e?.message || String(e) })
        if (e?.code === 'IHERB_CURRENCY_INCONSISTENT' || e?.code === 'IHERB_CURRENCY_MISMATCH') {
          process.exit(1)
        }
      }

      if (i + 1 < queue.length && opts.brandGapMs > 0) {
        const gap = Math.floor(opts.brandGapMs * (0.7 + Math.random() * 0.6))
        console.error(`[iherb-kbeauty] brand gap ${Math.round(gap / 1000)}s`)
        await new Promise((r) => setTimeout(r, gap))
      }
    }

    console.log(JSON.stringify({ ok: true, summary }, null, 2))
  } finally {
    try { await page.close() } catch { /* */ }
    try { browser.disconnect() } catch { /* */ }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
