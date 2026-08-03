/**
 * Disconnect one person, or everyone, from the Claude connector.
 * POST /api/v1/mcp-oauth/disconnect  { workspace_id, user_id? }
 *
 * Without user_id this is the reset button: every live connection is revoked and
 * each person must click Connect again. The client credentials are untouched, so
 * the connector itself stays configured in Claude.
 *
 * Note this is rarely the right tool for offboarding — removing someone from
 * workspace_members already drops them to zero tools on their next request.
 * Use this when you want to force a re-consent without changing membership.
 *
 * @see server/utils/mcpOauth.ts
 */
import { revokeAllMcpOauthTokens, revokeMcpOauthTokensForUser } from '../../../utils/mcpOauth'
import { requireWorkspaceAccess } from '../../../utils/workspaceAccess'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) as Record<string, any>
  const workspaceId = String(body?.workspace_id || '')
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id required' })
  }

  const client = getServiceClient()
  await requireWorkspaceAccess(event, client, workspaceId, 'admin')

  const targetUserId = body?.user_id ? String(body.user_id) : null
  const revoked = targetUserId
    ? await revokeMcpOauthTokensForUser(client, workspaceId, targetUserId, 'revoked_by_admin')
    : await revokeAllMcpOauthTokens(client, workspaceId, 'revoked_by_admin')

  return {
    ok: true,
    scope: targetUserId ? 'user' : 'workspace',
    user_id: targetUserId,
    tokens_revoked: revoked,
    message: targetUserId
      ? `Disconnected. They can reconnect from Claude at any time.`
      : `${revoked} connection(s) disconnected. Everyone must click Connect in Claude again.`,
  }
})
