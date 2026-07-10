/**
 * List marketplace crawl jobs.
 * GET /api/v1/marketplace/jobs
 */
import { requireApiKey } from '../../../utils/apiAuth'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const query = getQuery(event)
  const db = getServiceClient()

  let q = db
    .from('marketplace_crawl_jobs')
    .select('*')
    .eq('workspace_id', auth.workspaceId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(query.limit) || 50, 200))

  if (typeof query.status === 'string') q = q.eq('status', query.status)
  if (typeof query.seed_id === 'string') q = q.eq('seed_id', query.seed_id)

  const { data, error } = await q
  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { jobs: data ?? [] }
})
