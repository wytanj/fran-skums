#!/usr/bin/env node
/**
 * Overnight iHerb PDP enrich across all K-Beauty brands.
 *
 * iHerb has no login; press-and-hold is rare and page HTML often still parses.
 * Multi-tab concurrency is safe and much faster for the tail of the queue.
 *
 * Catalogue harvest (iherb-kbeauty-cycle) must have run first so URLs exist.
 *
 * Defaults:
 *   --full / --top 500   full brand catalogue (missing PDP only)
 *   --tabs 3             concurrent Chrome tabs (same CDP browser)
 *   --delay-ms 500       gap per tab between PDPs (not global)
 *   resume via .iherb-pdp-progress.json
 *
 * Usage:
 *   node scripts/iherb-pdp-cycle.mjs -w <uuid> --dry-run
 *   node scripts/iherb-pdp-cycle.mjs -w <uuid> --connect --overnight --full --tabs 3
 *   node scripts/iherb-pdp-cycle.mjs -w <uuid> --connect --overnight --full --tabs 4 --fast
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FRAN_MCP_WORKSPACE_ID
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectComputerBrowser } from '../marketplace/computerHarvest.mjs'
import { createHarvestNotifier, nullNotifier } from '../marketplace/harvestNotify.mjs'
import {
  enrichIherbPdps,
  loadIherbPdpCandidates,
} from '../marketplace/iherb/pdpEnrich.mjs'
import { brandKeyFromDisplayName } from '../marketplace/brandKey.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_BRANDS = resolve(ROOT, '.iherb-kbeauty-brands.json')
const DEFAULT_PROGRESS = resolve(ROOT, '.iherb-pdp-progress.json')

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function parseArgs(argv) {
  const opts = {
    workspace: process.env.MARKETPLACE_WORKSPACE_ID || process.env.FRAN_MCP_WORKSPACE_ID || null,
    connect: process.env.SHOPEE_CDP_URL || process.env.IHERB_CDP_URL || null,
    fromJson: DEFAULT_BRANDS,
    progressPath: DEFAULT_PROGRESS,
    top: 10,
    maxBrands: 300,
    minSold: null,
    delayMs: 800,
    brandGapMs: 4000,
    tabs: 1,
    fast: false,
    overnight: false,
    dryRun: false,
    onlyMissing: true,
    includeEnriched: false,
    notify: false, // quiet overnight by default
    maxConsecutiveBlocked: 5,
    brandKeys: null,
    skipDone: true,
    resetProgress: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-w' || a === '--workspace') opts.workspace = argv[++i]
    else if (a === '--connect') {
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) opts.connect = argv[++i]
      else opts.connect = opts.connect || 'http://127.0.0.1:9222'
    } else if (a === '--from-json') opts.fromJson = resolve(ROOT, argv[++i] || DEFAULT_BRANDS)
    else if (a === '--progress') opts.progressPath = resolve(ROOT, argv[++i] || DEFAULT_PROGRESS)
    else if (a === '--top') opts.top = Math.min(Math.max(Number(argv[++i]) || 10, 1), 500)
    else if (a === '--max-brands') opts.maxBrands = Number(argv[++i]) || 300
    else if (a === '--min-sold') opts.minSold = Number(argv[++i])
    else if (a === '--delay-ms') opts.delayMs = Number(argv[++i]) || 800
    else if (a === '--brand-gap-ms') opts.brandGapMs = Number(argv[++i]) || 4000
    else if (a === '--tabs' || a === '--concurrency') {
      opts.tabs = Math.min(Math.max(Number(argv[++i]) || 3, 1), 6)
    } else if (a === '--fast') opts.fast = true
    else if (a === '--slow') {
      opts.fast = false
      opts.tabs = 1
      opts.delayMs = Math.max(opts.delayMs, 3500)
      opts.brandGapMs = Math.max(opts.brandGapMs, 12000)
    } else if (a === '--overnight') {
      // Full catalogue + multi-tab speed (iHerb has no captcha wall)
      opts.overnight = true
      opts.fast = true
      if (opts.top === 10) opts.top = 500
      if (opts.tabs === 1) opts.tabs = 3
      // Fast defaults unless user already set tighter flags earlier in argv
      if (opts.delayMs === 800) opts.delayMs = 500
      if (opts.brandGapMs === 4000) opts.brandGapMs = 2500
      opts.notify = false
      opts.onlyMissing = true
    } else if (a === '--full') {
      // Alias: enrich every missing PDP (up to 500/brand)
      opts.top = 500
      opts.onlyMissing = true
    } else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--include-enriched') {
      opts.includeEnriched = true
      opts.onlyMissing = false
    } else if (a === '--notify') opts.notify = true
    else if (a === '--no-notify') opts.notify = false
    else if (a === '--no-resume') opts.skipDone = false
    else if (a === '--reset-progress') opts.resetProgress = true
    else if (a === '--brand' || a === '--brands') {
      opts.brandKeys = String(argv[++i] || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    } else if (a === '--help' || a === '-h') {
      console.log(`iHerb PDP cycle — overnight enrich (gtin + rankings + breadcrumb)

Usage:
  node scripts/iherb-pdp-cycle.mjs -w <uuid> --connect --overnight
  node scripts/iherb-pdp-cycle.mjs -w <uuid> --dry-run
  node scripts/iherb-pdp-cycle.mjs -w <uuid> --connect --top 5 --max-brands 15

Requires prior catalogue harvest (iherb-kbeauty-cycle). Brand queue comes from
iherb_products (all harvested brand_keys), not the incomplete facet JSON.
Progress: .iherb-pdp-progress.json (resume-safe).

Options:
  --overnight         Full catalog + multi-tab (top=500, --tabs 3, fast)
  --full              Same as --top 500 (every missing PDP per brand, cap 500)
  --tabs N            Concurrent Chrome tabs 1–6 (default 1; overnight 3)
  --top N             PDPs per brand by sold_30d (default 10; max 500 = full catalog)
  --max-brands N      Cap brands (default 300)
  --min-sold N        Skip SKUs below sold_lower_bound
  --delay-ms N        Per-tab gap between PDPs (default 800; overnight 500)
  --brand-gap-ms N    Between brands (default 4000; overnight 2500)
  --slow / --fast     Nav style (--slow forces tabs=1)
  --from-json path    Brand list (default .iherb-kbeauty-brands.json)
  --brand a,b         Only these brand_keys
  --include-enriched  Re-fetch ranks even if gtin present
  --no-resume         Ignore progress file
  --reset-progress    Clear progress then run
  --dry-run           Count candidates only, no browser
  --notify            Slack/bus on sustained block (off by default)

Estimate (overnight top 10 × 182 brands, ~50% still missing after partial runs):
  ~900–1800 PDPs × ~4–6s ≈ 1–3 hours typical; leave 6–8h headroom.
`)
      process.exit(0)
    }
  }

  if (opts.includeEnriched) opts.onlyMissing = false
  return opts
}

/**
 * Prefer warehouse brand_keys (complete after kbeauty harvest). Facet JSON only
 * has names for brands that were expanded in the sidebar (~24); the rest are
 * code-only stubs — use catalogue identity instead.
 *
 * @param {any} db
 * @param {string} workspaceId
 * @param {{
 *   brandKeys?: string[]|null
 *   maxBrands: number
 *   fromJson?: string|null
 * }} opts
 */
