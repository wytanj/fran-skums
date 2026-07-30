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
  humanPreNavPause,
  jitterMs,
  resetSessionNavCount,
  withComputerDefaults,
} from '../marketplace/computerHarvest.mjs'
import {
  bounceChromeCdp,
  defaultShopeeProfileDir,
} from '../marketplace/chromeCdpBounce.mjs'
import { createHarvestNotifier, nullNotifier } from '../marketplace/harvestNotify.mjs'
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
    delayMs: 11000,
    maxConsecutiveBlocked: 3,
    blockedCooldownMs: 6 * 60 * 60 * 1000,
    recoveryMinutes: 15,
    notify: true,
    // NEVER default-kill Chrome on captcha when --connect (wipes human solves).
    // Opt in with --bounce-on-captcha for unattended-only experiments.
    bounceOnCaptcha: false,
    // Humanize: pre-nav settle + gap between brands (ms)
    preNavMinMs: 5000,
    preNavMaxMs: 15000,
    brandGapMinMs: 12000,
    brandGapMaxMs: 35000,
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
    else if (a === '--delay-ms') opts.delayMs = Number(argv[++i]) || 11000
    else if (a === '--pre-nav-min-sec') opts.preNavMinMs = Math.max(Number(argv[++i]) || 5, 0) * 1000
    else if (a === '--pre-nav-max-sec') opts.preNavMaxMs = Math.max(Number(argv[++i]) || 15, 0) * 1000
    else if (a === '--brand-gap-min-sec') opts.brandGapMinMs = Math.max(Number(argv[++i]) || 12, 0) * 1000
    else if (a === '--brand-gap-max-sec') opts.brandGapMaxMs = Math.max(Number(argv[++i]) || 35, 0) * 1000
    else if (a === '--fast') {
      // Escape hatch for debugging — more captcha-prone
      opts.preNavMinMs = 800
      opts.preNavMaxMs = 2000
      opts.brandGapMinMs = 2000
      opts.brandGapMaxMs = 5000
      opts.delayMs = 4000
    } else if (a === '--max-consecutive-blocked') {
      opts.maxConsecutiveBlocked = Math.max(Number(argv[++i]) || 3, 1)
    } else if (a === '--cooldown-hours') {
      opts.blockedCooldownMs = Math.max(Number(argv[++i]) || 6, 0) * 60 * 60 * 1000
    } else if (a === '--recovery-minutes') {
      opts.recoveryMinutes = Math.max(Number(argv[++i]) || 15, 1)
    } else if (a === '--no-notify') opts.notify = false
    else if (a === '--bounce-on-captcha') opts.bounceOnCaptcha = true
    else if (a === '--no-bounce-on-captcha') opts.bounceOnCaptcha = false
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
  --delay-ms N         Base gap between pages/PDPs (default 11000, then jittered)
  --pre-nav-min-sec N  Settle before each navigation (default 5)
  --pre-nav-max-sec N  (default 15)
  --brand-gap-min-sec N  Pause between brands (default 12)
  --brand-gap-max-sec N  (default 35)
  --fast               Short humanize delays (debug only; more captcha)
  --max-consecutive-blocked N   Abort run after N brands block back-to-back (default 3)
  --cooldown-hours N   Skip a blocked brand for N hours on re-run (default 6)
  --recovery-minutes N Poll this long for a human to clear a captcha (default 15)
  --no-notify          Suppress blocked/recovered pings (Phase N)

