export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'events:read')
  const client = getAdminClient()
  const query = getQuery(event)

  const limit = Math.min(Number(query.limit) || 50, 200)
  const offset = Number(query.offset) || 0

  let q = client
    .from('domain_events')
    .select('*', { count: 'exact' })
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (query.event_type) {
    q = q.eq('event_type', query.event_type as string)
  }
  if (query.aggregate_type) {
    q = q.eq('aggregate_type', query.aggregate_type as string)
  }
  if (query.aggregate_id) {
    q = q.eq('aggregate_id', query.aggregate_id as string)
  }

  const { data, count, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [], total: count || 0, limit, offset }
})
