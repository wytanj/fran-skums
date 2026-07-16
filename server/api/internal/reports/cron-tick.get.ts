/**
 * Rpt-3 cron (GET for Vercel Cron Jobs).
 * GET /api/internal/reports/cron-tick
 * Authorization: Bearer <CRON_SECRET or REPORTS_CRON_SECRET …>
 */
import { runReportCronTick } from '../../../utils/reportRegistry'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const authHeader = getHeader(event, 'authorization')
  const token = authHeader?.replace(/^Bearer\s+/i, '') || ''
  const expected =
    process.env.REPORTS_CRON_SECRET
    || config.marketplaceCronSecret
    || config.queueProcessorKey
    || process.env.MARKETPLACE_CRON_SECRET
    || process.env.QUEUE_PROCESSOR_KEY
    || process.env.CRON_SECRET
    || ''

  if (!expected || token !== expected) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or missing cron secret' })
  }

  const query = getQuery(event)
  const limit = query.limit ? Number(query.limit) : undefined
  const workspace_id =
    typeof query.workspace_id === 'string' && query.workspace_id
      ? query.workspace_id
      : undefined

  const client = getServiceClient()
  try {
    const result = await runReportCronTick(client, {
      limit: Number.isFinite(limit) ? limit : undefined,
      workspaceId: workspace_id,
    })
    return {
      ok: true,
      ...result,
      at: new Date().toISOString(),
    }
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: err?.message?.slice(0, 300) || 'Report cron tick failed',
    })
  }
})
