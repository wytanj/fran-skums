/**
 * List study sessions.
 * GET /api/v1/study/sessions?status=&limit=
 */
import { requireApiKey } from '../../../utils/apiAuth'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const query = getQuery(event)
  const db = getServiceClient()
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200)

  let q = db
    .from('study_sessions')
    .select('*')
    .eq('workspace_id', auth.workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (typeof query.status === 'string') q = q.eq('status', query.status)

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { sessions: data ?? [] }
})