Humanize defaults aim to reduce captcha ramps on 80+ brand runs (not a bypass).
Unattended: needs no TTY. On a captcha it polls, pings via
SKUMS_API_BASE + MARKETPLACE_CRON_SECRET, and moves on after the deadline.

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

  // Stable per-run id so a shelf that flaps does not spam the channel —
  // the server dedupes on (event, brand, run).
  const runId = `cycle-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const notifier = opts.notify
    ? createHarvestNotifier({ workspaceId: opts.workspace, runId })
    : nullNotifier()

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

  // MH-8: a brand that blocked recently stays cooled down across runs.
  const cooledDown = []
  brands = brands.filter((t) => {
    const until = state.brands[t.brand_key]?.cooldown_until
    if (!until) return true
    if (Date.parse(until) <= Date.now()) return true
    cooledDown.push({ brand_key: t.brand_key, cooldown_until: until })
    return false
  })
  if (cooledDown.length) {
    console.error(
      `[cycle] skipping ${cooledDown.length} brand(s) still cooling down: ${cooledDown
        .map((c) => c.brand_key)
        .join(', ')}`,
    )
  }

  // Only brands we genuinely can't harvest — a cooled-down brand has a shop,
  // it is just resting, and reporting it as unlinked sends ops to the wrong fix.
  const missingShop = (opts.brandKeys || []).filter(
    (k) =>
      !brands.some((t) => t.brand_key === k) &&
      !cooledDown.some((c) => c.brand_key === k),
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
        cooling_down: cooledDown,
        max_consecutive_blocked: opts.maxConsecutiveBlocked,
        recovery_minutes: opts.recoveryMinutes,
        notifications: notifier.enabled ? 'on' : 'off (set SKUMS_API_BASE + MARKETPLACE_CRON_SECRET)',
        unattended_ready: !process.stdin.isTTY ? 'yes (no TTY — polling only)' : 'yes (TTY: Enter accelerates)',
        state_file: opts.statePath,
      },
      null,
      2,
    ),
  )

  if (!brands.length) {
    console.error(
      cooledDown.length
        ? `[cycle] Nothing to do — all ${cooledDown.length} matching brand(s) are still cooling down after a block. Wait, or lower --cooldown-hours.`
        : '[cycle] No brands with shop_username. Link shops in the extension first.',
    )
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

  // New browser attach = new Shopee trust session for pre-nav warm-up logic
  resetSessionNavCount()

  let browser
  let connected = false
  const cdpUrl = opts.connect || 'http://127.0.0.1:9222'
  let cdpPort = 9222
  try {
    const u = new URL(cdpUrl)
    cdpPort = Number(u.port) || 9222
  } catch {
    /* keep 9222 */
  }

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

  // Shared page bag so captcha Chrome-bounce can rebind list + MH-4 navigations.
  const pageBag = { current: null }
  let bounceInFlight = null
  let bounceCount = 0
  const MAX_BOUNCES_PER_CYCLE = 4

  async function bounceChromeOnCaptcha(info = {}) {
    // Default OFF: taskkill+relaunch wipes a human captcha solve and often
    // immediately re-walls. Only with --bounce-on-captcha (unattended experiments).
    if (!opts.connect || !opts.bounceOnCaptcha) {
      console.error(
        '[cycle] captcha bounce disabled — keep Chrome open and solve captcha; harvest will poll',
      )
      return pageBag.current
    }
    if (bounceInFlight) return bounceInFlight
    if (bounceCount >= MAX_BOUNCES_PER_CYCLE) {
      console.error(
        `[cycle] captcha bounce cap (${MAX_BOUNCES_PER_CYCLE}) — solve manually or re-run`,
      )
      return pageBag.current
    }
    bounceCount++
    bounceInFlight = (async () => {
      console.error(
        `[cycle] captcha bounce #${bounceCount}: close Chrome → wait → relaunch CDP → settle 10s` +
          (info.label ? ` (${info.label})` : ''),
      )
      try {
        try {
          browser.disconnect()
        } catch {
          /* already dead */
        }
        await bounceChromeCdp({
          profileDir: profileDir || defaultShopeeProfileDir(ROOT),
          port: cdpPort,
          killWaitMs: 2500,
          settleMs: 10000,
          startUrl: 'https://shopee.sg/',
          log: (m) => console.error(m),
        })
        const c = await connectComputerBrowser(cdpUrl)
        browser = c.browser
        connected = true
        resetSessionNavCount()
        const pages = await browser.pages()
        pageBag.current =
          pages.find((p) => /shopee\.sg/i.test(p.url() || '')) ||
          pages[pages.length - 1] ||
          (await browser.newPage())
        console.error('[cycle] re-attached after captcha bounce')
        return pageBag.current
      } finally {
        bounceInFlight = null
      }
    })()
    return bounceInFlight
  }

  const summary = {
    brands_ok: 0,
    brands_failed: 0,
    brands_blocked: 0,
    list_products: 0,
    mh4_ok: 0,
    aborted: null,
    results: [],
  }

  // MH-8: one blocked shop must not kill the other 124. Abort the whole run
  // only when blocks come back-to-back — that means the session itself died,
  // not that a single storefront is being difficult.
  let consecutiveBlocked = 0

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
    pageBag.current = page

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
      recoveryDeadlineMs: opts.recoveryMinutes * 60 * 1000,
      delay_ms: opts.delayMs,
      shelf_delay_ms: Math.max(opts.delayMs, 12000),
      preNavMinMs: opts.preNavMinMs,
      preNavMaxMs: Math.max(opts.preNavMinMs, opts.preNavMaxMs),
      pageBag,
      bounceChromeOnCaptcha:
        opts.connect && opts.bounceOnCaptcha ? bounceChromeOnCaptcha : null,
    }
    harvestOpts = withComputerDefaults(harvestOpts)
    harvestOpts.pauseAfterLoad = opts.pauseAfterLoad
    harvestOpts.delay_ms = opts.delayMs
    harvestOpts.shelf_delay_ms = Math.max(opts.delayMs, harvestOpts.shelf_delay_ms || 0)
    harvestOpts.preNavMinMs = opts.preNavMinMs
    harvestOpts.preNavMaxMs = Math.max(opts.preNavMinMs, opts.preNavMaxMs)
    harvestOpts.pageBag = pageBag
    harvestOpts.bounceChromeOnCaptcha =
      opts.connect && opts.bounceOnCaptcha ? bounceChromeOnCaptcha : null

    console.error(
      `[cycle] humanize: pre-nav ${opts.preNavMinMs / 1000}-${opts.preNavMaxMs / 1000}s · ` +
        `page delay ~${opts.delayMs}ms · brand gap ${opts.brandGapMinMs / 1000}-${opts.brandGapMaxMs / 1000}s`,
    )

    // Rebound per brand so the ping names the right shop.
    let notifyContext = { brand_key: null, shop_username: null }
    harvestOpts.onBlocked = async ({ label, health }) =>
      notifier.blocked({ ...notifyContext, shelf: label || null, health: health || null })
    harvestOpts.onResolved = async ({ health, recovered, waitedMs }) =>
      notifier.recovered({
        ...notifyContext,
        health: health || null,
        recovered,
        waited_ms: waitedMs,
      })

    for (let bi = 0; bi < brands.length; bi++) {
      const brand = brands[bi]
      notifyContext = { brand_key: brand.brand_key, shop_username: brand.shop_username }
      const brandResult = {
        brand_key: brand.brand_key,
        shop: brand.shop_username,
        list: null,
        mh4: null,
        error: null,
      }
      console.error(`\n[cycle] ========== ${brand.brand_key} @${brand.shop_username} ==========`)

      // Inter-brand settle (skip before first brand — pre-nav covers first goto)
      if (bi > 0) {
        await humanPreNavPause({
          minMs: opts.brandGapMinMs,
          maxMs: Math.max(opts.brandGapMinMs, opts.brandGapMaxMs),
          label: `between brands (${brands[bi - 1].brand_key} → ${brand.brand_key})`,
        })
      }

      try {
        // —— MH-2 / MH-3 ——
        if (!opts.skipList) {
          console.error(`[cycle] list harvest mode=${opts.listMode} max_pages=${opts.maxPages}`)
          let listResult
          page = pageBag.current || page
          if (opts.listMode === 'all') {
            listResult = await harvestBrandAllProducts(page, brand, db, harvestOpts)
          } else {
            listResult = await harvestBrandCollections(page, brand, db, {
              ...harvestOpts,
              mode: opts.listMode === 'both' ? 'both' : 'collections',
            })
          }
          page = pageBag.current || page
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
            // MH-8: cool this brand down and keep going. Abort the whole run
            // only if blocks are consecutive (session death, not one bad shop).
            brandResult.error = listResult.stop_reason || 'stop_batch'
            brandResult.blocked = true
            consecutiveBlocked++
            summary.brands_blocked++
            summary.brands_failed++
            summary.results.push(brandResult)
            patchBrandState(state, brand.brand_key, {
              blocked_at: new Date().toISOString(),
              blocked_reason: brandResult.error,
              cooldown_until: new Date(Date.now() + opts.blockedCooldownMs).toISOString(),
            })
            saveCycleState(opts.statePath, state)

            if (consecutiveBlocked >= opts.maxConsecutiveBlocked) {
              summary.aborted = `${consecutiveBlocked} consecutive brands blocked — session likely dead`
              console.error(
                `[cycle] ${summary.aborted}. Fix captcha/login in Chrome, re-run with --skip-done`,
              )
              break
            }

            console.error(
              `[cycle] ${brand.brand_key} blocked (${consecutiveBlocked}/${opts.maxConsecutiveBlocked}) — cooling down, next brand`,
            )
            // Extra rest after a wall so Shopee does not escalate on the next shop
            await humanPreNavPause({
              minMs: Math.max(opts.brandGapMinMs, 20000),
              maxMs: Math.max(opts.brandGapMaxMs, 45000),
              label: `post-block cool (${brand.brand_key})`,
            })
            continue
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
          if (candidates.length === 0) {
            // Clear MH-4 backlog: nothing left to enrich for this brand
            patchBrandState(state, brand.brand_key, {
              mh4_ok: true,
              mh4_count: 0,
              mh4_at: new Date().toISOString(),
              mh4_paths: {},
              mh4_error: 'no_candidates',
            })
            saveCycleState(opts.statePath, state)
            brandResult.mh4 = { ok: 0, failed: 0, paths: {}, note: 'no_candidates' }
            console.error('[cycle] MH-4: no candidates — marked complete (no_candidates)')
          }
          for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i]
            console.error(
              `[cycle] mh4 ${i + 1}/${candidates.length} ${c.sold_label || c.sold_count_lower_bound || '?'} ${(c.title || '').slice(0, 36)}`,
            )
            page = pageBag.current || page
            const enriched = await openAndEnrichPdp(page, c.listing_url, {
              computer: true,
              pauseAfterLoad: opts.pauseAfterLoad,
              step: opts.step,
              maxWaitMs: opts.recoveryMinutes * 60 * 1000,
              onBlocked: harvestOpts.onBlocked,
              onResolved: harvestOpts.onResolved,
              bounceChromeOnCaptcha: harvestOpts.bounceChromeOnCaptcha,
              pageBag,
            })
            page = pageBag.current || page
            if (!enriched.breadcrumb?.ok) {
              mh4Fail++
              if (enriched.session_health === 'blocked' || enriched.session_health === 'login_required') {
                // Post-MH-8 this is the health *after* retries, so it is a real block.
                console.error('[cycle] MH-4 captcha stop — re-run later --skip-list for this brand')
                brandResult.error = 'mh4_captcha'
                brandResult.blocked = true
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
            if (i + 1 < candidates.length && opts.delayMs > 0) {
              const gap = jitterMs(opts.delayMs, 0.35)
              console.error(`[cycle] mh4 gap ${Math.round(gap / 1000)}s`)
              await sleep(gap)
            }
          }
          if (candidates.length > 0) {
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
          // candidates.length === 0 already patched as mh4_ok + no_candidates above
        }

        if (!brandResult.error) {
          summary.brands_ok++
          consecutiveBlocked = 0
        } else {
          summary.brands_failed++
          if (brandResult.blocked) {
            consecutiveBlocked++
            summary.brands_blocked++
            patchBrandState(state, brand.brand_key, {
              blocked_at: new Date().toISOString(),
              blocked_reason: brandResult.error,
              cooldown_until: new Date(Date.now() + opts.blockedCooldownMs).toISOString(),
            })
            saveCycleState(opts.statePath, state)
          }
        }
        summary.results.push(brandResult)

        if (brandResult.blocked && consecutiveBlocked >= opts.maxConsecutiveBlocked) {
          summary.aborted = `${consecutiveBlocked} consecutive brands blocked — session likely dead`
          console.error(
            `[cycle] ${summary.aborted}. Fix captcha/login in Chrome, re-run with --skip-done`,
          )
          break
        }
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

  const didWork = summary.brands_ok > 0 || summary.list_products > 0 || summary.mh4_ok > 0
  // 2 = session died mid-run (matches the stop_batch convention in
  // windows-marketplace-weekly). A scheduler should treat this as "needs a
  // human", not as a clean pass, even when earlier brands succeeded.
  process.exitCode = summary.aborted ? 2 : didWork ? 0 : 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
