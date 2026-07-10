/**
 * Worker entry: claim pending marketplace crawl jobs and collect.
 *
 * POST /api/internal/marketplace/process-jobs
 * Authorization: Bearer <MARKETPLACE_CRON_SECRET or QUEUE_PROCESSOR_KEY>
 * Body: { limit?: number, workspace_id?: string, worker_id?: string }
 *
 * Requires puppeteer (local/worker) when jobs use collector_id=shopee_puppeteer.
 * Use collector_id=mock for dry runs, cloudflare_browser_run when CF env is set.
 */
import { processMarketplaceJobs } from '../../../utils/marketplaceCollect'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const authHeader = getHeader(event, 'authorization')
  const token = authHeader?.replace(/^Bearer\s+/i, '')

  const expected =
    config.marketplaceCronSecret ||
    config.queueProcessorKey ||
    process.env.MARKETPLACE_CRON_SECRET ||
    process.env.QUEUE_PROCESSOR_KEY ||
    ''

  if (!expected || token !== expected) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or missing cron secret' })
  }

  const body = await readBody(event).catch(() => ({} as Record<string, unknown>))
  const limit = typeof body?.limit === 'number' ? body.limit : 1
  const workspace_id =
    typeof body?.workspace_id === 'string' ? body.workspace_id : undefined
  const worker_id = typeof body?.worker_id === 'string' ? body.worker_id : undefined

  try {
    const result = await processMarketplaceJobs({ limit, workspace_id, worker_id })
    return {
      ok: true,
      ...result,
      at: new Date().toISOString(),
    }
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: err?.message?.slice(0, 400) || 'process-jobs failed',
    })
  }
})
