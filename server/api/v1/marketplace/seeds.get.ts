/**
 * List marketplace crawl seeds for the authenticated workspace.
 * GET /api/v1/marketplace/seeds
 */
import { requireApiKey } from '../../../utils/apiAuth'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const query = getQuery(event)
  const db = getServiceClient()

  let q = db
    .from('marketplace_crawl_seeds')
    .select('*')
    .eq('workspace_id', auth.workspaceId)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })

  if (query.enabled === 'true') q = q.eq('enabled', true)
  if (query.enabled === 'false') q = q.eq('enabled', false)
  if (typeof query.marketplace === 'string') q = q.eq('marketplace', query.marketplace)
  if (typeof query.country === 'string') q = q.eq('country', query.country)

  const { data, error } = await q.limit(200)
  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { seeds: data ?? [] }
})
