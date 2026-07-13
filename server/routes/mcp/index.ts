/**
 * Phase R1 — Remote MCP endpoint (Streamable-HTTP-compatible JSON-RPC).
 *
 * URL: POST/GET https://<host>/mcp
 * Auth: Authorization: Bearer sk_live_…  or  X-API-Key: sk_live_…
 *
 * Claude custom integration / remote MCP clients post JSON-RPC here.
 */
import {
  authenticateRemoteMcp,
  listToolsForTransport,
  remoteMcpCorsHeaders,
  runRemoteMcpJsonRpc,
} from '../../utils/remoteMcp'

export default defineEventHandler(async (event) => {
  const cors = remoteMcpCorsHeaders()
  for (const [k, v] of Object.entries(cors)) setHeader(event, k, v)

  const method = getMethod(event)
  if (method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return ''
  }

  // Discovery / health (no auth required for presence check)
  if (method === 'GET') {
    return {
      name: 'fran-skums',
      version: '0.6.0-cloud',
      transport: 'streamable-http-jsonrpc',
      auth: 'Bearer sk_live_… or X-API-Key',
      docs: '/help/connect-claude',
      tools_hint: listToolsForTransport(true).map((t: any) => t.name),
      note: 'POST JSON-RPC (initialize, tools/list, tools/call) with API key for full access.',
    }
  }

  if (method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const auth = await authenticateRemoteMcp(event)
  let body: unknown
  try {
    body = await readBody(event)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' })
  }

  if (!body || (typeof body !== 'object' && !Array.isArray(body))) {
    throw createError({ statusCode: 400, statusMessage: 'JSON-RPC object or batch array required' })
  }

  setHeader(event, 'Content-Type', 'application/json')
  setHeader(event, 'X-Fran-Mcp-Workspace', auth.workspaceId)
  setHeader(event, 'X-Fran-Mcp-Profile', 'cloud-safe')

  return runRemoteMcpJsonRpc(auth, body)
})
