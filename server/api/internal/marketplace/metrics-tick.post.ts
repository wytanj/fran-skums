/**
 * Compute marketplace_metrics_daily from today's snapshots.
 *
 * POST /api/internal/marketplace/metrics-tick
 * Authorization: Bearer <MARKETPLACE_CRON_SECRET or QUEUE_PROCESSOR_KEY>
 * Body: { workspace_id?, metric_date?, marketplace?, country?, limit_queries? }
 */
import { runMarketplaceMetricsDaily } from '../../../utils/marketplaceMetrics'

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

  try {
    const result = await runMarketplaceMetricsDaily({
      workspace_id: typeof body.workspace_id === 'string' ? body.workspace_id : undefined,
      metric_date: typeof body.metric_date === 'string' ? body.metric_date : undefined,
      marketplace: typeof body.marketplace === 'string' ? body.marketplace : undefined,
      country: typeof body.country === 'string' ? body.country : undefined,
      limit_queries: typeof body.limit_queries === 'number' ? body.limit_queries : undefined,
    })
    return { ok: true, ...result, at: new Date().toISOString() }
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: err?.message?.slice(0, 400) || 'metrics-tick failed',
    })
  }
})