async function loadBrandQueue(db, workspaceId, opts) {
  /** @type {Map<string, { brand_key: string, name: string|null, code: string|null, count: number }>} */
  const byKey = new Map()

  // 1) Warehouse — ground truth after catalogue harvest
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('iherb_products')
      .select('brand_key, brand_name, brand_id')
      .eq('workspace_id', workspaceId)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`load brands: ${error.message}`)
    const batch = data || []
    for (const row of batch) {
      const key = String(row.brand_key || '').toLowerCase().trim()
      if (!key) continue
      const prev = byKey.get(key)
      if (!prev) {
        byKey.set(key, {
          brand_key: key,
          name: row.brand_name || null,
          code: row.brand_id || null,
          count: 1,
        })
      } else {
        prev.count += 1
        if (!prev.name && row.brand_name) prev.name = row.brand_name
        if (!prev.code && row.brand_id) prev.code = row.brand_id
      }
    }
    if (batch.length < pageSize) break
    if (byKey.size > 5000) break
  }

  // 2) Overlay facet JSON for codes/names where warehouse is thin
  if (opts.fromJson && existsSync(opts.fromJson)) {
    try {
      const raw = JSON.parse(readFileSync(opts.fromJson, 'utf8'))
      const brands = raw.brands || raw
      if (Array.isArray(brands)) {
        for (const b of brands) {
          const key = (
            b.brand_key
            || (b.name ? brandKeyFromDisplayName(b.name) : null)
            || ''
          )
            .toLowerCase()
            .trim()
          if (!key) continue
          const prev = byKey.get(key)
          if (!prev) {
            // Not in warehouse yet — skip (no URLs to enrich)
            continue
          }
          if (b.code && !prev.code) prev.code = b.code
          if (b.name && !prev.name) prev.name = b.name
          if (b.count != null && b.count > prev.count) {
            // facet count is assortment size; keep product count as count
          }
        }
      }
    } catch {
      /* optional file */
    }
  }

  let queue = [...byKey.values()]

  if (opts.brandKeys?.length) {
    const want = new Set(opts.brandKeys.map((k) => k.toLowerCase()))
    queue = queue.filter((b) => want.has(b.brand_key))
  }

  // More SKUs first so partial overnight still covers big brands
  queue.sort((a, b) => b.count - a.count || a.brand_key.localeCompare(b.brand_key))

  return queue.slice(0, opts.maxBrands)
}

