/**
 * Keep harvesting linked brands that still need list data.
 * Silent success; only prints errors. Log: .harvest-queue.log
 *
 *   node scripts/_harvest_queue.mjs -w <uuid> --connect
 *   node scripts/_harvest_queue.mjs -w <uuid> --connect --sort-by sales
 *   node scripts/_harvest_queue.mjs -w <uuid> --connect --sort-by sales --babysit
 *
 * sortBy=pop (default): list_ok + mh4_ok (lifetime popular + breadcrumbs)
 * sortBy=sales (MH-14): list_sales_ok + mh4_ok (Top Sales rank + breadcrumbs)
 *   Lifetime sold badge still on cards; ranks are sales-sort position, not monthly units.
 */
import { createClient } from '@supabase/supabase-js'
import { spawn, execSync } from 'node:child_process'
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultCycleStatePath,
  loadCycleState,
  saveCycleState,
  patchBrandState,
} from '../marketplace/mallCycleState.mjs'
import { isMultiBrandDistributor } from '../marketplace/distributorShop.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const LOG = resolve(ROOT, '.harvest-queue.log')

function loadDotEnv() {
  const p = resolve(ROOT, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const k = t.slice(0, i)
    let v = t.slice(i + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    if (process.env[k] === undefined) process.env[k] = v
  }
}

function log(msg) {
  appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function parseArgs(argv) {
  const opts = {
    workspace: 'c21c057f-ea01-4e19-bc79-fafcf2626b19',
    cdp: 'http://127.0.0.1:9222',
    // Balanced overnight: All Products list (faster) + full MH-4 PDPs.
    // Use --list-mode both when shelf stamps matter more than speed.
    listMode: 'all',
    // Default deep enough for full Mall catalogs (stop-on-empty in worker).
    // Overnight MH-14 sales runs may still pass --max-pages 2 explicitly.
    maxPages: 12,
    // PDP platform-category / price / rating sample (keep — needed).
    mh4Top: 40,
    // Page/PDP gap base (cycle default 11000). Use --babysit / --fast when human is watching.
    delayMs: 7000,
    brandGapMinSec: 8,
    brandGapMaxSec: 20,
    preNavMinSec: 5,
    preNavMaxSec: 15,
    recoveryMinutes: 15,
    // Hard cap per brand (ms). More PDPs need more headroom.
    brandTimeoutMs: 90 * 60 * 1000,
    // Kill if no stdout/stderr for this long (stuck page / hung puppeteer).
    stallTimeoutMs: 18 * 60 * 1000,
    // Default: only official single-brand Malls (skip multi-brand distributors).
    singleBrandOnly: true,
    skipMh4: false,
    // MH-14: pop = lifetime popular (default); sales = Top Sales sort ranks
    sortBy: 'pop',
    // When set, start with SAFE pacing until first successful brand, then switch
    // to these faster timings (captcha must be clear / session warm first).
    speedAfterWarm: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-w' || a === '--workspace') opts.workspace = argv[++i]
    else if (a === '--connect') {
      if (argv[i + 1] && !String(argv[i + 1]).startsWith('--')) opts.cdp = argv[++i]
    } else if (a === '--list-mode') opts.listMode = argv[++i]
    else if (a === '--max-pages') opts.maxPages = Number(argv[++i]) || 12
    else if (a === '--mh4-top') opts.mh4Top = Number(argv[++i]) || 40
    else if (a === '--delay-ms') opts.delayMs = Math.max(Number(argv[++i]) || 7000, 1200)
    else if (a === '--brand-gap-min-sec') opts.brandGapMinSec = Math.max(Number(argv[++i]) || 8, 0)
    else if (a === '--brand-gap-max-sec') opts.brandGapMaxSec = Math.max(Number(argv[++i]) || 20, 0)
    else if (a === '--pre-nav-min-sec') opts.preNavMinSec = Math.max(Number(argv[++i]) || 5, 0)
    else if (a === '--pre-nav-max-sec') opts.preNavMaxSec = Math.max(Number(argv[++i]) || 15, 0)
    else if (a === '--recovery-minutes') opts.recoveryMinutes = Math.max(Number(argv[++i]) || 15, 3)
    else if (a === '--brand-timeout-min') opts.brandTimeoutMs = Math.max(Number(argv[++i]) || 90, 10) * 60 * 1000
    else if (a === '--stall-timeout-min') opts.stallTimeoutMs = Math.max(Number(argv[++i]) || 18, 5) * 60 * 1000
    else if (a === '--include-distributors') opts.singleBrandOnly = false
    else if (a === '--single-brand-only') opts.singleBrandOnly = true
    else if (a === '--skip-mh4') opts.skipMh4 = true
    else if (a === '--sort-by') {
      const v = String(argv[++i] || 'pop').toLowerCase()
      opts.sortBy = v === 'sales' ? 'sales' : 'pop'
    } else if (a === '--babysit') {
      // Fast pacing ONLY after first successful brand (post-captcha / warm session).
      // Cold start keeps safer overnight-ish delays so first nav does not re-wall.
      opts.speedAfterWarm = {
        delayMs: 3200,
        brandGapMinSec: 3,
        brandGapMaxSec: 8,
        preNavMinSec: 1,
        preNavMaxSec: 3,
        recoveryMinutes: 8,
        stallTimeoutMs: 12 * 60 * 1000,
      }
      // Explicit cold defaults (do not apply fast yet)
      opts.delayMs = 7000
      opts.brandGapMinSec = 8
      opts.brandGapMaxSec = 20
      opts.preNavMinSec = 5
      opts.preNavMaxSec = 15
      opts.recoveryMinutes = 12
      opts.stallTimeoutMs = 15 * 60 * 1000
    } else if (a === '--fast') {
      // Aggressive after warm (same gate as babysit). Expect more walls.
      opts.speedAfterWarm = {
        delayMs: 2500,
        brandGapMinSec: 2,
        brandGapMaxSec: 5,
        preNavMinSec: 1,
        preNavMaxSec: 2,
        recoveryMinutes: 6,
        stallTimeoutMs: 10 * 60 * 1000,
      }
      opts.delayMs = 7000
      opts.brandGapMinSec = 8
      opts.brandGapMaxSec = 20
      opts.preNavMinSec = 5
      opts.preNavMaxSec = 15
      opts.recoveryMinutes = 12
      opts.stallTimeoutMs = 15 * 60 * 1000
    }
  }
  return opts
}

/** Apply warm/babysit timings onto opts (mutates). */
function applySpeedProfile(opts, profile, label) {
  if (!profile) return
  Object.assign(opts, profile)
  log(
    `speed ${label}: delayMs=${opts.delayMs} preNav=${opts.preNavMinSec}-${opts.preNavMaxSec}s brandGap=${opts.brandGapMinSec}-${opts.brandGapMaxSec}s`,
  )
  console.error(
    `[queue] speed → ${label} (delay ${opts.delayMs}ms, pre-nav ${opts.preNavMinSec}-${opts.preNavMaxSec}s)`,
  )
}

/** Safe cold profile (re-apply after captcha/stall so we don't stay hot while blocked). */
function coldSpeedProfile() {
  return {
    delayMs: 7000,
    brandGapMinSec: 8,
    brandGapMaxSec: 20,
    preNavMinSec: 5,
    preNavMaxSec: 15,
    recoveryMinutes: 12,
    stallTimeoutMs: 15 * 60 * 1000,
  }
}

/** True if another mall-brand-cycle is already running (not us waiting). */
function isCycleRunning() {
  try {
    const out = execSync(
      "powershell -NoProfile -Command \"Get-CimInstance Win32_Process -Filter \\\"Name='node.exe'\\\" | ForEach-Object { $_.CommandLine }\"",
      { encoding: 'utf8', windowsHide: true, timeout: 20000 },
    )
    return /mall-brand-cycle\.mjs/i.test(out || '')
  } catch {
    return false
  }
}

/**
 * Build work queue for mono-brand Malls.
 *
 * PDP / platform category (MH-4) placement:
 *  1. Same brand visit as list for new shops (full = list → MH-4) — warm session + candidates.
 *  2. MH-4 backlog for listed && !mh4_ok (queue used to skip these forever after list).
 *
 * Order: MH-4 backlog first (category data on brands we already listed), then full list+MH-4.
 *
 * List state keys depend on sortBy:
 *  - pop: list_ok / list_products
 *  - sales (MH-14): list_sales_ok / list_sales_products
 *
 * @returns {Promise<Array<{ brand_key: string, phase: 'mh4' | 'full' }>>}
 */
function brandsNeedingHarvest(db, workspaceId, statePath, opts = {}) {
  const salesMode = opts.sortBy === 'sales'
  return db
    .from('marketplace_brand_universe')
    .select('brand_key, shop_username, shop_kind, metadata')
    .eq('workspace_id', workspaceId)
    .not('shop_username', 'is', null)
    .order('brand_key')
    .then(({ data, error }) => {
      if (error) throw error
      const state = loadCycleState(statePath)
      const rows = data || []

      // Shops hosting multiple linked brands = distributor-style even if kind missing.
      const shopCounts = new Map()
      for (const b of rows) {
        const u = String(b.shop_username || '')
          .toLowerCase()
          .trim()
        if (!u) continue
        shopCounts.set(u, (shopCounts.get(u) || 0) + 1)
      }

      const mh4Backlog = []
      const fullNeed = []
      let skippedDist = 0
      const now = Date.now()

      for (const b of rows) {
        const user = String(b.shop_username || '').trim()
        if (!user) continue
        if (opts.singleBrandOnly !== false) {
          const u = user.toLowerCase()
          if (isMultiBrandDistributor(b) || (shopCounts.get(u) || 0) > 1) {
            skippedDist++
            continue
          }
        }
        const st = state.brands?.[b.brand_key]
        if (st?.cooldown_until && new Date(st.cooldown_until).getTime() > now) continue

        const hasList = salesMode
          ? Boolean(st?.list_sales_ok && (st.list_sales_products || 0) > 0)
          : Boolean(st?.list_ok && (st.list_products || 0) > 0)
        // mh4_ok true covers real PDPs and explicit no_candidates clear (shared across sorts)
        const hasMh4 = Boolean(st?.mh4_ok)

        if (hasList && (hasMh4 || opts.skipMh4)) continue

        // Already listed but missing platform category PDPs → MH-4 only
        if (hasList && !hasMh4 && !opts.skipMh4) {
          mh4Backlog.push({ brand_key: b.brand_key, phase: 'mh4' })
          continue
        }

        // Need list (and will do MH-4 in the same cycle after list)
        if (!hasList) {
          fullNeed.push({ brand_key: b.brand_key, phase: 'full' })
        }
      }
      if (skippedDist) log(`filter single-brand: skipped ${skippedDist} distributor-linked brand row(s)`)
      if (mh4Backlog.length) {
        log(
          `mh4 backlog: ${mh4Backlog.length} brand(s) ${salesMode ? 'list_sales' : 'list'}_ok without category PDPs`,
        )
      }
      if (fullNeed.length) {
        log(`full harvest need: ${fullNeed.length} brand(s) sortBy=${salesMode ? 'sales' : 'pop'}`)
      }
      // Category first on known listings, then expand list+MH-4 for the rest
      return [...mh4Backlog, ...fullNeed]
    })
}

function killTree(pid) {
  if (!pid) return
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true, stdio: 'ignore' })
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {object} opts
 * @param {string} brandKey
 * @param {'full' | 'mh4'} [phase]
 */
function runOneBrand(opts, brandKey, phase = 'full') {
  return new Promise((resolvePromise) => {
    const script = resolve(ROOT, 'scripts/mall-brand-cycle.mjs')
    const mh4Only = phase === 'mh4'
    const args = [
      script,
      '-w',
      opts.workspace,
      '--brand',
      brandKey,
      '--connect',
      opts.cdp,
      '--list-mode',
      mh4Only ? 'skip' : opts.listMode,
      '--max-pages',
      String(opts.maxPages),
      '--mh4-top',
      String(opts.skipMh4 ? 0 : opts.mh4Top),
      '--delay-ms',
      String(opts.delayMs),
      '--brand-gap-min-sec',
      String(opts.brandGapMinSec),
      '--brand-gap-max-sec',
      String(opts.brandGapMaxSec),
      '--pre-nav-min-sec',
      String(opts.preNavMinSec),
      '--pre-nav-max-sec',
      String(opts.preNavMaxSec),
      '--skip-done',
      '--no-notify',
      '--recovery-minutes',
      String(opts.recoveryMinutes),
    ]
    if (mh4Only) args.push('--skip-list')
    if (opts.skipMh4) args.push('--skip-mh4')
    if (opts.sortBy === 'sales') args.push('--sort-by', 'sales')
    log(
      `spawn ${brandKey} phase=${phase} sortBy=${opts.sortBy || 'pop'} delayMs=${opts.delayMs} preNav=${opts.preNavMinSec}-${opts.preNavMaxSec}s`,
    )
    let settled = false
    let killReason = null
    let hardTimer = null
    let stallTimer = null
    const finish = (result) => {
      if (settled) return
      settled = true
      if (hardTimer) clearTimeout(hardTimer)
      if (stallTimer) clearTimeout(stallTimer)
      resolvePromise(result)
    }

    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        killReason = 'stall'
        log(`stall-timeout ${brandKey} after ${opts.stallTimeoutMs / 60000}m silence — killing`)
        if (child?.pid) killTree(child.pid)
      }, opts.stallTimeoutMs)
    }

    let child
    try {
      child = spawn(process.execPath, args, {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        windowsHide: true,
      })
    } catch (e) {
      finish({ ok: false, brandKey, phase, code: 1, tail: `spawn throw: ${e}` })
      return
    }

    // MH-4-only is often shorter; still allow same hard cap (many PDPs)
    hardTimer = setTimeout(() => {
      killReason = 'hard'
      log(`brand-timeout ${brandKey} after ${opts.brandTimeoutMs / 60000}m — killing`)
      if (child?.pid) killTree(child.pid)
    }, opts.brandTimeoutMs)
    armStall()

    let tail = ''
    const cap = (b) => {
      armStall()
      tail = (tail + String(b)).slice(-8000)
    }
    child.stdout?.on('data', cap)
    child.stderr?.on('data', cap)
    child.on('error', (e) => {
      finish({ ok: false, brandKey, phase, code: 1, tail: `spawn error: ${e?.message || e}` })
    })
    child.on('close', (code, signal) => {
      let exitCode = typeof code === 'number' ? code : 1
      if (killReason) {
        exitCode = 124
        tail = `${tail}\n[queue] killed: ${killReason}-timeout`.slice(-8000)
      }
      // Trust cycle state for the phase we ran (prefer over exit codes —
      // PowerShell/wrap can lie, and brands_ok can be true with 0 MH-4 PDPs).
      let stateOk = false
      try {
        const st = loadCycleState(defaultCycleStatePath(ROOT))
        const b = st.brands?.[brandKey]
        if (mh4Only) {
          // Real category enrichment, or explicit "no candidates left" clear
          if (b?.mh4_ok && (b.mh4_count || 0) > 0) stateOk = true
          else if (b?.mh4_ok && b?.mh4_error === 'no_candidates') stateOk = true
        } else if (opts.sortBy === 'sales') {
          // MH-14 sales-sort list success (MH-4 may still backlog)
          if (b?.list_sales_ok && (b.list_sales_products || 0) > 0) stateOk = true
        } else if (b?.list_ok && (b.list_products || 0) > 0) {
          // Full phase: list success counts even if MH-4 later captcha'd
          // (mh4 backlog will pick up category PDPs)
          stateOk = true
        }
      } catch {
        /* ignore */
      }
      const summaryOk =
        !mh4Only &&
        !killReason &&
        (exitCode === 0 ||
          (/"brands_ok"\s*:\s*1/.test(tail) && /"brands_failed"\s*:\s*0/.test(tail)) ||
          (/brands_ok["\s:]+1/.test(tail) &&
            !/brands_failed["\s:]+[1-9]/.test(tail) &&
            /done\s+/i.test(tail)))
      finish({
        ok: Boolean(stateOk || summaryOk),
        brandKey,
        phase,
        code: exitCode,
        tail,
      })
    })
  })
}

