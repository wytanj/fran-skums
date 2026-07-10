/**
 * Force-enqueue a crawl job for one seed (run now).
 * POST /api/v1/marketplace/seeds/:id/run
 */
import { requireApiKey } from '../../../../../utils/apiAuth'
import { buildJobFromSeed } from '../../../../../../marketplace/scheduler.mjs'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:write')
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'seed id required' })
  }

  const db = getServiceClient()
  const { data: seed, error } = await db
    .from('marketplace_crawl_seeds')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', auth.workspaceId)
    .single()

  if (error || !seed) {
    throw createError({ statusCode: 404, statusMessage: 'Seed not found' })
  }

  const now = new Date()
  const jobRow = {
    ...buildJobFromSeed(seed, now),
    priority: (seed.priority ?? 100) + 500,
    metadata: {
      enqueued_by: 'run_now',
      schedule_kind: seed.schedule_kind,
    },
  }

  const { data: job, error: jobErr } = await db
    .from('marketplace_crawl_jobs')
    .insert(jobRow)
    .select('*')
    .single()

  if (jobErr || !job) {
    throw createError({ statusCode: 500, statusMessage: jobErr?.message || 'Failed to enqueue job' })
  }

  // For manual run_now we do not skip the regular cadence unless seed was due;
  // only stamp last_enqueued_at.
  await db
    .from('marketplace_crawl_seeds')
    .update({ last_enqueued_at: now.toISOString(), last_error: null })
    .eq('id', seed.id)

  return { job }
})
