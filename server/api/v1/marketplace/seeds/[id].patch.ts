/**
 * Update a marketplace crawl seed (cadence, enabled, collector, depth).
 * PATCH /api/v1/marketplace/seeds/:id
 */
import { requireApiKey } from '../../../../utils/apiAuth'
import { computeNextRunAt } from '../../../../../marketplace/scheduler.mjs'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:write')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'seed id required' })

  const body = await readBody(event)
  const db = getServiceClient()

  const { data: existing, error: loadErr } = await db
    .from('marketplace_crawl_seeds')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', auth.workspaceId)
    .single()

  if (loadErr || !existing) {
    throw createError({ statusCode: 404, statusMessage: 'Seed not found' })
  }

  const patch: Record<string, unknown> = {}
  const fields = [
    'enabled',
    'schedule_kind',
    'schedule_cron',
    'timezone',
    'preferred_hour',
    'weekly_day',
    'max_pages',
    'max_listings',
    'detail_top_n',
    'priority',
    'collector_id',
    'target',
    'metadata',
  ] as const

  for (const f of fields) {
    if (body?.[f] !== undefined) patch[f] = body[f]
  }

  // Recompute next_run_at when cadence fields change
  const schedule_kind = (patch.schedule_kind as string) || existing.schedule_kind
  const preferred_hour =
    patch.preferred_hour != null ? Number(patch.preferred_hour) : existing.preferred_hour
  const weekly_day =
    patch.weekly_day != null ? Number(patch.weekly_day) : existing.weekly_day
  const schedule_cron =
    patch.schedule_cron !== undefined ? patch.schedule_cron : existing.schedule_cron

  if (
    body?.schedule_kind !== undefined ||
    body?.preferred_hour !== undefined ||
    body?.weekly_day !== undefined ||
    body?.schedule_cron !== undefined ||
    body?.recompute_next_run === true
  ) {
    const next = computeNextRunAt(new Date(), {
      schedule_kind,
      preferred_hour,
      weekly_day,
      schedule_cron,
    })
    patch.next_run_at = next ? next.toISOString() : null
  }

  if (Object.keys(patch).length === 0) {
    return { seed: existing }
  }

  const { data, error } = await db
    .from('marketplace_crawl_seeds')
    .update(patch)
    .eq('id', id)
    .eq('workspace_id', auth.workspaceId)
    .select('*')
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { seed: data }
})
