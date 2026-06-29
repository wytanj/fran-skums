import { serverSupabaseUser } from '#supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createError, type H3Event } from 'h3'

export type WorkspaceAccessLevel = 'member' | 'write' | 'admin'

export interface WorkspaceAccessContext {
  uid: string
  workspaceId: string
  role: string | null
  isWorkspaceOwner: boolean
  isWorkspaceAdmin: boolean
  canWrite: boolean
}

export async function requireWorkspaceAccess(
  event: H3Event,
  client: SupabaseClient,
  workspaceId: string,
  accessLevel: WorkspaceAccessLevel = 'member',
): Promise<WorkspaceAccessContext> {
  const user = await serverSupabaseUser(event)
  const uid = (user as any)?.id || (user as any)?.sub
  if (!uid) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { data: workspace, error: workspaceError } = await client
    .from('workspaces')
    .select('id, owner_id, organization_id')
    .eq('id', workspaceId)
    .maybeSingle()

  if (workspaceError) {
    throw createError({ statusCode: 500, statusMessage: workspaceError.message })
  }
  if (!workspace) {
    throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  }

  const { data: membership, error: membershipError } = await client
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', uid)
    .maybeSingle()

  if (membershipError) {
    throw createError({ statusCode: 500, statusMessage: membershipError.message })
  }

  let orgAdmin = false
  if (workspace.organization_id) {
    const { data: orgMembership, error: orgMembershipError } = await client
      .from('organization_members')
      .select('role')
      .eq('organization_id', workspace.organization_id)
      .eq('user_id', uid)
      .in('role', ['owner', 'admin'])
      .maybeSingle()

    if (orgMembershipError) {
      throw createError({ statusCode: 500, statusMessage: orgMembershipError.message })
    }
    orgAdmin = Boolean(orgMembership)
  }

  const directRole = membership?.role || null
  const isWorkspaceOwner = workspace.owner_id === uid
  const isWorkspaceAdmin = isWorkspaceOwner || orgAdmin || directRole === 'owner' || directRole === 'admin'
  const canWrite = isWorkspaceAdmin || directRole === 'member'
  const isMember = canWrite || directRole === 'viewer'

  const allowed = accessLevel === 'admin'
    ? isWorkspaceAdmin
    : accessLevel === 'write'
      ? canWrite
      : isMember

  if (!allowed) {
    throw createError({
      statusCode: 403,
      statusMessage: accessLevel === 'admin'
        ? 'Workspace admin access required'
        : accessLevel === 'write'
          ? 'Workspace write access required'
          : 'Workspace access required',
    })
  }

  return {
    uid,
    workspaceId,
    role: directRole,
    isWorkspaceOwner,
    isWorkspaceAdmin,
    canWrite,
  }
}
