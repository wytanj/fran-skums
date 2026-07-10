/**
 * Cron entry: enqueue due marketplace crawl seeds.
 *
 * POST /api/internal/marketplace/scheduler-tick
 * Authorization: Bearer <MARKETPLACE_CRON_SECRET or QUEUE_PROCESSOR_KEY>
 * Body: { limit?: number, workspace_id?: string }
 */
import { enqueueDueMarketplaceSeeds } from '../../../utils/marketplaceScheduler'

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
  const limit = typeof body?.limit === 'number' ? body.limit : undefined
  const workspace_id =
    typeof body?.workspace_id === 'string' && body.workspace_id
      ? body.workspace_id
      : undefined

  try {
    const result = await enqueueDueMarketplaceSeeds({ limit, workspace_id })
    return {
      ok: true,
      ...result,
      at: new Date().toISOString(),
    }
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: err?.message?.slice(0, 300) || 'Scheduler tick failed',
    })
  }
})
