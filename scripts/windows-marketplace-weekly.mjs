#!/usr/bin/env node
/**
 * Windows / Task Scheduler weekly marketplace brand radar orchestrator (PR-3).
 *
 * Control flow (locked):
 *   1. scheduler-tick
 *   2. process-jobs loop until claimed==0 OR stop_batch
 *   3. ALWAYS metrics-tick (even after stop_batch)
 *   4. ALWAYS weekly-digest (even after stop_batch; PR-6 implements write)
 *   5. exit 2 if stop_batch, else 0
 *
 * Usage:
 *   node scripts/windows-marketplace-weekly.mjs
 *   node scripts/windows-marketplace-weekly.mjs --dry-run
 *   node scripts/windows-marketplace-weekly.mjs --resume
 *
 * Env (or flags):
 *   SKUMS_API_BASE          e.g. https://fran-skums.vercel.app
 *   MARKETPLACE_CRON_SECRET
 *   MARKETPLACE_WORKSPACE_ID
 *   PROCESS_JOBS_LIMIT      default 3
 *   SHOPEE_INTER_SEED_MS    honored inside processMarketplaceJobs (not here)
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    dryRun: false,
    resume: false,
    baseUrl: process.env.SKUMS_API_BASE || '',
    secret: process.env.MARKETPLACE_CRON_SECRET || process.env.QUEUE_PROCESSOR_KEY || '',
    workspace: process.env.MARKETPLACE_WORKSPACE_ID || '',
    limit: Number(process.env.PROCESS_JOBS_LIMIT || 3),
    metricDate: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.dryRun = true
    else if (a === '--resume') opts.resume = true
    else if (a === '--base-url') opts.baseUrl = argv[++i]
    else if (a === '--secret') opts.secret = argv[++i]
    else if (a === '--workspace') opts.workspace = argv[++i]
    else if (a === '--limit') opts.limit = Number(argv[++i])
    else if (a === '--metric-date') opts.metricDate = argv[++i]
    else if (a === '--help' || a === '-h') {
      console.log(`windows-marketplace-weekly.mjs

Env: SKUMS_API_BASE, MARKETPLACE_CRON_SECRET, MARKETPLACE_WORKSPACE_ID

Flags:
  --dry-run       Print plan only (no HTTP)
  --resume        Log resume mode (re-run after cookie refresh; skips nothing client-side —
                  cancelled jobs must be re-enqueued via scheduler or materialize)
  --base-url URL
  --workspace UUID
  --secret TOKEN
  --limit N       process-jobs batch size (default 3)
  --metric-date YYYY-MM-DD   week_key / Sunday metric_date (default: most recent Sunday UTC)
`)
      process.exit(0)
    }
  }
  return opts
}

/** Most recent Sunday UTC as YYYY-MM-DD */
export function mostRecentSundayUtc(now = new Date()) {
  const d = new Date(now.getTime())
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * Pure orchestration plan (testable). stop_batch breaks collect loop only.
 * @param {(path: string, body: object) => Promise<object>} post
 * @param {{ workspace: string, limit: number, metricDate: string, resume?: boolean }} opts
 */
export async function runWeeklyPipeline(post, opts) {
  const log = []
  let stop = false
  let stopReason = null
  const workspace_id = opts.workspace
  const metric_date = opts.metricDate || mostRecentSundayUtc()
  const limit = opts.limit || 3

  log.push({ step: 'scheduler-tick', note: opts.resume ? 'resume mode' : 'normal' })
  const sched = await post('/api/internal/marketplace/scheduler-tick', {
    workspace_id,
  })
  log.push({ step: 'scheduler-tick', result: summarize(sched) })

  // process-jobs loop
  let rounds = 0
  const maxRounds = 200
  while (rounds < maxRounds) {
    rounds++
    const proc = await post('/api/internal/marketplace/process-jobs', {
      workspace_id,
      limit,
      worker_id: `windows-weekly-${process.pid}`,
    })
    log.push({ step: 'process-jobs', round: rounds, result: summarize(proc) })

    if (proc?.stop_batch === true) {
      stop = true
      stopReason = proc.stop_reason || 'stop_batch'
      log.push({
        step: 'stop_batch',
        message: 'Collect stopped (login_required/blocked). Refresh cookies; re-run with --resume.',
        stop_reason: stopReason,
      })
      break // break loop only — do NOT skip metrics/digest
    }

    const claimed = Number(proc?.claimed ?? 0)
    if (claimed === 0) break
  }

  // ALWAYS aggregate after collect (partial week OK)
  log.push({ step: 'metrics-tick', metric_date })
  const metrics = await post('/api/internal/marketplace/metrics-tick', {
    workspace_id,
    metric_date,
    marketplace: 'shopee',
    country: 'sg',
    limit_queries: 200,
  })
  log.push({ step: 'metrics-tick', result: summarize(metrics) })

  log.push({ step: 'weekly-digest', week_key: metric_date })
  const digest = await post('/api/internal/marketplace/weekly-digest', {
    workspace_id,
    week_key: metric_date,
    metric_date,
    marketplace: 'shopee',
    country: 'sg',
  })
  log.push({ step: 'weekly-digest', result: summarize(digest) })

  return {
    stop_batch: stop,
    stop_reason: stopReason,
    metric_date,
    week_key: metric_date,
    exit_code: stop ? 2 : 0,
    log,
  }
}

function summarize(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const {
    ok,
    claimed,
    completed,
    failed,
    cancelled,
    stop_batch,
    stop_reason,
    enqueued,
    skipped,
    reason,
    upserted,
    week_key,
  } = obj
  return {
    ok,
    claimed,
    completed,
    failed,
    cancelled,
    stop_batch,
    stop_reason,
    enqueued,
    skipped,
    reason,
    upserted,
    week_key,
  }
}

async function httpPost(baseUrl, secret, path, body) {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 400) }
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${path}: ${json.statusMessage || text.slice(0, 200)}`)
    err.status = res.status
    err.body = json
    throw err
  }
  return json
}

async function main() {
  loadDotEnv(resolve(ROOT, '.env'))
  const opts = parseArgs(process.argv.slice(2))
  // re-read env after dotenv for flags defaults
  if (!opts.baseUrl) opts.baseUrl = process.env.SKUMS_API_BASE || ''
  if (!opts.secret) {
    opts.secret = process.env.MARKETPLACE_CRON_SECRET || process.env.QUEUE_PROCESSOR_KEY || ''
  }
  if (!opts.workspace) opts.workspace = process.env.MARKETPLACE_WORKSPACE_ID || ''

  const metricDate = opts.metricDate || mostRecentSundayUtc()

  console.log(
    JSON.stringify(
      {
        dry_run: opts.dryRun,
        base_url: opts.baseUrl || null,
        workspace: opts.workspace || null,
        resume: opts.resume,
        metric_date: metricDate,
        limit: opts.limit,
      },
      null,
      2,
    ),
  )

  if (!opts.workspace) {
    console.error('Missing MARKETPLACE_WORKSPACE_ID / --workspace')
    process.exit(1)
  }

  if (opts.dryRun) {
    const calls = []
    const result = await runWeeklyPipeline(async (path, body) => {
      calls.push({ path, body })
      if (path.includes('process-jobs')) {
        // Simulate one blocked batch then empty
        if (calls.filter((c) => c.path.includes('process-jobs')).length === 1) {
          return {
            ok: true,
            claimed: 1,
            completed: 0,
            failed: 1,
            stop_batch: true,
            stop_reason: 'session_health=blocked',
          }
        }
        return { ok: true, claimed: 0 }
      }
      return { ok: true, dry_run: true }
    }, { ...opts, metricDate })

    console.log(JSON.stringify({ dry_run_result: result, planned_calls: calls }, null, 2))
    console.log(
      'Dry-run: stop_batch still runs metrics-tick + weekly-digest; exit_code=',
      result.exit_code,
    )
    process.exit(0)
  }

  if (!opts.baseUrl || !opts.secret) {
    console.error('Need SKUMS_API_BASE and MARKETPLACE_CRON_SECRET for live run')
    process.exit(1)
  }

  const post = (path, body) => httpPost(opts.baseUrl, opts.secret, path, body)
  try {
    const result = await runWeeklyPipeline(post, { ...opts, metricDate })
    console.log(JSON.stringify(result, null, 2))
    if (result.stop_batch) {
      console.error(
        '[weekly] stop_batch: refresh SHOPEE_SG_SESSION_JSON cookies, then re-run with --resume',
      )
    }
    process.exit(result.exit_code)
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  main()
}
