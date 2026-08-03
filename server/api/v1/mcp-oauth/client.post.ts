/**
 * Create or rotate the Claude connector's OAuth client credentials.
 * POST /api/v1/mcp-oauth/client  { workspace_id, label? }
 *
 * The response is the only time the raw secret exists outside the hash — the UI
 * shows it once, exactly like an API key.
 *
 * Rotation keeps the same client_id and replaces only the secret, so the admin
 * updates one field in Claude rather than re-adding the connector.
 *
 * @see server/utils/mcpOauth.ts
 */
import { createOrRotateMcpOauthClient, mcpResourceUrl } from '../../../utils/mcpOauth'
import { requireWorkspaceAccess } from '../../../utils/workspaceAccess'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) as Record<string, any>
  const workspaceId = String(body?.workspace_id || '')
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id required' })
  }

  const client = getServiceClient()
  const access = await requireWorkspaceAccess(event, client, workspaceId, 'admin')

  let result
  try {
    result = await createOrRotateMcpOauthClient(client, {
      workspaceId,
      userId: access.uid,
      label: body?.label ? String(body.label).slice(0, 120) : null,
    })
  } catch (e: any) {
    throw createError({ statusCode: 500, statusMessage: e?.message || 'Could not issue credentials' })
  }

  return {
    ok: true,
    rotated: result.rotated,
    client_id: result.clientId,
    // Shown once. Not retrievable afterwards.
    client_secret: result.clientSecret,
    connector_url: mcpResourceUrl(event),
    message: result.rotated
      ? 'Secret rotated. Update the OAuth Client Secret in Claude — existing sessions keep working until their next refresh, then fail until Claude has the new value.'
      : 'Credentials created. Add the connector in Claude with this URL, Client ID and Secret.',
  }
})
