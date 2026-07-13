/**
 * Phase R1 — Remote MCP HTTP helpers (API key auth → request-scoped MCP context).
 */
import {
  MCP_SCOPE_PROFILES,
  resolveCloudMcpScopes,
  runWithMcpRequestContext,
} from '../../mcp/src/context.mjs'
import { handleMcpJsonRpc, listToolsForTransport } from '../../mcp/src/httpProtocol.mjs'
import { handleTool } from '../../mcp/src/tools.mjs'

export { MCP_SCOPE_PROFILES, listToolsForTransport, handleTool }

export type RemoteMcpAuth = {
  workspaceId: string
  keyId: string
  keyName: string
  scopes: string[]
  clientName: string
}

/**
 * Authenticate API key for cloud MCP and resolve safe scopes.
 */
export async function authenticateRemoteMcp(event: any): Promise<RemoteMcpAuth> {
  const ctx = await authenticateApiKey(event)
  if (!ctx) {
    throw createError({
      statusCode: 401,
      statusMessage:
        'API key required. Create a Claude/MCP connector key in SKUMS Settings → API keys, then send Authorization: Bearer sk_live_…',
    })
  }

  let scopes: string[]
  try {
    scopes = resolveCloudMcpScopes(ctx.scopes)
  } catch (e: any) {
    throw createError({
      statusCode: 403,
      statusMessage: e?.message || 'API key not allowed for MCP',
    })
  }

  const headers = getHeaders(event)
  const clientHint =
    (typeof headers['x-mcp-client'] === 'string' && headers['x-mcp-client']) ||
    (typeof headers['x-client-name'] === 'string' && headers['x-client-name']) ||
    ctx.keyName ||
    'claude-cloud'

  return {
    workspaceId: ctx.workspaceId,
    keyId: ctx.keyId,
    keyName: ctx.keyName,
    scopes,
    clientName: String(clientHint).slice(0, 80),
  }
}

/**
 * Run JSON-RPC body under cloud MCP context.
 */
export async function runRemoteMcpJsonRpc(auth: RemoteMcpAuth, body: unknown) {
  return runWithMcpRequestContext(
    {
      workspaceId: auth.workspaceId,
      scopes: auth.scopes,
      clientName: auth.clientName,
      actorUserId: null,
      cloud: true,
      keyId: auth.keyId,
      keyName: auth.keyName,
    },
    () => handleMcpJsonRpc(body, { cloud: true }),
  )
}

/**
 * Simple tools/call helper (non-JSON-RPC convenience for tests/scripts).
 */
export async function runRemoteMcpTool(
  auth: RemoteMcpAuth,
  name: string,
  args: Record<string, unknown> = {},
) {
  return runWithMcpRequestContext(
    {
      workspaceId: auth.workspaceId,
      scopes: auth.scopes,
      clientName: auth.clientName,
      actorUserId: null,
      cloud: true,
      keyId: auth.keyId,
      keyName: auth.keyName,
    },
    () => handleTool(name, args),
  )
}

export function remoteMcpCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization,content-type,x-api-key,x-mcp-client,x-client-name,mcp-session-id',
    'Access-Control-Max-Age': '86400',
  }
}
