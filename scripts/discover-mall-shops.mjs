#!/usr/bin/env node
/**
 * Automate finding Shopee Mall / official shop_username for brand universe rows.
 *
 * Uses warm Windows Chrome session (cookies) + SERP + /shop/{id} redirect.
 * Writes candidate or confirmed onto marketplace_brand_universe.
 * Optionally re-materializes seeds (shop primary when confirmed).
 *
 * Usage:
 *   node scripts/discover-mall-shops.mjs --workspace <uuid>
 *   node scripts/discover-mall-shops.mjs --workspace <uuid> --pilot-only
 *   node scripts/discover-mall-shops.mjs --workspace <uuid> --brand anua,cosrx
 *   node scripts/discover-mall-shops.mjs --workspace <uuid> --limit 5 --materialize
 *   node scripts/discover-mall-shops.mjs --workspace <uuid> --dry-run
 *
 * Env:
 *   SHOPEE_SG_SESSION_JSON or sample-cookie.json + SHOPEE_USE_COOKIE_FILE=1
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   SHOPEE_INTERACTIVE=1  (optional captcha)
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import { discoverMallShopWithPuppeteer } from '../marketplace/collectors/shopee-puppeteer/discoverShop.mjs'
import { universePatchFromDiscovery } from '../marketplace/discoverMallShop.mjs'
import { PILOT_BRAND_KEYS } from '../marketplace/brandKey.mjs'
import {
  buildSeedsForUniverse,
  seedUpsertConflictColumns,
} from '../marketplace/materializeBrandSeeds.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return
  const text = readFileSync(filePath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key] !== undefined) continue
    let value = rawValue.trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function parseArgs(argv) {
  const opts = {
    workspace: null,
    pilotOnly: false,
    brandKeys: null,
    limit: 50,
    dryRun: false,
    materialize: false,
    skipConfirmed: true,
    probeHeuristics: true,
    autoConfirm: true,
    delayMs: 5000,
    headless: process.env.SHOPEE_HEADLESS === '1',
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
    } else if (a === '--limit') opts.limit = Number(argv[++i])
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--materialize') opts.materialize = true
    else if (a === '--include-confirmed') opts.skipConfirmed = false
    else if (a === '--no-heuristics') opts.probeHeuristics = false
    else if (a === '--no-auto-confirm') opts.autoConfirm = false
    else if (a === '--delay-ms') opts.delayMs = Number(argv[++i])
    else if (a === '--headed') opts.headless = false
    else if (a === '--help' || a === '-h') {
      console.log(`discover-mall-shops.mjs --workspace <uuid> [--pilot-only] [--brand a,b] [--materialize]`)
      process.exit(0)
    }
  }
  return opts
}

function loadCookiesIntoEnv() {
  if (process.env.SHOPEE_SG_SESSION_JSON) return true
  const cookiePath = resolve(ROOT, 'sample-cookie.json')
  if (process.env.SHOPEE_USE_COOKIE_FILE === '1' && existsSync(cookiePath)) {
    process.env.SHOPEE_SG_SESSION_JSON = readFileSync(cookiePath, 'utf8')
    return true
  }
  if (existsSync(cookiePath)) {
    process.env.SHOPEE_SG_SESSION_JSON = readFileSync(cookiePath, 'utf8')
    console.error('[discover] loaded sample-cookie.json')
    return true
  }
  return false
}

async function main() {
  loadDotEnv(resolve(ROOT, '.env'))
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.workspace) {
    console.error('Missing --workspace')
    process.exit(1)
  }

  const hasCookies = loadCookiesIntoEnv()
  if (!hasCookies && !opts.dryRun) {
    console.error('Need SHOPEE_SG_SESSION_JSON or sample-cookie.json for live discovery')
    process.exit(1)
  }

  const url = process.env.SUPABASE_URL || process.env.NUXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY
  if (!url || !key) {
    console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const db = createClient(url, key, { auth: { persistSession: false } })

  let q = db
    .from('marketplace_brand_universe')
    .select('*')
    .eq('workspace_id', opts.workspace)
    .eq('enabled', true)
    .order('priority', { ascending: false })

  if (opts.pilotOnly) {
    q = q.eq('pilot_tier', 'pilot')
  }
  if (opts.brandKeys?.length) {
    q = q.in('brand_key', opts.brandKeys)
  } else if (!opts.pilotOnly) {
    // Default: mall/official interest or pilot
    q = q.or(
      `pilot_tier.eq.pilot,shopee_mall_interest.eq.true,official_interest.eq.true`,
    )
  }

  const { data: rows, error } = await q.limit(opts.limit)
  if (error) {
    console.error(error.message)
    process.exit(1)
  }

  let targets = rows || []
  if (opts.skipConfirmed) {
    targets = targets.filter((r) => r.shop_resolve_status !== 'confirmed' || !r.shop_username)
  }

  // Prefer pilot order if no brand filter
  if (opts.pilotOnly || !opts.brandKeys?.length) {
    const pilotSet = new Set(PILOT_BRAND_KEYS)
    targets.sort((a, b) => {
      const ap = pilotSet.has(a.brand_key) ? 0 : 1
      const bp = pilotSet.has(b.brand_key) ? 0 : 1
      if (ap !== bp) return ap - bp
      return (b.priority || 0) - (a.priority || 0)
    })
  }

  console.log(
    JSON.stringify(
      {
        workspace_id: opts.workspace,
        targets: targets.length,
        dry_run: opts.dryRun,
        brands: targets.map((t) => t.brand_key),
      },
      null,
      2,
    ),
  )

  if (!targets.length) {
    console.log('Nothing to resolve')
    process.exit(0)
  }

  if (opts.dryRun) {
    console.log('Dry-run: would discover for brands above (no browser, no DB writes)')
    process.exit(0)
  }

  const browser = await puppeteer.launch({
    headless: opts.headless,
    defaultViewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  })

  const browserApi = {
    getBrowser: async () => browser,
    createStealthPage: async (b) => {
      const page = await b.newPage()
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      )
      return page
    },
  }

  const summary = {
    confirmed: 0,
    candidate: 0,
    failed: 0,
    skipped: 0,
    stop_batch: false,
    results: [],
  }

  try {
    for (const row of targets) {
      console.error(`[discover] ${row.brand_key} (${row.display_name})…`)
      let resolved
      try {
        resolved = await discoverMallShopWithPuppeteer(
          {
            display_name: row.display_name,
            brand_key: row.brand_key,
            country: row.country || 'sg',
            max_pages: 1,
            probe_heuristics: opts.probeHeuristics,
            auto_confirm: opts.autoConfirm,
          },
          browserApi,
        )
      } catch (e) {
        resolved = { ok: false, status: 'failed', error: e?.message || String(e) }
      }

      const patch = universePatchFromDiscovery(resolved)
      // Don't overwrite a previously confirmed shop with failed discovery
      const isSessionBlock =
        String(resolved.error || '').includes('session_health=blocked') ||
        String(resolved.error || '').includes('session_health=login_required') ||
        resolved.session_health === 'blocked' ||
        resolved.session_health === 'login_required'

      if (!isSessionBlock || resolved.ok) {
        const { error: upErr } = await db
          .from('marketplace_brand_universe')
          .update(patch)
          .eq('id', row.id)
        if (upErr) console.error(`  update failed: ${upErr.message}`)
      }

      if (resolved.ok && resolved.status === 'confirmed') {
        summary.confirmed++
        console.error(`  → confirmed @${resolved.shop_username}`)
      } else if (resolved.ok && resolved.status === 'candidate') {
        summary.candidate++
        console.error(`  → candidate @${resolved.shop_username} (${resolved.source})`)
      } else {
        summary.failed++
        console.error(`  → failed: ${resolved.error || resolved.status}`)
      }

      summary.results.push({
        brand_key: row.brand_key,
        ok: resolved.ok,
        status: resolved.status,
        shop_username: resolved.shop_username || null,
        source: resolved.source || null,
        error: resolved.error || null,
      })

      // Match weekly collect: captcha stops the batch (refresh cookies + interactive re-run)
      if (isSessionBlock) {
        summary.stop_batch = true
        summary.stop_reason = resolved.error || `session_health=${resolved.session_health}`
        console.error(
          '[discover] stop_batch: captcha/login wall. Refresh cookies, then:\n' +
            '  SHOPEE_INTERACTIVE=1 node scripts/discover-mall-shops.mjs --workspace … --pilot-only --materialize',
        )
        break
      }

      if (opts.delayMs > 0) {
        await new Promise((r) => setTimeout(r, opts.delayMs))
      }
    }

    if (opts.materialize) {
      console.error('[discover] re-materializing seeds for updated brands…')
      const keys = summary.results.filter((r) => r.ok).map((r) => r.brand_key)
      if (keys.length) {
        const { data: updated } = await db
          .from('marketplace_brand_universe')
          .select('*')
          .eq('workspace_id', opts.workspace)
          .in('brand_key', keys)

        for (const universe of updated || []) {
          const plan = buildSeedsForUniverse(universe, {
            collector_id: 'shopee_puppeteer',
            enabled: true,
          })
          const primary = { ...plan.primary, workspace_id: opts.workspace }
          await db
            .from('marketplace_crawl_seeds')
            .upsert(primary, { onConflict: seedUpsertConflictColumns() })
          if (plan.secondary) {
            await db
              .from('marketplace_crawl_seeds')
              .upsert(
                { ...plan.secondary, workspace_id: opts.workspace },
                { onConflict: seedUpsertConflictColumns() },
              )
          }
        }
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }

  console.log(JSON.stringify(summary, null, 2))
  if (summary.failed && !summary.confirmed && !summary.candidate) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
