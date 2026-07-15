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
  boundUserId?: string | null
  boundUserRole?: string | null
}

/**
 * Authenticate API key for cloud MCP and resolve safe scopes.
 * A2: scopes already capped by bound user; then cloud ceiling applied.
 */
export async function authenticateRemoteMcp(event: any): Promise<RemoteMcpAuth> {
  const ctx = await authenticateApiKey(event)
  if (!ctx) {
    const q = getQuery(event)
    const hadUrlKey = Boolean(
      q.api_key || q.api || q.key || q.access_token || q.token || q.authorization,
    )
    throw createError({
      statusCode: 401,
      statusMessage: hadUrlKey
        ? 'API key in URL was not recognized (wrong/revoked/incomplete key). Create a fresh Claude/MCP key in Settings → API keys, copy the full sk_live_… value once, and use: https://fran-skums.vercel.app/mcp?api_key=sk_live_… or /mcp/c/sk_live_…'
        : 'API key required. Claude personal connector: put the key in the URL as https://fran-skums.vercel.app/mcp?api_key=sk_live_… (or /mcp/c/sk_live_…). Leave OAuth blank.',
    })
  }

  // Re-resolve with cloud=true so ceiling is applied on effective web∩key scopes
  const client = getAdminClient()
  const { resolveEffectiveScopesForApiKey } = await import('./effectiveScopes')
  const { data: keyRow } = await client
    .from('api_keys')
    .select(
      'id, workspace_id, name, scopes, is_active, created_by, bound_user_id, key_kind, max_package, revoked_at',
    )
    .eq('id', ctx.keyId)
    .maybeSingle()

  let scopes: string[]
  let boundUserId = ctx.boundUserId
  let boundUserRole = ctx.boundUserRole
  try {
    if (keyRow) {
      const effective = await resolveEffectiveScopesForApiKey(client, keyRow as any, { cloud: true })
      if (effective.deniedReason) {
        throw createError({
          statusCode: 403,
          statusMessage: `MCP key denied: ${effective.deniedReason}`,
        })
      }
      // Always re-map through resolveCloudMcpScopes so package tokens (mcp:ops_safe)
      // never reach tools/list unexpanded (would yield zero tools).
      scopes = resolveCloudMcpScopes(
        effective.scopes?.length ? effective.scopes : ['mcp:ops_safe'],
      )
      boundUserId = effective.boundUserId
      boundUserRole = effective.boundUserRole
    } else {
      scopes = resolveCloudMcpScopes(ctx.scopes?.length ? ctx.scopes : ['mcp:safe'])
    }
  } catch (e: any) {
    if (e?.statusCode) throw e
    throw createError({
      statusCode: 403,
      statusMessage: e?.message || 'API key not allowed for MCP',
    })
  }

  if (!scopes.length) {
    throw createError({
      statusCode: 403,
      statusMessage:
        'This API key has no MCP-compatible scopes after applying your web login permissions. Ask a workspace owner to issue a key bound to a role with catalog/store access.',
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
    boundUserId,
    boundUserRole,
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
      actorUserId: auth.boundUserId || null,
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
      actorUserId: auth.boundUserId || null,
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
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization,content-type,x-api-key,x-mcp-client,x-client-name,mcp-session-id,mcp-protocol-version,last-event-id,accept',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id, X-Fran-Mcp-Workspace, X-Fran-Mcp-Profile',
    'Access-Control-Max-Age': '86400',
  }
}
