#!/usr/bin/env node
/**
 * iHerb PDP enrich — top-N SKUs get gtin, platform breadcrumb, weight, rankings.
 *
 * Requires prior catalogue harvest (iherb-brand-cycle / iherb-kbeauty-cycle)
 * so product URLs exist in iherb_products.
 *
 * Usage:
 *   node scripts/iherb-pdp-enrich.mjs -w <uuid> --brand anua --top 15 --connect --dry-run
 *   node scripts/iherb-pdp-enrich.mjs -w <uuid> --brand anua --top 15 --connect
 *   node scripts/iherb-pdp-enrich.mjs -w <uuid> --brand merrymonde --top 5 --connect --include-enriched
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SHOPEE_CDP_URL / IHERB_CDP_URL
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectComputerBrowser } from '../marketplace/computerHarvest.mjs'
import { createHarvestNotifier, nullNotifier } from '../marketplace/harvestNotify.mjs'
import {
  enrichIherbPdps,
  loadIherbPdpCandidates,
} from '../marketplace/iherb/pdpEnrich.mjs'

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
    brandKeys: null,
    top: 20,
    dryRun: false,
    connect: process.env.SHOPEE_CDP_URL || process.env.IHERB_CDP_URL || null,
    onlyMissing: true,
    minSold: null,
    delayMs: 900,
    notify: true,
    listOnly: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-w' || a === '--workspace') opts.workspace = argv[++i]
    else if (a === '--brand' || a === '--brands') {
      opts.brandKeys = String(argv[++i] || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    } else if (a === '--top') opts.top = Number(argv[++i]) || 20
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--list-only') opts.listOnly = true
    else if (a === '--include-enriched') opts.onlyMissing = false
    else if (a === '--min-sold') opts.minSold = Number(argv[++i])
    else if (a === '--delay-ms') opts.delayMs = Number(argv[++i]) || 900
    else if (a === '--connect') {
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) opts.connect = argv[++i]
      else opts.connect = opts.connect || 'http://127.0.0.1:9222'
    } else if (a === '--no-notify') opts.notify = false
    else if (a === '--help' || a === '-h') {
      console.log(`iHerb PDP enrich (gtin + breadcrumb + rankings)

Usage:
  node scripts/iherb-pdp-enrich.mjs -w <uuid> --brand anua --top 15 --connect [--dry-run]

Options:
  -w, --workspace     Workspace UUID
  --brand a,b         Brand keys (required for focused runs)
  --top N             Top sold_30d products missing PDP (default 20, max 200)
  --min-sold N        Only candidates with sold_lower_bound >= N
  --include-enriched  Re-fetch even if pdp_enriched_at / gtin present
  --delay-ms N        Gap between PDPs (default 900)
  --connect [url]     CDP browser (default http://127.0.0.1:9222)
  --dry-run           List candidates only (no navigation)
  --list-only         Same as dry-run
  --no-notify         Disable Slack/bus on sustained block

Extracts per PDP:
  gtin, platform breadcrumb, weight, product rankings (#N in category),
  sold 30-day label, price/rating refresh

Example:
  node scripts/iherb-pdp-enrich.mjs -w <uuid> --brand merrymonde --top 10 --connect
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
    console.error('Need -w <workspace_uuid>')
    process.exit(1)
  }
  if (!opts.brandKeys?.length && !opts.listOnly) {
    console.error('Need --brand <key> (comma list ok). Use --help.')
    process.exit(1)
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) {
    console.error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env')
    process.exit(1)
  }

  const db = createClient(url, key, { auth: { persistSession: false } })

  const loadOpts = {
    brand_keys: opts.brandKeys || undefined,
    brand_key: opts.brandKeys?.length === 1 ? opts.brandKeys[0] : undefined,
    top: opts.top,
    only_missing: opts.onlyMissing,
    min_sold: opts.minSold ?? undefined,
  }

  if (opts.dryRun || opts.listOnly) {
    const candidates = await loadIherbPdpCandidates(db, opts.workspace, loadOpts)
    console.log(JSON.stringify({
      workspace_id: opts.workspace,
      brand_keys: opts.brandKeys,
      top: opts.top,
      only_missing: opts.onlyMissing,
      candidate_count: candidates.length,
      candidates: candidates.map((c) => ({
        part_number: c.part_number,
        brand_key: c.brand_key,
        sold_lower_bound: c.sold_lower_bound,
        has_pdp_enrich: c.has_pdp_enrich,
        gtin: c.gtin,
        url: c.url,
        name: c.name,
      })),
    }, null, 2))
    return
  }

  if (!opts.connect) {
    console.error('Need --connect (Chrome remote debugging, e.g. http://127.0.0.1:9222)')
    process.exit(1)
  }

  const notifier = opts.notify
    ? createHarvestNotifier({
        workspaceId: opts.workspace,
        source: 'iherb-pdp-enrich',
        brandKey: opts.brandKeys?.[0] || 'multi',
      })
    : nullNotifier()

  console.error(`[iherb-pdp] connect ${opts.connect}`)
  const { browser } = await connectComputerBrowser(opts.connect)
  let page = (await browser.pages())[0] || (await browser.newPage())
  try {
    page = await browser.newPage()
  } catch {
    /* reuse existing tab */
  }

  try {
    const result = await enrichIherbPdps(page, {
      workspace_id: opts.workspace,
      db,
      brand_keys: opts.brandKeys,
      brand_key: opts.brandKeys?.length === 1 ? opts.brandKeys[0] : undefined,
      top: opts.top,
      only_missing: opts.onlyMissing,
      min_sold: opts.minSold ?? undefined,
      delay_ms: opts.delayMs,
      fast: true,
      onBlocked: (info) => notifier.blocked?.(info),
      onResolved: (info) => notifier.resolved?.(info),
    })

    console.log(JSON.stringify({
      ok: result.ok,
      failed: result.failed,
      blocked: result.blocked,
      candidates: result.candidates,
      sample: result.rows.slice(0, 8).map((r) => ({
        part_number: r.part_number,
        ok: r.ok,
        gtin: r.gtin,
        rank_best: r.rank_best,
        rankings_count: r.rankings_count,
        error: r.error || r.reason || null,
      })),
    }, null, 2))

    if (result.blocked >= 3) process.exitCode = 2
    else if (result.failed && !result.ok) process.exitCode = 1
  } finally {
    // Leave Chrome open (shared CDP session) but drop our page so Node can exit.
    try {
      if (page && !(await browser.pages()).every((p) => p === page)) {
        await page.close().catch(() => {})
      }
    } catch {
      /* ignore */
    }
    try {
      browser.disconnect()
    } catch {
      /* ignore */
    }
  }
  // CDP handles keep the event loop alive without an explicit exit.
  process.exit(process.exitCode || 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