function loadProgress(path) {
  if (!existsSync(path)) return { done: [], rows: [], totals: { ok: 0, failed: 0, blocked: 0 } }
  try {
    const p = JSON.parse(readFileSync(path, 'utf8'))
    return {
      done: Array.isArray(p.done) ? p.done.map(String) : [],
      rows: Array.isArray(p.rows) ? p.rows : [],
      totals: p.totals || { ok: 0, failed: 0, blocked: 0 },
      started_at: p.started_at || null,
    }
  } catch {
    return { done: [], rows: [], totals: { ok: 0, failed: 0, blocked: 0 } }
  }
}

function saveProgress(path, state) {
  writeFileSync(
    path,
    JSON.stringify(
      {
        updated_at: new Date().toISOString(),
        started_at: state.started_at || new Date().toISOString(),
        done: state.done,
        totals: state.totals,
        rows: state.rows.slice(-500), // keep last 500 brand rows
      },
      null,
      2,
    ),
  )
}

async function main() {
  loadDotEnv()
  const opts = parseArgs(process.argv.slice(2))

  if (!opts.workspace) {
    console.error('Need -w <workspace_uuid>')
    process.exit(1)
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_KEY
  if (!url || !key) {
    console.error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env')
    process.exit(1)
  }

  const db = createClient(url, key, { auth: { persistSession: false } })

  if (opts.resetProgress && existsSync(opts.progressPath)) {
    writeFileSync(opts.progressPath, JSON.stringify({ done: [], rows: [], totals: {} }, null, 2))
    console.error(`[iherb-pdp-cycle] reset ${opts.progressPath}`)
  }

  let queue = await loadBrandQueue(db, opts.workspace, {
    brandKeys: opts.brandKeys,
    maxBrands: opts.maxBrands,
    fromJson: opts.fromJson,
  })
  console.error(
    `[iherb-pdp-cycle] warehouse brands with products: ${queue.length}`
    + (opts.fromJson ? ` (overlay ${opts.fromJson})` : ''),
  )

  const progress = loadProgress(opts.progressPath)
  if (!progress.started_at) progress.started_at = new Date().toISOString()

  if (opts.skipDone && progress.done.length) {
    const done = new Set(progress.done.map((k) => String(k).toLowerCase()))
    const before = queue.length
    queue = queue.filter((b) => !done.has(b.brand_key))
    console.error(
      `[iherb-pdp-cycle] resume: skip ${before - queue.length} done brands, remaining ${queue.length}`,
    )
  }

  // Dry-run: estimate candidates across queue (no browser)
  if (opts.dryRun) {
    let totalCandidates = 0
    const perBrand = []
    for (const b of queue) {
      const cands = await loadIherbPdpCandidates(db, opts.workspace, {
        brand_key: b.brand_key,
        top: opts.top,
        only_missing: opts.onlyMissing,
        min_sold: opts.minSold ?? undefined,
      })
      totalCandidates += cands.length
      if (cands.length) {
        perBrand.push({
          brand_key: b.brand_key,
          code: b.code,
          product_count: b.count,
          candidates: cands.length,
          top_sold: cands[0]?.sold_lower_bound ?? null,
        })
      }
    }
    const tabs = Math.max(opts.tabs || 1, 1)
    const secPerPdp = (opts.delayMs + (opts.fast ? 600 : 2000)) / 1000 / tabs
    const brandOverhead = (opts.brandGapMs / 1000) * queue.length
    const estSec = totalCandidates * secPerPdp + brandOverhead
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          brands_queued: queue.length,
          brands_with_candidates: perBrand.length,
          total_pdp_candidates: totalCandidates,
          top_per_brand: opts.top,
          only_missing: opts.onlyMissing,
          tabs,
          est_hours: Math.round((estSec / 3600) * 10) / 10,
          delay_ms: opts.delayMs,
          brand_gap_ms: opts.brandGapMs,
          fast: opts.fast,
          overnight: opts.overnight,
          note: 'Queue = warehouse brand_keys; est_hours scales with --tabs',
          sample_brands: perBrand.slice(0, 15),
        },
        null,
        2,
      ),
    )
    return
  }

  if (!opts.connect) {
    console.error('Need --connect (e.g. --connect or --connect http://127.0.0.1:9222)')
    process.exit(1)
  }

  const notifier = opts.notify
    ? createHarvestNotifier({
        workspaceId: opts.workspace,
        source: 'iherb-pdp-cycle',
        brandKey: 'multi',
      })
    : nullNotifier()

  const tabs = Math.min(Math.max(opts.tabs || 1, 1), 6)
  console.error(
    `[iherb-pdp-cycle] connect ${opts.connect}`
    + ` brands=${queue.length} top=${opts.top} tabs=${tabs}`
    + ` delay=${opts.delayMs}ms brand_gap=${opts.brandGapMs}ms`
    + ` fast=${opts.fast} overnight=${opts.overnight}`,
  )

  const { browser } = await connectComputerBrowser(opts.connect)
  /** @type {import('puppeteer').Page[]} */
  const pages = []
  for (let t = 0; t < tabs; t++) {
    try {
      pages.push(await browser.newPage())
    } catch (e) {
      console.error(`[iherb-pdp-cycle] newPage tab ${t + 1} failed: ${e?.message || e}`)
      break
    }
  }
  if (!pages.length) {
    const fallback = (await browser.pages())[0]
    if (!fallback) throw new Error('No browser pages available')
    pages.push(fallback)
  }
  console.error(`[iherb-pdp-cycle] using ${pages.length} tab(s)`)

  let consecutiveBlocked = 0
  const runTotals = { ok: 0, failed: 0, blocked: 0, brands_ok: 0, brands_empty: 0 }

  try {
    for (let i = 0; i < queue.length; i++) {
      const b = queue[i]
      console.error(
        `\n[iherb-pdp-cycle] (${i + 1}/${queue.length}) ${b.brand_key}`
        + (b.code ? ` bids=${b.code}` : '')
        + (b.count != null ? ` facet~${b.count}` : '')
        + ` tabs=${pages.length}`,
      )

      let result
      try {
        result = await enrichIherbPdps(pages, {
          workspace_id: opts.workspace,
          db,
          brand_key: b.brand_key,
          top: opts.top,
          only_missing: opts.onlyMissing,
          min_sold: opts.minSold ?? undefined,
          delay_ms: opts.delayMs,
          fast: opts.fast,
          concurrency: pages.length,
          max_consecutive_blocked: opts.maxConsecutiveBlocked,
          onBlocked: (info) => notifier.blocked?.(info),
          onResolved: (info) => notifier.resolved?.(info),
        })
      } catch (e) {
        console.error(`[iherb-pdp-cycle] ${b.brand_key} error: ${e?.message || e}`)
        progress.rows.push({
          brand_key: b.brand_key,
          code: b.code,
          error: e?.message || String(e),
          at: new Date().toISOString(),
        })
        saveProgress(opts.progressPath, progress)
        continue
      }

      runTotals.ok += result.ok
      runTotals.failed += result.failed
      runTotals.blocked += result.blocked
      if (result.ok > 0) runTotals.brands_ok += 1
      if (result.candidates === 0) runTotals.brands_empty += 1

      if (result.blocked >= (opts.maxConsecutiveBlocked || 5)) {
        consecutiveBlocked += 1
      } else if (result.blocked === 0) {
        consecutiveBlocked = 0
      }

      const row = {
        brand_key: b.brand_key,
        code: b.code,
        candidates: result.candidates,
        ok: result.ok,
        failed: result.failed,
        blocked: result.blocked,
        sample: result.rows
          .filter((r) => r.ok)
          .slice(0, 3)
          .map((r) => ({
            part_number: r.part_number,
            rank: r.rank_best?.rank,
            category: r.rank_best?.category,
            gtin: r.gtin,
          })),
        at: new Date().toISOString(),
      }
      progress.done = [...new Set([...progress.done, b.brand_key])]
      progress.rows.push(row)
      progress.totals = {
        ok: (progress.totals?.ok || 0) + result.ok,
        failed: (progress.totals?.failed || 0) + result.failed,
        blocked: (progress.totals?.blocked || 0) + result.blocked,
      }
      saveProgress(opts.progressPath, progress)

      console.error(
        `[iherb-pdp-cycle] ${b.brand_key}: ok=${result.ok} fail=${result.failed}`
        + ` empty=${result.candidates === 0} progress_done=${progress.done.length}`,
      )

      if (consecutiveBlocked >= 2) {
        console.error(
          `[iherb-pdp-cycle] exit 2: repeated blocks — fix Chrome / wait, then re-run to resume`,
        )
        console.log(
          JSON.stringify(
            {
              ok: false,
              exit: 2,
              runTotals,
              progress_done: progress.done.length,
              remaining: queue.length - i - 1,
            },
            null,
            2,
          ),
        )
        process.exitCode = 2
        break
      }

      if (i + 1 < queue.length && opts.brandGapMs > 0) {
        const gap = Math.floor(opts.brandGapMs * (0.75 + Math.random() * 0.5))
        console.error(`[iherb-pdp-cycle] brand gap ${Math.round(gap / 1000)}s`)
        await sleep(gap)
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: process.exitCode !== 2,
          runTotals,
          progress_done_brands: progress.done.length,
          progress_path: opts.progressPath,
          lifetime_totals: progress.totals,
        },
        null,
        2,
      ),
    )
  } finally {
    for (const p of pages) {
      try {
        await p.close()
      } catch {
        /* */
      }
    }
    try {
      browser.disconnect()
    } catch {
      /* */
    }
  }

  process.exit(process.exitCode || 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
