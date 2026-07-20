#!/usr/bin/env node
/**
 * MH-2 — Harvest All Products (sortBy=pop) for Mall shops with confirmed shop_username.
 *
 * Uses Puppeteer + warm Chrome profile (Track G). Not cold headless by default.
 *
 * Usage:
 *   node scripts/mall-all-products-harvest.mjs --workspace <uuid> --pilot-only --max-pages 3
 *   node scripts/mall-all-products-harvest.mjs --workspace <uuid> --brand beauty-of-joseon --max-pages 2
 *   node scripts/mall-all-products-harvest.mjs --workspace <uuid> --pilot-only --dry-run
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   SHOPEE_PROFILE_DIR          default .shopee-chrome-profile
 *   SHOPEE_INTERACTIVE=1        wait on captcha
 *   SHOPEE_CAPTCHA_WAIT_MS      default 180000
 *   SHOPEE_HEADLESS=1           headless (not recommended for first runs)
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import { PILOT_BRAND_KEYS } from '../marketplace/brandKey.mjs'
import {
  harvestBrandAllProducts,
  loadHarvestTargets,
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
    maxPages: 3,
    delayMs: 4500,
    dryRun: false,
    interactive: process.env.SHOPEE_INTERACTIVE !== '0',
    headless: process.env.SHOPEE_HEADLESS === '1',
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
    } else if (a === '--max-pages') opts.maxPages = Number(argv[++i])
    else if (a === '--delay-ms') opts.delayMs = Number(argv[++i])
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--headed') opts.headless = false
    else if (a === '--headless') opts.headless = true
    else if (a === '--no-interactive') opts.interactive = false
    else if (a === '--help' || a === '-h') {
      console.log(`mall-all-products-harvest.mjs --workspace <uuid> [--pilot-only] [--brand key] [--max-pages 3]`)
      process.exit(0)
    }
  }
  if (opts.pilotOnly && !opts.brandKeys) opts.brandKeys = [...PILOT_BRAND_KEYS]
  return opts
}

async function main() {
  loadDotEnv()
  // Prefer warm profile over cookie jar fight
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

  // If pilot-only with brand keys list, still filter to those with shop
  const withShop = targets.filter((t) => t.shop_username)
  const missingShop = (opts.brandKeys || PILOT_BRAND_KEYS).filter(
    (k) => !withShop.some((t) => t.brand_key === k),
  )

  console.log(
    JSON.stringify(
      {
        workspace_id: opts.workspace,
        dry_run: opts.dryRun,
        max_pages: opts.maxPages,
        headless: opts.headless,
        interactive: opts.interactive,
        targets: withShop.map((t) => ({ brand_key: t.brand_key, shop: t.shop_username })),
        missing_shop_username: missingShop,
      },
      null,
      2,
    ),
  )

  if (!withShop.length) {
    console.error('No brands with shop_username. Run MH-1 / extension confirm shops first.')
    process.exit(1)
  }

  if (opts.dryRun) {
    console.log('Dry-run: would harvest All Products for targets above')
    process.exit(0)
  }

  const profileDir = resolve(ROOT, opts.profileDir)
  mkdirSync(profileDir, { recursive: true })

  const browser = await puppeteer.launch({
    headless: opts.headless,
    userDataDir: profileDir,
    defaultViewport: { width: 1365, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
  })

  const summary = {
    ok: 0,
    failed: 0,
    products: 0,
    stop_batch: false,
    results: [],
  }

  try {
    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    )

    for (const brand of withShop) {
      try {
        const result = await harvestBrandAllProducts(page, brand, db, {
          workspace_id: opts.workspace,
          max_pages: opts.maxPages,
          delay_ms: opts.delayMs,
          interactive: opts.interactive,
          captchaWaitMs: Number(process.env.SHOPEE_CAPTCHA_WAIT_MS || 180000),
          dry_run: false,
        })
        summary.results.push(result)
        if (result.stop_batch) {
          summary.stop_batch = true
          summary.failed++
          console.error('[mall-harvest] batch stopped — refresh profile login / captcha, re-run')
          break
        }
        if (result.product_count > 0) {
          summary.ok++
          summary.products += result.product_count
        } else {
          summary.failed++
        }
        console.error(
          `[mall-harvest] done ${brand.brand_key}: ${result.product_count} products (${result.with_sold} with sold)`,
        )
      } catch (e) {
        summary.failed++
        summary.results.push({
          brand_key: brand.brand_key,
          error: e?.message || String(e),
        })
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
