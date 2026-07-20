/**
 * Claim and run marketplace crawl jobs: collect → upsert observations.
 * PR-3: brand signal stamp, stop_batch on captcha/login, INTER_SEED sleep.
 * Core logic lives in marketplace/processJobs.mjs (testable).
 */

import { getCollectAdapter } from '../../marketplace/collectors/registry.mjs'
import { scrapeShopeeWithPuppeteer } from '../../marketplace/collectors/shopee-puppeteer/adapter.mjs'
import { scrapeShopeeWithCloudflare } from '../../marketplace/collectors/cloudflare-browser-run/adapter.mjs'
import { scrapeShopeeWithBrowserbase } from '../../marketplace/collectors/browserbase/adapter.mjs'
import { processMarketplaceJobs as processJobsCore } from '../../marketplace/processJobs.mjs'
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
  cancelled?: number
  stop_batch?: boolean
  stop_reason?: string | null
  results: Array<Record<string, unknown>>
}

export type CollectDeps = {
  getServiceClient?: typeof getServiceClient
  runCollector?: (
    collectorId: string,
    seed: Record<string, any>,
    jobId: string,
  ) => Promise<{
    cards?: any[]
    session_health?: string
    details?: any[]
  }>
  sleep?: (ms: number) => Promise<void>
}

async function defaultRunCollector(
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
 * On session_health login_required|blocked: fail job, cancel remaining pending, stop_batch.
 */
export async function processMarketplaceJobs(
  options: ProcessJobsOptions = {},
  deps: CollectDeps = {},
): Promise<ProcessJobsResult> {
  return processJobsCore(options, {
    getServiceClient: deps.getServiceClient || getServiceClient,
    runCollector: deps.runCollector || defaultRunCollector,
    sleep: deps.sleep,
  }) as Promise<ProcessJobsResult>
}