async function main() {
  loadDotEnv()
  const opts = parseArgs(process.argv.slice(2))
  const statePath = defaultCycleStatePath(ROOT)
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) {
    console.error('[queue ERROR] missing SUPABASE_URL / key')
    process.exitCode = 1
    return
  }
  const db = createClient(url, key)

  const hasWarmSpeed = Boolean(opts.speedAfterWarm)
  log(
    `queue up workspace=${opts.workspace} cdp=${opts.cdp} sortBy=${opts.sortBy || 'pop'} singleBrandOnly=${opts.singleBrandOnly !== false} listMode=${opts.listMode} mh4=${opts.skipMh4 ? 0 : opts.mh4Top} delayMs=${opts.delayMs} preNav=${opts.preNavMinSec}-${opts.preNavMaxSec}s brandGap=${opts.brandGapMinSec}-${opts.brandGapMaxSec}s recovery=${opts.recoveryMinutes}m warmSpeed=${hasWarmSpeed ? 'after-first-ok' : 'off'}`,
  )
  console.error(
    `[queue] sortBy=${opts.sortBy || 'pop'} · listMode=${opts.listMode} · mh4=${opts.skipMh4 ? 0 : opts.mh4Top}`,
  )
  if (hasWarmSpeed) {
    console.error(
      '[queue] cold start (safe delays). Babysit/fast speed unlocks after first successful brand — clear captcha first if needed.',
    )
  }

  while (isCycleRunning()) {
    log('waiting for mall-brand-cycle…')
    await sleep(12000)
  }

  let consecutiveErrors = 0
  let sessionWarm = false
  for (;;) {
    while (isCycleRunning()) await sleep(8000)

    let need
    try {
      need = await brandsNeedingHarvest(db, opts.workspace, statePath, opts)
    } catch (e) {
      console.error(`[queue ERROR] ${e?.message || e}`)
      log(`ERROR list: ${e?.message || e}`)
      process.exitCode = 1
      return
    }

    if (!need.length) {
      const doneLabel =
        opts.sortBy === 'sales'
          ? 'all linked brands harvested (list_sales + MH-4)'
          : 'all linked brands harvested (list + MH-4)'
      log(`queue empty — ${doneLabel}`)
      console.error(`[queue] done — no brands left needing harvest (sortBy=${opts.sortBy || 'pop'})`)
      process.exitCode = 0
      return
    }

    const job = need[0]
    const brandKey = job.brand_key
    const phase = job.phase || 'full'
    const mh4Left = need.filter((j) => j.phase === 'mh4').length
    const fullLeft = need.filter((j) => j.phase === 'full').length
    log(
      `start ${brandKey} phase=${phase} warm=${sessionWarm} (remaining ~${need.length}: mh4=${mh4Left} full=${fullLeft})`,
    )

    const result = await runOneBrand(opts, brandKey, phase)
    if (!result.ok) {
      consecutiveErrors++
      // Captcha/stall: drop back to cold pacing so the next brand is not hot-raced into a wall
      if (hasWarmSpeed && sessionWarm) {
        sessionWarm = false
        applySpeedProfile(opts, coldSpeedProfile(), 'cold-after-fail')
      }
      console.error(
        `[queue ERROR] ${brandKey} phase=${phase} exit=${result.code} consecutive=${consecutiveErrors}`,
      )
      console.error((result.tail || '').slice(-1200))
      log(
        `ERROR ${brandKey} phase=${phase} code=${result.code}\n${(result.tail || '').slice(-1200)}`,
      )

      // Skip this brand for a few hours so the queue can advance (stuck/hang recovery).
      // MH-4-only failures must not wipe list_ok (that would re-scrape the whole shop).
      try {
        const state = loadCycleState(statePath)
        const until = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
        if (phase === 'mh4') {
          patchBrandState(state, brandKey, {
            mh4_ok: false,
            mh4_error: `queue_fail_exit_${result.code}`,
            cooldown_until: until,
          })
        } else {
          patchBrandState(state, brandKey, {
            list_ok: false,
            list_error: `queue_fail_exit_${result.code}`,
            cooldown_until: until,
          })
        }
        saveCycleState(statePath, state)
        log(`cooldown ${brandKey} until ${until}`)
      } catch (e) {
        log(`cooldown write failed: ${e?.message || e}`)
      }

      // Don't kill the whole overnight queue on captcha storms — cooldown brand
      // and keep walking. Only stop if almost nothing left but pure failures.
      if (consecutiveErrors >= 40) {
        console.error(
          '[queue ERROR] 40 consecutive failures — stop (session likely dead; relaunch Chrome + captcha)',
        )
        process.exitCode = 1
        return
      }
      if (consecutiveErrors % 5 === 0) {
        log(
          `warning: ${consecutiveErrors} consecutive failures — continuing (cooldown skips will advance)`,
        )
        console.error(
          `[queue] ${consecutiveErrors} consecutive failures — still running; clear captcha if blocked`,
        )
        // Brief extra settle so a human can unlock Win+L / solve captcha
        await sleep(20000)
      }
      await sleep(8000)
      continue
    }

    consecutiveErrors = 0
    log(`ok ${brandKey} phase=${phase}`)
    // First success after cold start → unlock babysit/fast for the rest
    if (hasWarmSpeed && !sessionWarm) {
      sessionWarm = true
      applySpeedProfile(opts, opts.speedAfterWarm, 'babysit-warm')
    }
    // short inter-brand pause (cycle also has brand-gap humanize)
    const gapLo = Math.max(1500, opts.brandGapMinSec * 400)
    const gapHi = Math.max(gapLo + 500, opts.brandGapMaxSec * 500)
    await sleep(gapLo + Math.floor(Math.random() * (gapHi - gapLo)))
  }
}

main().catch((e) => {
  console.error(`[queue ERROR] ${e?.stack || e}`)
  process.exitCode = 1
})
