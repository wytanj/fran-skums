export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:read')
  const client = getAdminClient()
  const query = getQuery(event)

  const limit = Math.min(Number(query.limit) || 25, 100)
  const offset = Number(query.offset) || 0

  const { data, count, error } = await client
    .from('expiry_batches')
    .select('*', { count: 'exact' })
    .eq('workspace_id', ctx.workspaceId)
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [], total: count || 0, limit, offset }
})
