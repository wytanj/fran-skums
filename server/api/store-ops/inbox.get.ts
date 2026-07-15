/**
 * HQ inbox: unread/read notifications for store_ops holders.
 * Phase N: includes scope-targeted + user-targeted rows.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const workspaceId = String(query.workspace_id || '').trim()
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  const client = getServiceClient()
  const actor = await requireScope(event, 'store_ops:read', {
    workspaceId,
    client,
    accessLevel: 'member',
  })

  const status = String(query.status || 'unread').trim()
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100)

  let q = client
    .from('store_ops_notifications')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status && status !== 'all') {
    q = q.eq('status', status)
  }

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const rows = data || []
  const scopes = actor.scopes || []
  const userId = actor.userId || null
  const isElevated = Boolean(
    actor.isWorkspaceAdmin
    || scopes.includes('*')
    || scopes.includes('full')
    || scopes.includes('store_ops:approve')
    || scopes.includes('store_ops:verify'),
  )

  // Filter to items the actor should see:
  // - target_scope matches a granted scope (or role-level approve/verify)
  // - target_scope = user:{actor}
  // - elevated actors see all HQ scope targets
  const visible = rows.filter((row: any) => {
    const target = String(row.target_scope || '')
    if (userId && target === `user:${userId}`) return true
    if (target.startsWith('user:') && target !== `user:${userId}`) return false
    if (isElevated) return true
    if (target && scopes.includes(target)) return true
    // Members without approve still see personal decision notifs only
    return false
  })

  const unreadCount = visible.filter((r: any) => r.status === 'unread').length

  return {
    data: visible,
    total: visible.length,
    unread_count: unreadCount,
  }
})
