/**
 * Mark a store-ops notification as read.
 * Scope: store_ops:read (approvers viewing inbox)
 */
export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '').trim()
  const body = await readBody(event).catch(() => ({}))
  const workspaceId = String(body?.workspace_id || getQuery(event).workspace_id || '').trim()
  if (!id || !workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'id and workspace_id are required' })
  }

  const client = getServiceClient()
  const actor = await requireScope(event, 'store_ops:read', {
    workspaceId,
    client,
    accessLevel: 'member',
  })

  const { data, error } = await client
    .from('store_ops_notifications')
    .update({
      status: 'read',
      read_by: actor.userId || null,
      read_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select()
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Notification not found' })
  return { ok: true, notification: data }
})
