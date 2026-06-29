export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:read')
  const client = getAdminClient()
  const query = getQuery(event)

  const limit = Math.min(Number(query.limit) || 25, 100)
  const offset = Number(query.offset) || 0

  let q = client
    .from('v_import_job_summary')
    .select('*', { count: 'exact' })
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (query.status) {
    q = q.eq('status', query.status as string)
  }
  if (query.source_type) {
    q = q.eq('source_type', query.source_type as string)
  }

  const { data, count, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return {
    data: data || [],
    total: count || 0,
    limit,
    offset,
  }
})
