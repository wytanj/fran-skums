/**
 * Enqueue due marketplace crawl seeds into marketplace_crawl_jobs.
 * Pure scheduling logic lives in marketplace/scheduler.mjs.
 */

import {
  buildJobFromSeed,
  isSeedDue,
  seedPatchAfterEnqueue,
} from '../../marketplace/scheduler.mjs'
import { getServiceClient } from './supabase'

export interface SchedulerTickResult {
  scanned: number
  enqueued: number
  skipped: number
  errors: Array<{ seed_id: string; error: string }>
  job_ids: string[]
}

export interface SchedulerTickOptions {
  /** Cap seeds processed this tick */
  limit?: number
  /** Optional workspace filter */
  workspace_id?: string
  /** Override clock (tests) */
  now?: Date | string
}

/**
 * Find enabled due seeds, insert pending jobs, advance next_run_at.
 * Idempotent enough for hourly cron: a seed only enqueues when next_run_at <= now.
 */
export async function enqueueDueMarketplaceSeeds(
  options: SchedulerTickOptions = {},
): Promise<SchedulerTickResult> {
  const db = getServiceClient()
  const now = options.now ? new Date(options.now) : new Date()
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)

  let query = db
    .from('marketplace_crawl_seeds')
    .select('*')
    .eq('enabled', true)
    .neq('schedule_kind', 'manual_only')
    .order('priority', { ascending: false })
    .order('next_run_at', { ascending: true, nullsFirst: true })
    .limit(limit * 3) // over-fetch then filter due in app (null next_run_at)

  if (options.workspace_id) {
    query = query.eq('workspace_id', options.workspace_id)
  }

  // Due: next_run_at is null OR next_run_at <= now
  // PostgREST: or=(next_run_at.is.null,next_run_at.lte.ISO)
  query = query.or(`next_run_at.is.null,next_run_at.lte.${now.toISOString()}`)

  const { data: seeds, error } = await query
  if (error) {
    throw new Error(`Failed to load marketplace seeds: ${error.message}`)
  }

  const result: SchedulerTickResult = {
    scanned: seeds?.length ?? 0,
    enqueued: 0,
    skipped: 0,
    errors: [],
    job_ids: [],
  }

  if (!seeds?.length) return result

  for (const seed of seeds) {
    if (result.enqueued >= limit) break

    if (!isSeedDue(seed, now)) {
      result.skipped++
      continue
    }

    // Avoid duplicate pending jobs for same seed
    const { data: existing } = await db
      .from('marketplace_crawl_jobs')
      .select('id')
      .eq('seed_id', seed.id)
      .in('status', ['pending', 'claimed', 'running'])
      .limit(1)

    if (existing && existing.length > 0) {
      // Still advance next_run so we don't spin; leave existing job
      const patch = seedPatchAfterEnqueue(seed, now)
      await db.from('marketplace_crawl_seeds').update(patch).eq('id', seed.id)
      result.skipped++
      continue
    }

    const jobRow = buildJobFromSeed(seed, now)
    const { data: job, error: jobErr } = await db
      .from('marketplace_crawl_jobs')
      .insert(jobRow)
      .select('id')
      .single()

    if (jobErr || !job) {
      result.errors.push({
        seed_id: seed.id,
        error: jobErr?.message ?? 'insert failed',
      })
      continue
    }

    const patch = seedPatchAfterEnqueue(seed, now)
    const { error: seedErr } = await db
      .from('marketplace_crawl_seeds')
      .update(patch)
      .eq('id', seed.id)

    if (seedErr) {
      result.errors.push({
        seed_id: seed.id,
        error: `job created but seed patch failed: ${seedErr.message}`,
      })
    }

    result.enqueued++
    result.job_ids.push(job.id)
  }

  return result
}
