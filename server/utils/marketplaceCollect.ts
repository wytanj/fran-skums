/**
 * Claim and run marketplace crawl jobs: collect → upsert observations.
 */

import { getCollectAdapter } from '../../marketplace/collectors/registry.mjs'
import { scrapeShopeeWithPuppeteer } from '../../marketplace/collectors/shopee-puppeteer/adapter.mjs'
import { scrapeShopeeWithCloudflare } from '../../marketplace/collectors/cloudflare-browser-run/adapter.mjs'
import { scrapeShopeeWithBrowserbase } from '../../marketplace/collectors/browserbase/adapter.mjs'
import { upsertObservationCards } from '../../marketplace/writers/upsertObservations.mjs'
import { createStealthPage, getBrowser } from './browser-manager'
import { getServiceClient } from './supabase'

export interface ProcessJobsOptions {
  limit?: number
  workspace_id?: string
  worker_id?: string
}

export interface ProcessJobsResult {
  claimed: number
  completed: number
  failed: number
  results: Array<Record<string, unknown>>
}

async function runCollector(
  collectorId: string,
  seed: Record<string, any>,
  jobId: string,
) {
  const seedInput = {
    id: seed.id,
    workspace_id: seed.workspace_id,
    marketplace: seed.marketplace || 'shopee',
    country: seed.country || 'sg',
    mode: seed.mode || 'keyword',
    target: seed.target,
    max_pages: seed.max_pages ?? 3,
    max_listings: seed.max_listings ?? 60,
    detail_top_n: seed.detail_top_n ?? 15,
    metadata: seed.metadata || {},
  }

  if (collectorId === 'shopee_puppeteer') {
    return scrapeShopeeWithPuppeteer(seedInput, jobId, { getBrowser, createStealthPage })
  }

  if (collectorId === 'cloudflare_browser_run') {
    return scrapeShopeeWithCloudflare(seedInput, jobId)
  }

  if (collectorId === 'browserbase') {
    return scrapeShopeeWithBrowserbase(seedInput, jobId)
  }

  const adapter = getCollectAdapter(collectorId)
  if (!adapter) {
    throw new Error(`Unknown collector_id: ${collectorId}`)
  }
  return adapter.scrapeSeed(seedInput, jobId)
}

/**
 * Process up to `limit` pending marketplace_crawl_jobs.
 */
export async function processMarketplaceJobs(
  options: ProcessJobsOptions = {},
): Promise<ProcessJobsResult> {
  const db = getServiceClient()
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

  const out: ProcessJobsResult = {
    claimed: 0,
    completed: 0,
    failed: 0,
    results: [],
  }

  if (!pending?.length) return out

  for (const job of pending) {
    const now = new Date().toISOString()

    // Optimistic claim
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

    try {
      // Load seed for limits / target (job already has target)
      let seed: Record<string, any> = {
        id: job.seed_id || job.id,
        workspace_id: job.workspace_id,
        marketplace: job.marketplace,
        country: job.country,
        mode: job.crawl_type,
        target: job.target,
        max_pages: 3,
        max_listings: 60,
        detail_top_n: 15,
        collector_id: job.collector_id,
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

      const collect = await runCollector(job.collector_id || 'mock', seed, job.id)

      if (collect.session_health && collect.session_health !== 'ok') {
        await db
          .from('marketplace_crawl_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error: `session_health=${collect.session_health}`,
            summary: {
              session_health: collect.session_health,
              cards: collect.cards?.length ?? 0,
            },
            failed_targets: 1,
          })
          .eq('id', job.id)

        if (job.seed_id) {
          await db
            .from('marketplace_crawl_seeds')
            .update({
              last_error: `session_health=${collect.session_health}`,
              consecutive_failures: (seed.consecutive_failures || 0) + 1,
            })
            .eq('id', job.seed_id)
        }

        out.failed++
        out.results.push({
          job_id: job.id,
          status: 'failed',
          session_health: collect.session_health,
        })
        continue
      }

      const write = await upsertObservationCards(db, {
        workspace_id: job.workspace_id,
        marketplace: job.marketplace || 'shopee',
        country: job.country || 'sg',
        crawl_job_id: job.id,
        cards: collect.cards || [],
      })

      await db
        .from('marketplace_crawl_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          total_targets: collect.cards?.length ?? 0,
          processed_targets: write.snapshots_inserted,
          failed_targets: write.errors.length,
          summary: {
            session_health: collect.session_health,
            cards: collect.cards?.length ?? 0,
            write,
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
        cards: collect.cards?.length ?? 0,
        write,
      })
    } catch (err: any) {
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
  }

  return out
}
