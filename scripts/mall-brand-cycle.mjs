#!/usr/bin/env node
/**
 * Level 1–2 automation: full brand cycle (list harvest MH-2/3 + MH-4 PDP path).
 *
 * Prerequisites:
 *   - Brand(s) linked (shop_username) via extension
 *   - Chrome with --remote-debugging-port=9222 (recommended) + Shopee login
 *
 * Usage:
 *   node scripts/mall-brand-cycle.mjs -w <uuid> --brand biodance --connect --dry-run
 *   node scripts/mall-brand-cycle.mjs -w <uuid> --brand biodance,anua --connect
 *   node scripts/mall-brand-cycle.mjs -w <uuid> --pilot-only --connect --list-mode both --mh4-top 15
 *
 * Captcha: default pause only when blocked (bell + Enter). Use --pause-load to babysit every page.
 * State: .mall-cycle-state.json (resume with --skip-done)
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import { PILOT_BRAND_KEYS } from '../marketplace/brandKey.mjs'
import {
  computerBrowserLaunchOptions,
  connectComputerBrowser,
  withComputerDefaults,
} from '../marketplace/computerHarvest.mjs'
import {
  defaultCycleStatePath,
  loadCycleState,
  patchBrandState,
  saveCycleState,
} from '../marketplace/mallCycleState.mjs'
import {
  harvestBrandAllProducts,
  harvestBrandCollections,
  loadHarvestTargets,
  resolveShelvesForBrand,
} from '../marketplace/mallHarvestWorker.mjs'
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
    pilotOnly: false,
    listMode: 'both', // all | collections | both | skip
    maxPages: 2,
    mh4Top: 20,
    skipList: false,
    skipMh4: false,
    skipDone: false,
    dryRun: false,
    computer: true,
    connect: process.env.SHOPEE_CDP_URL || null,
    pauseAfterLoad: false,
    step: false,
    profileDir: process.env.SHOPEE_PROFILE_DIR || '.shopee-chrome-profile',
    statePath: defaultCycleStatePath(ROOT),
    delayMs: 5000,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workspace' || a === '-w') opts.workspace = argv[++i]
    else if (a === '--brand' || a === '--brands') {
      opts.brandKeys = String(argv[++i] || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    } else if (a === '--pilot-only') opts.pilotOnly = true
    else if (a === '--list-mode') opts.listMode = String(argv[++i] || 'both').toLowerCase()
    else if (a === '--max-pages') opts.maxPages = Number(argv[++i]) || 2
    else if (a === '--mh4-top') opts.mh4Top = Number(argv[++i]) || 20
    else if (a === '--skip-list') opts.skipList = true
    else if (a === '--skip-mh4') opts.skipMh4 = true
    else if (a === '--skip-done') opts.skipDone = true
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--computer') opts.computer = true
    else if (a === '--connect') {
      opts.computer = true
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) opts.connect = argv[++i]
      else opts.connect = process.env.SHOPEE_CDP_URL || 'http://127.0.0.1:9222'
    } else if (a === '--pause-load') opts.pauseAfterLoad = true
    else if (a === '--step') opts.step = true
    else if (a === '--state') opts.statePath = resolve(argv[++i])
    else if (a === '--delay-ms') opts.delayMs = Number(argv[++i]) || 5000
    else if (a === '--help' || a === '-h') {
      console.log(`mall-brand-cycle.mjs -w <uuid> --brand <key>[,key2] --connect

Runs per brand: MH-2/3 list harvest → MH-4 top-N PDP platform path.

  --brand a,b          Brands to process (or --pilot-only)
  --list-mode both|all|collections|skip
  --max-pages N        List harvest pages (default 2)
  --mh4-top N          PDP enrich count (default 20)
  --skip-list          MH-4 only
  --skip-mh4           List only
  --skip-done          Skip brands with list+mh4 in .mall-cycle-state.json
  --connect [url]      Attach Chrome (recommended)
  --pause-load         Enter after every nav (default: captcha-only)
  --dry-run            Plan only
  --state path         State file (default .mall-cycle-state.json)

Example:
  node scripts/mall-brand-cycle.mjs -w <uuid> --brand biodance --connect --list-mode both --mh4-top 15`)
      process.exit(0)
    }
  }
  if (opts.listMode === 'skip') opts.skipList = true
  if (!['all', 'collections', 'both', 'skip'].includes(opts.listMode)) opts.listMode = 'both'
  if (opts.pilotOnly && !opts.brandKeys) opts.brandKeys = [...PILOT_BRAND_KEYS]
  return opts
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  loadDotEnv()
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.workspace) {
    console.error('Need --workspace')
    process.exitCode = 1
    return
  }
  if (!opts.brandKeys?.length && !opts.pilotOnly) {
    console.error('Need --brand <key> or --pilot-only')
    process.exitCode = 1
    return
  }

  const url = process.env.SUPABASE_URL || process.env.NUXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY
  if (!url || !key) {
    console.error('Need SUPABASE_URL + SERVICE_ROLE_KEY')
    process.exitCode = 1
    return
  }

  const db = createClient(url, key, { auth: { persistSession: false } })
  const state = loadCycleState(opts.statePath)
  state.workspace_id = opts.workspace

  const targets = await loadHarvestTargets(db, opts.workspace, {
    brand_keys: opts.brandKeys,
    pilot_only: opts.pilotOnly && !opts.brandKeys,
    require_shop: true,
  })

  let brands = targets.filter((t) => t.shop_username)
  if (opts.skipDone) {
    brands = brands.filter((t) => {
      const s = state.brands[t.brand_key]
      return !(s?.list_ok && s?.mh4_ok)
    })
  }

  const missingShop = (opts.brandKeys || []).filter(
    (k) => !brands.some((t) => t.brand_key === k),
  )

  const plan = brands.map((t) => ({
    brand_key: t.brand_key,
    shop: t.shop_username,
    shelves: resolveShelvesForBrand(t, {
      mode: opts.listMode === 'skip' ? 'all' : opts.listMode,
    }).map((s) => s.name),
    prior: state.brands[t.brand_key] || null,
  }))

  console.log(
    JSON.stringify(
      {
        workspace_id: opts.workspace,
        dry_run: opts.dryRun,
        connect: opts.connect,
        list_mode: opts.skipList ? 'skip' : opts.listMode,
        mh4_top: opts.skipMh4 ? 0 : opts.mh4Top,
        pause_after_load: opts.pauseAfterLoad,
        skip_done: opts.skipDone,
        brands: plan,
        missing_shop_username: missingShop,
        state_file: opts.statePath,
      },
      null,
      2,
    ),
  )

  if (!brands.length) {
    console.error('[cycle] No brands with shop_username. Link shops in the extension first.')
    process.exitCode = 1
    return
  }

  if (opts.dryRun) {
    console.error('[cycle] dry-run ok — no browser')
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
      console.error(`[cycle] connected to ${opts.connect}`)
    } catch (e) {
      console.error(
        `[cycle] connect failed: ${e?.message || e}\n` +
          `Start Chrome:\n` +
          `  chrome.exe --remote-debugging-port=9222 --user-data-dir="${profileDir}"`,
      )
      process.exitCode = 1
      return
    }
  } else {
    console.error('[cycle] launching Chrome (prefer --connect for less captcha)')
    browser = await puppeteer.launch(
      opts.computer
        ? computerBrowserLaunchOptions({ profileDir })
        : {
            headless: false,
            userDataDir: profileDir,
            args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
          },
    )
  }

  const summary = {
    brands_ok: 0,
    brands_failed: 0,
    list_products: 0,
    mh4_ok: 0,
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

    let harvestOpts = {
      workspace_id: opts.workspace,
      max_pages: opts.maxPages,
      interactive: true,
      computer: true,
      step: opts.step,
      pauseAfterLoad: opts.pauseAfterLoad,
      collection_names: null,
      mode: opts.listMode === 'both' ? 'both' : opts.listMode,
      dry_run: false,
    }
    harvestOpts = withComputerDefaults(harvestOpts)
    harvestOpts.pauseAfterLoad = opts.pauseAfterLoad

    for (const brand of brands) {
      const brandResult = {
        brand_key: brand.brand_key,
        shop: brand.shop_username,
        list: null,
        mh4: null,
        error: null,
      }
      console.error(`\n[cycle] ========== ${brand.brand_key} @${brand.shop_username} ==========`)

      try {
        // —— MH-2 / MH-3 ——
        if (!opts.skipList) {
          console.error(`[cycle] list harvest mode=${opts.listMode} max_pages=${opts.maxPages}`)
          let listResult
          if (opts.listMode === 'all') {
            listResult = await harvestBrandAllProducts(page, brand, db, harvestOpts)
          } else {
            listResult = await harvestBrandCollections(page, brand, db, {
              ...harvestOpts,
              mode: opts.listMode === 'both' ? 'both' : 'collections',
            })
          }
          brandResult.list = {
            products: listResult.product_count || 0,
            shelves_done: listResult.shelves_done,
            stop_batch: listResult.stop_batch,
            stop_reason: listResult.stop_reason,
            error: listResult.error,
          }
          summary.list_products += listResult.product_count || 0
          patchBrandState(state, brand.brand_key, {
            list_ok: (listResult.product_count || 0) > 0,
            list_products: listResult.product_count || 0,
            list_at: new Date().toISOString(),
            list_error: listResult.error || listResult.stop_reason || null,
            shop_username: brand.shop_username,
          })
          saveCycleState(opts.statePath, state)

          if (listResult.stop_batch) {
            brandResult.error = listResult.stop_reason || 'stop_batch'
            summary.brands_failed++
            summary.results.push(brandResult)
            console.error(`[cycle] stop_batch — fix captcha/session, re-run with --skip-done`)
            break
          }
        } else {
          console.error('[cycle] skip list harvest')
        }

        // —— MH-4 ——
        if (!opts.skipMh4) {
          const candidates = await loadPdpEnrichCandidates(db, opts.workspace, {
            brand_key: brand.brand_key,
            top: opts.mh4Top,
            only_missing: true,
          })
          console.error(`[cycle] MH-4 candidates=${candidates.length} (top ${opts.mh4Top})`)
          let mh4Ok = 0
          let mh4Fail = 0
          const paths = {}
          for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i]
            console.error(
              `[cycle] mh4 ${i + 1}/${candidates.length} ${c.sold_label || c.sold_count_lower_bound || '?'} ${(c.title || '').slice(0, 36)}`,
            )
            const enriched = await openAndEnrichPdp(page, c.listing_url, {
              computer: true,
              pauseAfterLoad: opts.pauseAfterLoad,
              step: opts.step,
            })
            if (!enriched.breadcrumb?.ok) {
              mh4Fail++
              if (enriched.session_health === 'blocked' || enriched.session_health === 'login_required') {
                console.error('[cycle] MH-4 captcha stop — re-run later --skip-list for this brand')
                brandResult.error = 'mh4_captcha'
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
            mh4Ok++
            const leaf = written.platform_category_leaf || '—'
            paths[leaf] = (paths[leaf] || 0) + 1
            if (i + 1 < candidates.length && opts.delayMs > 0) await sleep(opts.delayMs)
          }
          brandResult.mh4 = { ok: mh4Ok, failed: mh4Fail, paths }
          summary.mh4_ok += mh4Ok
          patchBrandState(state, brand.brand_key, {
            mh4_ok: mh4Ok > 0,
            mh4_count: mh4Ok,
            mh4_at: new Date().toISOString(),
            mh4_paths: paths,
            mh4_error: brandResult.error || null,
          })
          saveCycleState(opts.statePath, state)
        }

        if (!brandResult.error) summary.brands_ok++
        else summary.brands_failed++
        summary.results.push(brandResult)
        console.error(
          `[cycle] done ${brand.brand_key}: list=${brandResult.list?.products ?? 'skip'} mh4=${brandResult.mh4?.ok ?? 'skip'}`,
        )
      } catch (e) {
        brandResult.error = e?.message || String(e)
        summary.brands_failed++
        summary.results.push(brandResult)
        patchBrandState(state, brand.brand_key, {
          last_error: brandResult.error,
        })
        saveCycleState(opts.statePath, state)
        console.error(`[cycle] error ${brand.brand_key}:`, brandResult.error)
      }

      await sleep(opts.delayMs)
    }
  } finally {
    if (connected) browser.disconnect()
    else await browser.close().catch(() => {})
  }

  saveCycleState(opts.statePath, state)
  console.log(JSON.stringify({ summary, state_file: opts.statePath }, null, 2))
  process.exitCode = summary.brands_ok > 0 || summary.list_products > 0 || summary.mh4_ok > 0 ? 0 : 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
