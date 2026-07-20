/**
 * Weekly brand-radar digest writer (script-only path).
 *
 * POST /api/internal/marketplace/weekly-digest
 * Authorization: Bearer <MARKETPLACE_CRON_SECRET or QUEUE_PROCESSOR_KEY>
 * Body: { workspace_id, week_key? | metric_date?, marketplace?, country? }
 *
 * PR-3: endpoint + auth + period identity (Sunday metric_date).
 * PR-6: grounded Grok → bi_digests upsert (script-only writer).
 *
 * Always safe to call after metrics-tick; returns skipped until PR-6 implements write.
 */
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
  const workspace_id =
    typeof body.workspace_id === 'string' ? body.workspace_id : undefined
  if (!workspace_id) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  const metric_date =
    (typeof body.week_key === 'string' && body.week_key) ||
    (typeof body.metric_date === 'string' && body.metric_date) ||
    mostRecentSundayUtcDate()

  // PR-6 will write bi_digests here. Keep contract stable for the weekly script.
  return {
    ok: true,
    skipped: true,
    reason: 'weekly_digest_write_deferred_to_pr6',
    workspace_id,
    week_key: metric_date,
    metric_date,
    marketplace: typeof body.marketplace === 'string' ? body.marketplace : 'shopee',
    country: typeof body.country === 'string' ? body.country : 'sg',
    at: new Date().toISOString(),
  }
})

/** Most recent Sunday (UTC) as YYYY-MM-DD — week_key identity for brand radar. */
function mostRecentSundayUtcDate(now = new Date()) {
  const d = new Date(now.getTime())
  const day = d.getUTCDay() // 0=Sun
  d.setUTCDate(d.getUTCDate() - day)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
