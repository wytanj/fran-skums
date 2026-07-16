/**
 * Rpt-3 cron: run due enabled report subscriptions + Phase N / webhook deliver.
 *
 * POST /api/internal/reports/cron-tick
 * Authorization: Bearer <REPORTS_CRON_SECRET | MARKETPLACE_CRON_SECRET | QUEUE_PROCESSOR_KEY | CRON_SECRET>
 * Body: { limit?: number, workspace_id?: string }
 */
import { runReportCronTick } from '../../../utils/reportRegistry'

function cronSecretExpected(config: any): string {
  return (
    process.env.REPORTS_CRON_SECRET
    || config.marketplaceCronSecret
    || config.queueProcessorKey
    || process.env.MARKETPLACE_CRON_SECRET
    || process.env.QUEUE_PROCESSOR_KEY
    || process.env.CRON_SECRET
    || ''
  )
}

function assertCronAuth(event: any, config: any) {
  const authHeader = getHeader(event, 'authorization')
  const token = authHeader?.replace(/^Bearer\s+/i, '') || ''
  const expected = cronSecretExpected(config)
  // Vercel Cron may send Authorization: Bearer $CRON_SECRET
  if (!expected || token !== expected) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or missing cron secret' })
  }
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  assertCronAuth(event, config)

  const body = await readBody(event).catch(() => ({} as Record<string, unknown>))
  const limit = typeof body?.limit === 'number' ? body.limit : undefined
  const workspace_id =
    typeof body?.workspace_id === 'string' && body.workspace_id
      ? body.workspace_id
      : undefined

  const client = getServiceClient()
  try {
    const result = await runReportCronTick(client, {
      limit,
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
