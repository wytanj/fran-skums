export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'agents:read')
  const client = getAdminClient()
  const query = getQuery(event)

  const limit = Math.min(Number(query.limit) || 50, 200)
  const offset = Number(query.offset) || 0

  let q = client
    .from('agent_proposals')
    .select('*', { count: 'exact' })
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (query.status) {
    q = q.eq('status', query.status as string)
  }
  if (query.app_key) {
    q = q.eq('app_key', query.app_key as string)
  }
  if (query.risk_level) {
    q = q.eq('risk_level', query.risk_level as string)
  }

  const { data, count, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [], total: count || 0, limit, offset }
})
