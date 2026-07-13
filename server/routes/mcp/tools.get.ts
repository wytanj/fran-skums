/**
 * Convenience: list cloud-safe MCP tools (auth required).
 * GET /mcp/tools
 */
import { authenticateRemoteMcp, listToolsForTransport, remoteMcpCorsHeaders } from '../../utils/remoteMcp'

export default defineEventHandler(async (event) => {
  const cors = remoteMcpCorsHeaders()
  for (const [k, v] of Object.entries(cors)) setHeader(event, k, v)
  if (getMethod(event) === 'OPTIONS') {
    setResponseStatus(event, 204)
    return ''
  }

  const auth = await authenticateRemoteMcp(event)
  return {
    workspace_id: auth.workspaceId,
    profile: 'cloud-safe',
    scopes: auth.scopes,
    tools: listToolsForTransport(true),
  }
})
