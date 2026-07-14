export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const workspaceId = String(query.workspace_id || '').trim()
  if (!workspaceId) throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })

  const client = getServiceClient()
  await requireScope(event, 'store_ops:read', { workspaceId, client, accessLevel: 'member' })

  const status = String(query.status || 'open').trim()
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100)

  let q = client
    .from('inventory_exceptions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status && status !== 'all') {
    if (status === 'pending') q = q.in('status', ['open', 'in_review', 'escalated'])
    else q = q.eq('status', status)
  }

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { data: data || [] }
})
