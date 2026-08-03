/**
 * Backs the consent screen at /oauth/authorize.
 *
 * Returns who is signed in, which workspace they resolve to, and exactly how
 * many MCP tools their role will expose — so a person signed into the wrong
 * Google account sees that before granting, rather than discovering it later as
 * mysteriously missing tools.
 *
 * @see app/pages/oauth/authorize.vue
 */
import { serverSupabaseUser } from '#supabase/server'
import {
  resolveMcpScopesForUser,
  resolveWorkspaceForUser,
  validateAuthorizeRequest,
} from '../../utils/mcpOauth'
import { listToolsForTransport } from '../../utils/remoteMcp'

function getUid(u: any): string | undefined {
  return u?.id || u?.sub
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as Record<string, any>
  // Validate before looking at the session: a malformed request should report
  // the misconfiguration, not send someone to a login page for nothing.
  const request = await validateAuthorizeRequest(event, query)

  let user: any = null
  try {
    user = await serverSupabaseUser(event)
  } catch {
    user = null
  }

  const userId = getUid(user)
  if (!userId) {
    return {
      signed_in: false,
      scope: request.scope,
      resource: request.resource,
    }
  }

  const db = getAdminClient()
  const ws = await resolveWorkspaceForUser(db, userId)

  if (!ws.workspaceId) {
    return {
      signed_in: true,
      email: user?.email || null,
      workspace_id: null,
      workspace_name: null,
      role: null,
      scopes: [],
      tool_count: 0,
      can_authorize: false,
      reason:
        'This account is not a member of any Fran workspace. Ask an owner to invite you, then try again.',
      scope: request.scope,
      resource: request.resource,
    }
  }

  const { scopes, role, deniedReason } = await resolveMcpScopesForUser(db, ws.workspaceId, userId)
  const tools = listToolsForTransport(true, scopes)

  return {
    signed_in: true,
    email: user?.email || null,
    workspace_id: ws.workspaceId,
    workspace_name: ws.workspaceName,
    workspace_ambiguous: ws.ambiguous,
    role,
    scopes,
    tool_count: tools.length,
    tool_names: tools.map((t: any) => t.name),
    can_authorize: scopes.length > 0,
    reason: scopes.length
      ? null
      : deniedReason === 'bound_user_not_a_member'
        ? 'This account is not a member of the workspace.'
        : 'Your role has no MCP-compatible permissions. Ask an owner to widen your role.',
    scope: request.scope,
    resource: request.resource,
  }
})
