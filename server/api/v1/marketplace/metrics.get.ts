/**
 * Read marketplace_metrics_daily.
 * GET /api/v1/marketplace/metrics?metric_date=&dimension_key=&dimension_type=
 */
import { requireApiKey } from '../../../utils/apiAuth'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const query = getQuery(event)
  const db = getServiceClient()
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200)

  let q = db
    .from('marketplace_metrics_daily')
    .select('*')
    .eq('workspace_id', auth.workspaceId)
    .order('metric_date', { ascending: false })
    .limit(limit)

  if (typeof query.metric_date === 'string') q = q.eq('metric_date', query.metric_date)
  if (typeof query.marketplace === 'string') q = q.eq('marketplace', query.marketplace)
  if (typeof query.country === 'string') q = q.eq('country', query.country)
  if (typeof query.dimension_type === 'string') q = q.eq('dimension_type', query.dimension_type)
  if (typeof query.dimension_key === 'string') q = q.eq('dimension_key', query.dimension_key)
  if (typeof query.q === 'string' && query.q) {
    q = q.ilike('dimension_key', `%${query.q}%`)
  }

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { metrics: data ?? [] }
})
