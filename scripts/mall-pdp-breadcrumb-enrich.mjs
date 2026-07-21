#!/usr/bin/env node
/**
 * MH-4 — Enrich top-N Mall listings with Shopee platform taxonomy (PDP BreadcrumbList).
 *
 * Requires prior list harvest (MH-2/3) so listing_url / item_id exist.
 *
 * Usage:
 *   node scripts/mall-pdp-breadcrumb-enrich.mjs -w <uuid> --brand biodance --top 20 --dry-run
 *   node scripts/mall-pdp-breadcrumb-enrich.mjs -w <uuid> --brand biodance --top 20 --computer --connect
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SHOPEE_CDP_URL, SHOPEE_PROFILE_DIR
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import {
  computerBrowserLaunchOptions,
  connectComputerBrowser,
} from '../marketplace/computerHarvest.mjs'
import {
  loadPdpEnrichCandidates,
  openAndEnrichPdp,
  writePdpEnrichResult,
} from '../marketplace/pdpEnrich.mjs'

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
    computer: true,
    step: false,
    connect: process.env.SHOPEE_CDP_URL || null,
    pauseAfterLoad: false, // captcha-only; --pause-load for every PDP
    onlyMissing: true,
    profileDir: process.env.SHOPEE_PROFILE_DIR || '.shopee-chrome-profile',
    delayMs: 4000,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workspace' || a === '-w') opts.workspace = argv[++i]
    else if (a === '--brand' || a === '--brands') {
      opts.brandKeys = String(argv[++i] || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    } else if (a === '--top') opts.top = Number(argv[++i]) || 20
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--computer') opts.computer = true
    else if (a === '--no-computer') opts.computer = false
    else if (a === '--step') {
      opts.step = true
      opts.computer = true
    } else if (a === '--connect') {
      opts.computer = true
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) opts.connect = argv[++i]
      else opts.connect = process.env.SHOPEE_CDP_URL || 'http://127.0.0.1:9222'
    } else if (a === '--pause-load') opts.pauseAfterLoad = true
    else if (a === '--no-pause-load') opts.pauseAfterLoad = false
    else if (a === '--include-enriched') opts.onlyMissing = false
    else if (a === '--delay-ms') opts.delayMs = Number(argv[++i]) || 4000
    else if (a === '--help' || a === '-h') {
      console.log(`mall-pdp-breadcrumb-enrich.mjs -w <uuid> --brand <key> [--top 20]

MH-4: open product PDPs → parse BreadcrumbList → stamp platform_category_path.

  --brand key          Required (or comma list)
  --top N              Top sold listings missing platform path (default 20)
  --computer           Enter only on captcha (default)
  --pause-load         Enter after every PDP open
  --connect [url]      Attach to Chrome remote debugging (recommended)
  --step               Enter after each successful extract
  --dry-run            List candidates only
  --include-enriched   Re-fetch even if already has platform path

Example:
  node scripts/mall-pdp-breadcrumb-enrich.mjs -w <uuid> --brand biodance --top 15 --computer --connect`)
      process.exit(0)
    }
  }
  return opts
}

async function main() {
  loadDotEnv()
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.workspace) {
    console.error('Need --workspace')
    process.exitCode = 1
    return
  }
  if (!opts.brandKeys?.length) {
    console.error('Need --brand <key>')
    process.exitCode = 1
    return
  }

  const url = process.env.SUPABASE_URL || process.env.NUXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY
  if (!url || !key) {
    console.error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
    process.exitCode = 1
    return
  }

  const db = createClient(url, key, { auth: { persistSession: false } })
  const candidates = await loadPdpEnrichCandidates(db, opts.workspace, {
    brand_keys: opts.brandKeys,
    top: opts.top,
    only_missing: opts.onlyMissing,
  })

  console.log(
    JSON.stringify(
      {
        workspace_id: opts.workspace,
        brands: opts.brandKeys,
        top: opts.top,
        dry_run: opts.dryRun,
        computer: opts.computer,
        connect: opts.connect,
        candidates: candidates.length,
        sample: candidates.slice(0, 8).map((c) => ({
          brand_key: c.brand_key,
          sold: c.sold_label || c.sold_count_lower_bound,
          title: (c.title || '').slice(0, 50),
          url: c.listing_url,
          has_platform: c.has_platform,
        })),
      },
      null,
      2,
    ),
  )

  if (!candidates.length) {
    console.error(
      '[mh4] No candidates. Harvest All Products / shelves first (MH-2/3), or use --include-enriched.',
    )
    process.exitCode = 1
    return
  }

  if (opts.dryRun) {
    console.error('[mh4] dry-run ok — would open PDPs above')
    process.exitCode = 0
    return
  }

  const profileDir = resolve(ROOT, opts.profileDir)
  mkdirSync(profileDir, { recursive: true })

  let browser
  let connected = false
  if (opts.connect) {
    try {
      const c = await connectComputerBrowser(opts.connect)
      browser = c.browser
      connected = true
      console.error(`[mh4] connected to ${opts.connect}`)
    } catch (e) {
      console.error(
        `[mh4] connect failed: ${e?.message || e}\n` +
          `Start: chrome.exe --remote-debugging-port=9222 --user-data-dir="${profileDir}"`,
      )
      process.exitCode = 1
      return
    }
  } else {
    browser = await puppeteer.launch(
      opts.computer
        ? computerBrowserLaunchOptions({ profileDir })
        : {
            headless: false,
            userDataDir: profileDir,
            defaultViewport: { width: 1365, height: 900 },
            args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
          },
    )
  }

  const summary = {
    ok: 0,
    failed: 0,
    paths: {},
    results: [],
  }

  try {
    let page
    if (connected) {
      const pages = await browser.pages()
      page =
        pages.find((p) => /shopee\.sg/i.test(p.url() || '')) ||
        pages[pages.length - 1] ||
        (await browser.newPage())
    } else {
      page = await browser.newPage()
    }

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]
      console.error(
        `[mh4] ${i + 1}/${candidates.length} ${c.brand_key} sold=${c.sold_label || c.sold_count_lower_bound || '?'} ${(c.title || '').slice(0, 40)}`,
      )
      try {
        const enriched = await openAndEnrichPdp(page, c.listing_url, {
          computer: opts.computer,
          pauseAfterLoad: opts.pauseAfterLoad,
          step: opts.step,
        })

        if (!enriched.breadcrumb?.ok) {
          summary.failed++
          summary.results.push({
            listing_id: c.listing_id,
            error: enriched.error || enriched.breadcrumb?.error || 'no_breadcrumb',
            session_health: enriched.session_health,
          })
          console.error(`[mh4] fail: ${enriched.error || enriched.breadcrumb?.error}`)
          if (enriched.session_health === 'blocked') {
            console.error('[mh4] stop_batch: captcha/session blocked')
            break
          }
          continue
        }

        const written = await writePdpEnrichResult(db, {
          workspace_id: opts.workspace,
          listing_id: c.listing_id,
          candidate: c,
          breadcrumb: enriched.breadcrumb,
          product: enriched.product,
          page_url: enriched.page_url,
        })

        summary.ok++
        const leaf = written.platform_category_leaf || '—'
        summary.paths[leaf] = (summary.paths[leaf] || 0) + 1
        summary.results.push({
          listing_id: c.listing_id,
          path: written.category_path,
          leaf,
          price: written.price,
          rating: written.rating,
        })
        console.error(`[mh4] ok: ${written.category_path}`)

        if (i + 1 < candidates.length && opts.delayMs > 0) {
          await new Promise((r) => setTimeout(r, opts.delayMs))
        }
      } catch (e) {
        summary.failed++
        summary.results.push({ listing_id: c.listing_id, error: e?.message || String(e) })
        console.error(`[mh4] error:`, e?.message || e)
      }
    }
  } finally {
    if (connected) browser.disconnect()
    else await browser.close().catch(() => {})
  }

  console.log(JSON.stringify(summary, null, 2))
  process.exitCode = summary.ok ? 0 : 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
