/**
 * Claim and run marketplace crawl jobs: collect → stamp → upsert.
 * Pure orchestration with injectable deps (tests + Nitro wrapper).
 *
 * PR-3: brand signal stamp, stop_batch on captcha/login, INTER_SEED sleep.
 */

import { upsertObservationCards } from './writers/upsertObservations.mjs'
import {
  interSeedSleepMs,
  isSessionStopHealth,
  stampBrandSignalsOnCards,
} from './stampBrandSignals.mjs'

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Cancel remaining pending jobs for a workspace after session stop.
 * @param {any} db
 * @param {string} workspaceId
 * @param {string} sessionHealth
 */
export async function cancelRemainingPending(db, workspaceId, sessionHealth) {
  const now = new Date().toISOString()
  const error = `batch_stopped:session_health=${sessionHealth}`
  const { data, error: cancelErr } = await db
    .from('marketplace_crawl_jobs')
    .update({
      status: 'cancelled',
      completed_at: now,
      error,
      summary: { stop_batch: true, session_health: sessionHealth },
    })
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .select('id')

  if (cancelErr) {
    return { cancelled: 0, error: cancelErr.message }
  }
  return { cancelled: data?.length ?? 0 }
}

/**
 * @param {{
 *   limit?: number
 *   workspace_id?: string
 *   worker_id?: string
 * }} options
 * @param {{
 *   getServiceClient: () => any
 *   runCollector: (collectorId: string, seed: object, jobId: string) => Promise<object>
 *   sleep?: (ms: number) => Promise<void>
 * }} deps
 */
export async function processMarketplaceJobs(options = {}, deps) {
  if (!deps?.getServiceClient || !deps?.runCollector) {
    throw new Error('processMarketplaceJobs requires getServiceClient and runCollector')
  }

  const db = deps.getServiceClient()
  const runCollector = deps.runCollector
  const sleep = deps.sleep || defaultSleep
  const limit = Math.min(Math.max(options.limit ?? 1, 1), 20)
  const workerId = options.worker_id || `worker-${process.pid}`

  let q = db
    .from('marketplace_crawl_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('scheduled_for', { ascending: true })
    .limit(limit)

  if (options.workspace_id) {
    q = q.eq('workspace_id', options.workspace_id)
  }

  const { data: pending, error } = await q
  if (error) throw new Error(`Failed to load jobs: ${error.message}`)

  const out = {
    claimed: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    stop_batch: false,
    stop_reason: null,
    results: [],
  }

  if (!pending?.length) return out

  let processedInBatch = 0

  for (const job of pending) {
    const now = new Date().toISOString()

    const { data: claimed, error: claimErr } = await db
      .from('marketplace_crawl_jobs')
      .update({
        status: 'running',
        claimed_at: now,
        claimed_by: workerId,
        started_at: now,
      })
      .eq('id', job.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle()

    if (claimErr || !claimed) {
      continue
    }
    out.claimed++

    const collectorId = job.collector_id || 'mock'

    try {
      let seed = {
        id: job.seed_id || job.id,
        workspace_id: job.workspace_id,
        marketplace: job.marketplace,
        country: job.country,
        mode: job.crawl_type,
        target: job.target,
        max_pages: 3,
        max_listings: 60,
        detail_top_n: 15,
        collector_id: collectorId,
        metadata: {},
      }

      if (job.seed_id) {
        const { data: seedRow } = await db
          .from('marketplace_crawl_seeds')
          .select('*')
          .eq('id', job.seed_id)
          .maybeSingle()
        if (seedRow) seed = seedRow
      }

      const collect = await runCollector(collectorId, seed, job.id)
      const sessionHealth = collect.session_health || 'ok'

      if (isSessionStopHealth(sessionHealth)) {
        await db
          .from('marketplace_crawl_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error: `session_health=${sessionHealth}`,
            summary: {
              session_health: sessionHealth,
              cards: collect.cards?.length ?? 0,
              stop_batch: true,
            },
            failed_targets: 1,
          })
          .eq('id', job.id)

        if (job.seed_id) {
          await db
            .from('marketplace_crawl_seeds')
            .update({
              last_error: `session_health=${sessionHealth}`,
              consecutive_failures: (seed.consecutive_failures || 0) + 1,
            })
            .eq('id', job.seed_id)
        }

        out.failed++
        out.results.push({
          job_id: job.id,
          status: 'failed',
          session_health: sessionHealth,
        })

        const cancel = await cancelRemainingPending(db, job.workspace_id, sessionHealth)
        out.cancelled = (out.cancelled || 0) + (cancel.cancelled || 0)
        out.stop_batch = true
        out.stop_reason = `session_health=${sessionHealth}`
        break
      }

      if (sessionHealth !== 'ok' && sessionHealth !== 'unknown') {
        await db
          .from('marketplace_crawl_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error: `session_health=${sessionHealth}`,
            summary: {
              session_health: sessionHealth,
              cards: collect.cards?.length ?? 0,
            },
            failed_targets: 1,
          })
          .eq('id', job.id)

        if (job.seed_id) {
          await db
            .from('marketplace_crawl_seeds')
            .update({
              last_error: `session_health=${sessionHealth}`,
              consecutive_failures: (seed.consecutive_failures || 0) + 1,
            })
            .eq('id', job.seed_id)
        }

        out.failed++
        out.results.push({
          job_id: job.id,
          status: 'failed',
          session_health: sessionHealth,
        })
      } else {
        const stamped = stampBrandSignalsOnCards(collect.cards || [], seed)

        const write = await upsertObservationCards(db, {
          workspace_id: job.workspace_id,
          marketplace: job.marketplace || 'shopee',
          country: job.country || 'sg',
          crawl_job_id: job.id,
          cards: stamped,
        })

        await db
          .from('marketplace_crawl_jobs')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            total_targets: stamped.length,
            processed_targets: write.snapshots_inserted,
            failed_targets: write.errors.length,
            summary: {
              session_health: sessionHealth,
              cards: stamped.length,
              write,
              brand_key: stamped[0]?.signals?.brand_key || null,
            },
            error: write.errors.length ? write.errors.slice(0, 5).join('; ') : null,
          })
          .eq('id', job.id)

        if (job.seed_id) {
          await db
            .from('marketplace_crawl_seeds')
            .update({
              last_success_at: new Date().toISOString(),
              last_error: null,
              consecutive_failures: 0,
            })
            .eq('id', job.seed_id)
        }

        out.completed++
        out.results.push({
          job_id: job.id,
          status: 'completed',
          cards: stamped.length,
          write,
        })
      }
    } catch (err) {
      const message = err?.message?.slice(0, 500) || String(err)
      await db
        .from('marketplace_crawl_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error: message,
          failed_targets: 1,
        })
        .eq('id', job.id)

      if (job.seed_id) {
        await db
          .from('marketplace_crawl_seeds')
          .update({
            last_error: message,
            consecutive_failures: 1,
          })
          .eq('id', job.seed_id)
      }

      out.failed++
      out.results.push({ job_id: job.id, status: 'failed', error: message })
    }

    processedInBatch++
    if (!out.stop_batch && processedInBatch < pending.length) {
      const delay = interSeedSleepMs(collectorId)
      if (delay > 0) {
        await sleep(delay)
      }
    }
  }

  return out
}
