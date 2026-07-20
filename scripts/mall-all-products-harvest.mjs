#!/usr/bin/env node
/**
 * MH-2 / MH-3 — Mall harvest for official Shopee shops.
 *
 * Modes:
 *   all           All Products only (MH-2 default)
 *   collections   Each metadata.shop_collections shelf except All Products (MH-3)
 *   both          All Products then each collection
 *
 * Usage:
 *   node scripts/mall-all-products-harvest.mjs --workspace <uuid> --brand beauty-of-joseon --mode all
 *   node scripts/mall-all-products-harvest.mjs --workspace <uuid> --brand beauty-of-joseon --mode collections
 *   node scripts/mall-all-products-harvest.mjs --workspace <uuid> --brand beauty-of-joseon --mode both --max-pages 2
 *   node scripts/mall-all-products-harvest.mjs --workspace <uuid> --pilot-only --mode collections --dry-run
 *
 * Computer mode (mode B — captcha-friendly, watch & intervene):
 *   --computer   headed + real mouse/scroll + Enter on captcha
 *   --step       also pause for Enter after each page extract
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SHOPEE_PROFILE_DIR, SHOPEE_INTERACTIVE
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import { PILOT_BRAND_KEYS } from '../marketplace/brandKey.mjs'
import {
  computerBrowserLaunchOptions,
  withComputerDefaults,
} from '../marketplace/computerHarvest.mjs'
import {
  harvestBrandAllProducts,
  harvestBrandCollections,
  loadHarvestTargets,
  resolveShelvesForBrand,
} from '../marketplace/mallHarvestWorker.mjs'

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
    pilotOnly: false,
    brandKeys: null,
    mode: 'all', // all | collections | both
    collectionNames: null,
    maxPages: 3,
    delayMs: 4500,
    delayMsExplicit: false,
    dryRun: false,
    interactive: process.env.SHOPEE_INTERACTIVE !== '0',
    headless: process.env.SHOPEE_HEADLESS === '1',
    computer: false,
    step: false,
    profileDir: process.env.SHOPEE_PROFILE_DIR || '.shopee-chrome-profile',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workspace' || a === '-w') opts.workspace = argv[++i]
    else if (a === '--pilot-only') opts.pilotOnly = true
    else if (a === '--brand' || a === '--brands') {
      opts.brandKeys = String(argv[++i] || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    } else if (a === '--mode') opts.mode = String(argv[++i] || 'all').toLowerCase()
    else if (a === '--collections') {
      opts.mode = 'collections'
      const names = argv[i + 1]
      if (names && !names.startsWith('--')) {
        opts.collectionNames = String(argv[++i])
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      }
    } else if (a === '--max-pages') opts.maxPages = Number(argv[++i])
    else if (a === '--delay-ms') {
      opts.delayMs = Number(argv[++i])
      opts.delayMsExplicit = true
    } else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--headed') opts.headless = false
    else if (a === '--headless') opts.headless = true
    else if (a === '--computer') {
      opts.computer = true
      opts.headless = false
      opts.interactive = true
    } else if (a === '--step') {
      opts.step = true
      opts.computer = true
      opts.headless = false
      opts.interactive = true
    } else if (a === '--no-interactive') opts.interactive = false
    else if (a === '--help' || a === '-h') {
      console.log(`mall-all-products-harvest.mjs --workspace <uuid> [--mode all|collections|both] [--brand key]

Shelf modes:
  --mode all           All Products only (MH-2)
  --mode collections   Each MH-1 shop_collections shelf (MH-3)
  --mode both          All Products then each collection

Runtime styles:
  (default)            Script-style: faster goto+scroll, timed captcha wait
  --computer           Computer-style: headed, mouse moves, wheel scroll, Enter on captcha
  --step               Computer + pause after every page (press Enter to continue)

Example (recommended when captcha is likely):
  node scripts/mall-all-products-harvest.mjs -w <uuid> --brand beauty-of-joseon --mode both --computer --max-pages 2`)
      process.exit(0)
    }
  }
  if (!['all', 'collections', 'both'].includes(opts.mode)) opts.mode = 'all'
  if (opts.pilotOnly && !opts.brandKeys) opts.brandKeys = [...PILOT_BRAND_KEYS]
  return opts
}

async function main() {
  loadDotEnv()
  delete process.env.SHOPEE_SG_SESSION_JSON

  const opts = parseArgs(process.argv.slice(2))
  if (!opts.workspace) {
    console.error('Need --workspace')
    process.exit(1)
  }

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
  const targets = await loadHarvestTargets(db, opts.workspace, {
    brand_keys: opts.brandKeys,
    pilot_only: opts.pilotOnly && !opts.brandKeys,
    require_shop: true,
  })

  const withShop = targets.filter((t) => t.shop_username)
  const missingShop = (opts.brandKeys || []).filter(
    (k) => !withShop.some((t) => t.brand_key === k),
  )
  const missingCollections =
    opts.mode !== 'all'
      ? withShop.filter(
          (t) =>
            !Array.isArray(t.metadata?.shop_collections) ||
            !t.metadata.shop_collections.some((c) => c.shop_collection_id),
        )
      : []

  console.log(
    JSON.stringify(
      {
        workspace_id: opts.workspace,
        mode: opts.mode,
        runtime: opts.computer ? 'computer' : 'script',
        step: opts.step,
        dry_run: opts.dryRun,
        max_pages: opts.maxPages,
        headless: opts.headless,
        interactive: opts.interactive,
        targets: withShop.map((t) => ({
          brand_key: t.brand_key,
          shop: t.shop_username,
          shelves: resolveShelvesForBrand(t, {
            mode: opts.mode,
            collection_names: opts.collectionNames,
          }).map((s) => s.name),
        })),
        missing_shop_username: missingShop,
        missing_mh1_collections: missingCollections.map((t) => t.brand_key),
      },
      null,
      2,
    ),
  )

  if (!withShop.length) {
    console.error('No brands with shop_username. Confirm shops (extension) first.')
    process.exit(1)
  }

  if (opts.mode !== 'all' && missingCollections.length === withShop.length) {
    console.error('No shop_collections on targets. Run MH-1 discover collections first.')
    process.exit(1)
  }

  if (opts.dryRun) {
    console.log(`Dry-run: would harvest mode=${opts.mode} for targets above`)
    process.exit(0)
  }

  const profileDir = resolve(ROOT, opts.profileDir)
  mkdirSync(profileDir, { recursive: true })

  if (opts.computer) {
    console.error('[computer] Mode B: headed Chrome + mouse/scroll. Keep this terminal focused for Enter pauses.')
    console.error('[computer] Solve any captcha in the Chrome window, then press Enter here when asked.')
  }

  const launchOpts = opts.computer
    ? computerBrowserLaunchOptions({ profileDir })
    : {
        headless: opts.headless,
        userDataDir: profileDir,
        defaultViewport: { width: 1365, height: 900 },
        args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
      }

  const browser = await puppeteer.launch(launchOpts)

  const summary = {
    mode: opts.mode,
    runtime: opts.computer ? 'computer' : 'script',
    ok: 0,
    failed: 0,
    products: 0,
    stop_batch: false,
    results: [],
  }

  try {
    const page = await browser.newPage()
    if (!opts.computer) {
      await page.setViewport({ width: 1365, height: 900 })
    }
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    )

    let harvestOpts = {
      workspace_id: opts.workspace,
      max_pages: opts.maxPages,
      delay_ms: opts.delayMs,
      interactive: opts.interactive,
      captchaWaitMs: Number(process.env.SHOPEE_CAPTCHA_WAIT_MS || 180000),
      dry_run: false,
      collection_names: opts.collectionNames,
      mode: opts.mode === 'both' ? 'both' : 'collections',
      computer: opts.computer,
      step: opts.step,
    }
    if (opts.computer) {
      // Computer pacing defaults unless user passed --delay-ms
      const base = opts.delayMsExplicit
        ? harvestOpts
        : { ...harvestOpts, delay_ms: undefined, shelf_delay_ms: undefined }
      harvestOpts = withComputerDefaults(base)
      if (opts.delayMsExplicit) harvestOpts.delay_ms = opts.delayMs
    }

    for (const brand of withShop) {
      try {
        let result
        if (opts.mode === 'all') {
          result = await harvestBrandAllProducts(page, brand, db, harvestOpts)
          summary.results.push(result)
          if (result.stop_batch) {
            summary.stop_batch = true
            summary.failed++
            break
          }
          if (result.product_count > 0) {
            summary.ok++
            summary.products += result.product_count
          } else summary.failed++
        } else {
          result = await harvestBrandCollections(page, brand, db, harvestOpts)
          summary.results.push(result)
          if (result.stop_batch) {
            summary.stop_batch = true
            summary.failed++
            break
          }
          if (result.product_count > 0) {
            summary.ok++
            summary.products += result.product_count
          } else if (result.error) {
            summary.failed++
          } else summary.failed++
        }
        console.error(
          `[mall-harvest] done ${brand.brand_key}: products=${result.product_count || 0}` +
            (result.shelves_done != null ? ` shelves=${result.shelves_done}` : ''),
        )
      } catch (e) {
        summary.failed++
        summary.results.push({ brand_key: brand.brand_key, error: e?.message || String(e) })
        console.error(`[mall-harvest] error ${brand.brand_key}:`, e?.message || e)
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }

  console.log(JSON.stringify(summary, null, 2))
  if (summary.stop_batch || (summary.failed && !summary.ok)) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
