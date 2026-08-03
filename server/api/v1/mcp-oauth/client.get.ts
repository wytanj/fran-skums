/**
 * Claude connector status for Settings.
 * GET /api/v1/mcp-oauth/client?workspace_id=…
 *
 * Returns metadata plus the exact strings to paste into Claude. Never returns the
 * client secret or its hash — the raw secret exists only in the response to a
 * create/rotate call.
 *
 * @see server/utils/mcpOauth.ts
 */
import { describeMcpOauthClient, listMcpOauthConnections, mcpResourceUrl } from '../../../utils/mcpOauth'
import { requireWorkspaceAccess } from '../../../utils/workspaceAccess'

export default defineEventHandler(async (event) => {
  const workspaceId = String(getQuery(event).workspace_id || '')
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id required' })
  }

  const client = getServiceClient()
  await requireWorkspaceAccess(event, client, workspaceId, 'admin')

  const [describe, connections] = await Promise.all([
    describeMcpOauthClient(client, workspaceId),
    listMcpOauthConnections(client, workspaceId),
  ])

  return {
    ...describe,
    // What the admin types into Claude. Bare /mcp — a URL carrying an API key
    // authenticates instantly and OAuth never starts.
    connector_url: mcpResourceUrl(event),
    connections,
    connection_count: connections.length,
  }
})
