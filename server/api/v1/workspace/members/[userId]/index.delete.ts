import { serverSupabaseUser } from '#supabase/server'
import { revokeBoundApiKeys } from '../../../../../utils/apiKeyLifecycle'

/**
 * Remove workspace member + soft-revoke their bound API keys (A2.4).
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  const actorId = (user as any)?.id || (user as any)?.sub
  if (!actorId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const targetUserId = getRouterParam(event, 'userId')
  const query = getQuery(event)
  const body = await readBody(event).catch(() => ({}))
  const workspaceId = String(body?.workspace_id || query.workspace_id || '')

  if (!targetUserId || !workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id and userId required' })
  }

  const client = getServiceClient()

  const { data: workspace } = await client
    .from('workspaces')
    .select('id, owner_id, organization_id')
    .eq('id', workspaceId)
    .maybeSingle()
  if (!workspace) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })

  if (targetUserId === workspace.owner_id) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot remove the workspace owner' })
  }

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

  if (target.role === 'admin' && !isOwner) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only the workspace owner can remove admins',
    })
  }

  // Revoke keys first (while we still know bound user)
  const lifecycle = await revokeBoundApiKeys(client, {
    workspaceId,
    userId: targetUserId,
    actorUserId: actorId,
    reason: 'member_removed',
    metadata: { previous_role: target.role },
  })

  const { error } = await client
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', targetUserId)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return {
    ok: true,
    user_id: targetUserId,
    keys_revoked: lifecycle.revoked,
    keys_revoked_count: lifecycle.count,
    message:
      lifecycle.count > 0
        ? `Member removed. ${lifecycle.count} API key(s) revoked.`
        : 'Member removed.',
  }
})
