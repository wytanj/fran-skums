/**
 * Turn the Claude connector off.
 * DELETE /api/v1/mcp-oauth/client  { workspace_id, revoke_tokens? }
 *
 * Revoking the client stops new authorizations and all refreshes. Access tokens
 * already issued keep working until they expire (≤1h) — pass revoke_tokens to
 * disconnect everyone immediately instead.
 *
 * @see server/utils/mcpOauth.ts
 */
import { revokeAllMcpOauthTokens, revokeMcpOauthClient } from '../../../utils/mcpOauth'
import { requireWorkspaceAccess } from '../../../utils/workspaceAccess'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) as Record<string, any>
  const workspaceId = String(body?.workspace_id || getQuery(event).workspace_id || '')
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id required' })
  }

  const client = getServiceClient()
  await requireWorkspaceAccess(event, client, workspaceId, 'admin')

  const revoked = await revokeMcpOauthClient(client, workspaceId)
  const tokensRevoked = body?.revoke_tokens
    ? await revokeAllMcpOauthTokens(client, workspaceId, 'client_revoked')
    : 0

  return {
    ok: true,
    client_revoked: revoked,
    tokens_revoked: tokensRevoked,
    message: revoked
      ? tokensRevoked
        ? `Connector disabled and ${tokensRevoked} connection(s) disconnected.`
        : 'Connector disabled. Existing sessions stop within the hour as their access tokens expire.'
      : 'No active connector credentials to disable.',
  }
})
