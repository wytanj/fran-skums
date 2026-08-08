#!/usr/bin/env node
/**
 * Harvest iHerb brand catalogue(s) via warm Chrome CDP.
 *
 * Prerequisites:
 *   - Chrome with --remote-debugging-port=9222 (same profile as Shopee is fine)
 *   - Migration 086 applied
 *   - SUPABASE_URL + service key in .env
 *
 * Usage:
 *   node scripts/iherb-brand-cycle.mjs -w <uuid> --brand anua --connect --dry-run
 *   node scripts/iherb-brand-cycle.mjs -w <uuid> --brand anua --connect
 *   node scripts/iherb-brand-cycle.mjs -w <uuid> --iherb-interest --connect --max-brands 5
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectComputerBrowser } from '../marketplace/computerHarvest.mjs'
import { createHarvestNotifier, nullNotifier } from '../marketplace/harvestNotify.mjs'
import {
  harvestIherbBrand,
  loadIherbHarvestTargets,
  resetIherbNavCount,
} from '../marketplace/iherb/harvestWorker.mjs'

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
    iherbInterest: false,
    maxBrands: 50,
    maxPages: 10,
    delayMs: 4000,
    dryRun: false,
    connect: process.env.SHOPEE_CDP_URL || process.env.IHERB_CDP_URL || null,
    maxConsecutiveBlocked: 3,
    recoveryMinutes: 15,
    notify: true,
    brandGapMs: 8000,
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-w' || a === '--workspace') opts.workspace = argv[++i]
    else if (a === '--brand') {
      opts.brandKeys = String(argv[++i] || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    } else if (a === '--iherb-interest') opts.iherbInterest = true
    else if (a === '--max-brands') opts.maxBrands = Number(argv[++i]) || 50
    else if (a === '--max-pages') opts.maxPages = Number(argv[++i]) || 10
    else if (a === '--delay-ms') opts.delayMs = Number(argv[++i]) || 4000
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--connect') {
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        opts.connect = argv[++i]
      } else {
        opts.connect = opts.connect || 'http://127.0.0.1:9222'
      }
    } else if (a === '--no-notify') opts.notify = false
    else if (a === '--help' || a === '-h') {
      console.log(`iHerb brand catalogue harvest

Usage:
  node scripts/iherb-brand-cycle.mjs -w <uuid> --brand anua --connect [--dry-run]
  node scripts/iherb-brand-cycle.mjs -w <uuid> --iherb-interest --connect

Options:
  -w, --workspace     Workspace UUID
  --brand a,b         Brand keys (also used as /c/<slug>)
  --iherb-interest    Load brands with iherb_interest=true
  --max-brands N      Cap when using --iherb-interest (default 50)
  --max-pages N       Catalogue pages per brand (default 10)
  --delay-ms N        Gap between pages (default 4000)
  --connect [url]     CDP browser URL (default http://127.0.0.1:9222)
  --dry-run           Parse only, no DB write
  --no-notify         Disable Slack/bus pings on sustained block
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
    console.error('Need --connect (Chrome CDP, e.g. --connect or --connect http://127.0.0.1:9222)')
    process.exit(1)
  }
  if (!opts.brandKeys?.length && !opts.iherbInterest) {
    console.error('Need --brand anua or --iherb-interest')
    process.exit(1)
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    console.error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env')
    process.exit(1)
  }

  const db = createClient(url, key, { auth: { persistSession: false } })

  /** @type {{ brand_key: string, slug?: string }[]} */
  let brands = []
  if (opts.brandKeys?.length) {
    brands = opts.brandKeys.map((k) => ({ brand_key: k, slug: k }))
  } else {
    const rows = await loadIherbHarvestTargets(db, opts.workspace, {
      limit: opts.maxBrands,
    })
    brands = rows.map((r) => ({
      brand_key: r.brand_key,
      slug: r.metadata?.iherb_slug || r.brand_key,
    }))
  }

  if (!brands.length) {
    console.error('No brands to harvest')
    process.exit(1)
  }

  console.error(`[iherb-cycle] brands=${brands.length} dry_run=${opts.dryRun} cdp=${opts.connect}`)

  const notifier = opts.notify
    ? createHarvestNotifier({
        workspaceId: opts.workspace,
        runId: `iherb-${Date.now()}`,
      })
    : nullNotifier()

  const { browser } = await connectComputerBrowser(opts.connect)
  resetIherbNavCount()

  let page = (await browser.pages())[0] || (await browser.newPage())
  // Prefer a dedicated tab so we don't steal Shopee mid-session
  try {
    page = await browser.newPage()
  } catch {
    /* reuse */
  }

  let consecutiveBlocked = 0
  const summary = []

  try {
    for (let i = 0; i < brands.length; i++) {
      const b = brands[i]
      console.error(`\n[iherb-cycle] (${i + 1}/${brands.length}) ${b.brand_key}`)

      // Notify only after sustained block — onBlocked is throttled by waitForRecovery
      // deadline; we also count consecutive brand-level stops.
      let brandBlockedNotified = false
      const onBlocked = async (info) => {
        // First block during recovery: log only (handoff: no page on first 403)
        console.error(`[iherb-cycle] blocked signal: ${info?.label || b.brand_key}`)
      }
      const onResolved = async (info) => {
        if (info?.recovered) {
          console.error(`[iherb-cycle] recovered: ${info.label}`)
          await notifier.recovered({
            brand_key: b.brand_key,
            marketplace: 'iherb',
            waited_ms: info.waitedMs,
            via: info.via,
          })
        }
      }

      try {
        const result = await harvestIherbBrand(page, {
          workspace_id: opts.workspace,
          brand_key: b.brand_key,
          slug: b.slug,
          db,
          dry_run: opts.dryRun,
          max_pages: opts.maxPages,
          delay_ms: opts.delayMs,
          recoveryDeadlineMs: opts.recoveryMinutes * 60 * 1000,
          onBlocked,
          onResolved,
        })

        if (result.sustained_blocked) {
          consecutiveBlocked += 1
          if (!brandBlockedNotified) {
            brandBlockedNotified = true
            await notifier.blocked({
              brand_key: b.brand_key,
              marketplace: 'iherb',
              reason: result.stop_reason,
              consecutive: consecutiveBlocked,
            })
          }
          if (consecutiveBlocked >= opts.maxConsecutiveBlocked) {
            console.error(
              `[iherb-cycle] exit 2: ${consecutiveBlocked} consecutive sustained blocks`,
            )
            summary.push(result)
            console.error(JSON.stringify({ ok: false, exit: 2, summary }, null, 2))
            process.exit(2)
          }
        } else {
          consecutiveBlocked = 0
        }

        summary.push({
          brand_key: result.brand_key,
          products: result.product_count,
          pages: result.pages_fetched,
          with_sold: result.coverage?.with_sold,
          stop_reason: result.stop_reason,
          written: result.write?.products_upserted ?? null,
        })
      } catch (e) {
        console.error(`[iherb-cycle] ${b.brand_key} failed: ${e?.message || e}`)
        summary.push({ brand_key: b.brand_key, error: e?.message || String(e) })
        if (e?.code === 'IHERB_CURRENCY_INCONSISTENT' || e?.code === 'IHERB_CURRENCY_MISMATCH') {
          // Currency flip is a run configuration error — stop the cycle.
          process.exit(1)
        }
      }

      if (i + 1 < brands.length && opts.brandGapMs > 0) {
        const gap = Math.floor(opts.brandGapMs * (0.7 + Math.random() * 0.6))
        console.error(`[iherb-cycle] brand gap ${Math.round(gap / 1000)}s`)
        await new Promise((r) => setTimeout(r, gap))
      }
    }
  } finally {
    // Do not browser.close() on --connect — operator's Chrome
    try {
      await page.close()
    } catch {
      /* ignore */
    }
    try {
      browser.disconnect()
    } catch {
      /* ignore */
    }
  }

  console.error(JSON.stringify({ ok: true, summary }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
