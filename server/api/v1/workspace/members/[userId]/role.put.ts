import { serverSupabaseUser } from '#supabase/server'
import { recapBoundApiKeys } from '../../../../../utils/apiKeyLifecycle'

/**
 * Update workspace member role + recap their API keys (A2.4).
 * Owner only for appoint/demote admin; owner/admin for member/viewer.
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  const actorId = (user as any)?.id || (user as any)?.sub
  if (!actorId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const targetUserId = getRouterParam(event, 'userId')
  const body = await readBody(event)
  const workspaceId = String(body?.workspace_id || '')
  const newRole = String(body?.role || '') as 'admin' | 'member' | 'viewer'

  if (!targetUserId || !workspaceId || !['admin', 'member', 'viewer'].includes(newRole)) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id, userId, role required' })
  }

  const client = getServiceClient()

  const { data: workspace } = await client
    .from('workspaces')
    .select('id, owner_id, organization_id')
    .eq('id', workspaceId)
    .maybeSingle()
  if (!workspace) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })

  const { data: actorMembership } = await client
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', actorId)
    .maybeSingle()

  let orgAdmin = false
  if (workspace.organization_id) {
    const { data: om } = await client
      .from('organization_members')
      .select('role')
      .eq('organization_id', workspace.organization_id)
      .eq('user_id', actorId)
      .in('role', ['owner', 'admin'])
      .maybeSingle()
    orgAdmin = Boolean(om)
  }

  const isOwner = workspace.owner_id === actorId
  const isAdmin =
    isOwner ||
    orgAdmin ||
    actorMembership?.role === 'owner' ||
    actorMembership?.role === 'admin'

  if (!isAdmin) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  const { data: target } = await client
    .from('workspace_members')
    .select('user_id, role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', targetUserId)
    .maybeSingle()

  if (!target) throw createError({ statusCode: 404, statusMessage: 'Member not found' })
  if (target.role === 'owner' || targetUserId === workspace.owner_id) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot change workspace owner role here' })
  }

  if ((newRole === 'admin' || target.role === 'admin') && !isOwner) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only the workspace owner can appoint or change admins',
    })
  }

  if (target.role === newRole) {
    return { ok: true, unchanged: true, role: newRole }
  }

  const previousRole = target.role
  const { error } = await client
    .from('workspace_members')
    .update({ role: newRole })
    .eq('workspace_id', workspaceId)
    .eq('user_id', targetUserId)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const lifecycle = await recapBoundApiKeys(client, {
    workspaceId,
    userId: targetUserId,
    newRole,
    previousRole,
    actorUserId: actorId,
  })

  return {
    ok: true,
    user_id: targetUserId,
    previous_role: previousRole,
    role: newRole,
    keys_recapped: lifecycle.recapped,
    keys_revoked: lifecycle.revoked,
    message:
      lifecycle.revoked.length || lifecycle.recapped.length
        ? `Role updated. ${lifecycle.recapped.length} key(s) recapped, ${lifecycle.revoked.length} key(s) revoked.`
        : 'Role updated.',
  }
})
