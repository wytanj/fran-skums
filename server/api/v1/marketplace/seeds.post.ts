/**
 * Create a marketplace crawl seed.
 * POST /api/v1/marketplace/seeds
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { computeNextRunAt } from '../../../../marketplace/scheduler.mjs'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:write')
  const body = await readBody(event)
  const db = getServiceClient()

  const target = String(body?.target ?? '').trim()
  if (!target) {
    throw createError({ statusCode: 400, statusMessage: 'target is required' })
  }

  const schedule_kind = body?.schedule_kind || 'daily'
  const preferred_hour = Number(body?.preferred_hour ?? 2)
  const weekly_day = body?.weekly_day != null ? Number(body.weekly_day) : 1

  const now = new Date()
  const next = computeNextRunAt(now, {
    schedule_kind,
    preferred_hour,
    weekly_day,
    schedule_cron: body?.schedule_cron ?? null,
  })

  const row = {
    workspace_id: auth.workspaceId,
    marketplace: body?.marketplace || 'shopee',
    country: String(body?.country || 'sg').toLowerCase(),
    mode: body?.mode || 'keyword',
    target,
    enabled: body?.enabled !== false,
    schedule_kind,
    schedule_cron: body?.schedule_cron ?? null,
    timezone: body?.timezone || 'Asia/Singapore',
    preferred_hour: Number.isFinite(preferred_hour) ? preferred_hour : 2,
    weekly_day: schedule_kind === 'weekly' ? weekly_day : null,
    max_pages: Number(body?.max_pages ?? 3),
    max_listings: Number(body?.max_listings ?? 60),
    detail_top_n: Number(body?.detail_top_n ?? 15),
    priority: Number(body?.priority ?? 100),
    collector_id: body?.collector_id || 'mock',
    next_run_at: next ? next.toISOString() : null,
    metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  }

  const { data, error } = await db
    .from('marketplace_crawl_seeds')
    .insert(row)
    .select('*')
    .single()

  if (error) {
    throw createError({
      statusCode: error.code === '23505' ? 409 : 500,
      statusMessage: error.message,
    })
  }

  return { seed: data }
})
