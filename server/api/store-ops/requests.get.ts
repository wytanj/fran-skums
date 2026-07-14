export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const workspaceId = String(query.workspace_id || '').trim()
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  const client = getServiceClient()
  // POS keys with store_ops:read / pos:read, or HQ session with store_ops:read
  const apiKey = await authenticateApiKey(event)
  if (apiKey) {
    if (apiKey.workspaceId !== workspaceId) {
      throw createError({ statusCode: 403, statusMessage: 'Workspace mismatch' })
    }
    if (!hasScope(apiKey, 'store_ops:read') && !hasScope(apiKey, 'pos:read')) {
      throw createError({ statusCode: 403, statusMessage: 'API key lacks store_ops:read or pos:read' })
    }
  } else {
    await requireScope(event, 'store_ops:read', { workspaceId, client, accessLevel: 'member' })
  }

  const status = String(query.status || '').trim()
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100)

  let q = client
    .from('store_replenishment_requests')
    .select('*, lines:store_replenishment_request_lines(*)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { data: data || [] }
})
