/**
 * Shared Streamable-HTTP MCP request handler for /mcp and /mcp/c/:token
 * Claude personal connectors only allow: name, URL, optional OAuth client id/secret.
 * Embed API key in the URL: https://…/mcp?api_key=sk_live_…  or  https://…/mcp/c/sk_live_…
 */
import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import {
  authenticateRemoteMcp,
  listToolsForTransport,
  remoteMcpCorsHeaders,
  runRemoteMcpJsonRpc,
} from './remoteMcp'
import { handleMcpJsonRpc } from '../../mcp/src/httpProtocol.mjs'

const PUBLIC_METHODS = new Set(['initialize', 'ping'])

function rpcMethodName(msg: any): string {
  return msg && typeof msg === 'object' ? String(msg.method || '') : ''
}

function isNotificationOnly(body: unknown): boolean {
  const msgs = Array.isArray(body) ? body : [body]
  if (!msgs.length) return false
  return msgs.every((m) => {
    if (!m || typeof m !== 'object') return false
    const method = String((m as any).method || '')
    return method && (m as any).id === undefined
  })
}

function needsAuth(body: unknown): boolean {
  const msgs = Array.isArray(body) ? body : [body]
  return msgs.some((m) => {
    const method = rpcMethodName(m)
    if (!method) return true
    if (PUBLIC_METHODS.has(method)) return false
    if (method.startsWith('notifications/')) return false
    if (method === 'resources/list' || method === 'prompts/list') return false
    return true
  })
}

/**
 * Inject path/query API key into the request so authenticateApiKey can see it.
 * Claude custom connectors only support URL + optional OAuth — no Bearer field.
 */
export function injectMcpApiKeyFromUrl(event: H3Event, pathToken?: string | null) {
  const query = getQuery(event)
  const fromQuery =
    query.api_key
    || query.api
    || query.key
    || query.access_token
    || query.token
    || query.authorization
  const raw = (pathToken && String(pathToken).trim()) || (fromQuery ? String(fromQuery).trim() : '')
  if (!raw) return

  // Strip accidental "Bearer " prefix and surrounding brackets from pasted secrets
  const key = raw
    .replace(/^Bearer\s+/i, '')
    .replace(/^\[|\]$/g, '')
    .trim()
  if (!key) return

  // Stash on event context (headers may be immutable on some runtimes)
  ;(event.context as any).mcpApiKey = key

  // Prefer Authorization so authenticateApiKey finds it when headers are mutable
  try {
    const headers = event.node?.req?.headers
    if (headers && !headers.authorization && !headers.Authorization) {
      headers.authorization = `Bearer ${key}`
    }
  } catch {
    /* ignore immutable headers */
  }
}

/**
 * Streamable HTTP: when client Accept is only/primarily SSE on GET, do not return
 * discovery JSON — that makes Claude report "Couldn't reach". Return 405 (no server
 * push) or a short-lived empty SSE stream.
 */
function clientWantsGetSseStream(event: H3Event): boolean {
  const accept = String(getHeader(event, 'accept') || '').toLowerCase()
  if (!accept.includes('text/event-stream')) return false
  // Browser navigation / health checks usually send text/html or */* without MCP headers
  const mcpSession = getHeader(event, 'mcp-session-id')
  const mcpProtocol = getHeader(event, 'mcp-protocol-version')
  const hasMcpHint = Boolean(mcpSession || mcpProtocol)
  // Pure SSE accept (no json) always = stream open attempt
  if (!accept.includes('application/json')) return true
  // Claude often sends both; if MCP headers present, treat as stream open
  return hasMcpHint
}

function formatJsonRpcAsSse(payload: unknown): string {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return `event: message\ndata: ${data}\n\n`
}

export async function handleMcpHttpRequest(event: H3Event, opts?: { pathToken?: string | null }) {
  const cors = remoteMcpCorsHeaders()
  for (const [k, v] of Object.entries(cors)) setHeader(event, k, v)
  setHeader(event, 'Access-Control-Expose-Headers', 'Mcp-Session-Id, X-Fran-Mcp-Workspace, X-Fran-Mcp-Profile')

  injectMcpApiKeyFromUrl(event, opts?.pathToken)

  const method = getMethod(event)
  if (method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return ''
  }

  if (method === 'DELETE') {
    setResponseStatus(event, 204)
    return ''
  }

  if (method === 'GET') {
    // MCP Streamable HTTP: GET opens optional server→client SSE.
    // We do not push notifications — return 405 so clients fall back to POST-only.
    if (clientWantsGetSseStream(event)) {
      setResponseStatus(event, 405)
      setHeader(event, 'Allow', 'POST, OPTIONS, DELETE')
      setHeader(event, 'Content-Type', 'application/json')
      return {
        error: 'sse_stream_not_offered',
        message:
          'Fran SKUMS MCP is POST-only Streamable HTTP (JSON-RPC). Open tools via POST; server-push SSE is not required.',
        docs: 'https://fran-skums.vercel.app/help/connect-claude',
      }
    }

    const q = getQuery(event)
    const hasKeyHint = Boolean(
      opts?.pathToken || q.api_key || q.api || q.key || q.access_token || q.token,
    )
    return {
      name: 'fran-skums',
      version: '0.6.4-cloud',
      transport: 'streamable-http-jsonrpc',
      protocolVersion: '2024-11-05',
      auth: hasKeyHint
        ? 'API key detected in URL (Claude connector mode)'
        : 'Embed key in URL for Claude: /mcp?api_key=sk_live_… or /mcp/c/sk_live_… (also accepts ?api=)',
      docs: 'https://fran-skums.vercel.app/help/connect-claude',
      tools_hint: listToolsForTransport(true).map((t: any) => t.name),
      claude_personal_connector: {
        fields_supported: ['name', 'url', 'oauth_client_id (leave blank)', 'oauth_client_secret (leave blank)'],
        url_with_key_query: 'https://fran-skums.vercel.app/mcp?api_key=sk_live_YOUR_KEY',
        url_with_key_path: 'https://fran-skums.vercel.app/mcp/c/sk_live_YOUR_KEY',
        also_accepts: '?api=sk_live_… (alias for api_key)',
        oauth: 'not_required — leave client id/secret empty; put key in the URL',
        note: 'Use the FULL sk_live_… secret once (Settings → Create Claude key). Path form often works better if the client strips query strings.',
      },
    }
  }

  if (method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  let body: unknown
  try {
    body = await readBody(event)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' })
  }

  if (!body || (typeof body !== 'object' && !Array.isArray(body))) {
    throw createError({ statusCode: 400, statusMessage: 'JSON-RPC object or batch array required' })
  }

  if (isNotificationOnly(body)) {
    setResponseStatus(event, 202)
    return ''
  }

  const accept = String(getHeader(event, 'accept') || '').toLowerCase()
  const preferSse =
    accept.includes('text/event-stream')
    && !accept.includes('application/json')

  const requireAuth = needsAuth(body)
  let auth: Awaited<ReturnType<typeof authenticateRemoteMcp>> | null = null

  if (requireAuth) {
    try {
      auth = await authenticateRemoteMcp(event)
    } catch (e: any) {
      const msg =
        e?.statusMessage
        || e?.message
        || 'API key required'
      // MCP clients often treat HTTP 401 as "couldn't reach". Keep JSON-RPC on 200.
      setResponseStatus(event, 200)
      setHeader(event, 'Content-Type', preferSse ? 'text/event-stream' : 'application/json')
      setHeader(event, 'Cache-Control', 'no-cache')
      const id = !Array.isArray(body) && body && typeof body === 'object' ? (body as any).id ?? null : null
      const errBody = {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32001,
          message: msg,
          data: {
            docs: 'https://fran-skums.vercel.app/help/connect-claude',
            claude_personal:
              'Leave OAuth blank. URL must include the full secret: https://fran-skums.vercel.app/mcp?api_key=sk_live_… or https://fran-skums.vercel.app/mcp/c/sk_live_…',
            tip: 'Create key via Settings → Create Claude / MCP key, copy once, paste entire sk_live_… (base64url, may contain - and _).',
          },
        },
      }
      return preferSse ? formatJsonRpcAsSse(errBody) : errBody
    }
  }

  const sessionId = getHeader(event, 'mcp-session-id') || randomUUID()
  setHeader(event, 'Mcp-Session-Id', sessionId)

  let result: unknown
  if (auth) {
    setHeader(event, 'X-Fran-Mcp-Workspace', auth.workspaceId)
    setHeader(event, 'X-Fran-Mcp-Profile', 'cloud-safe')
    result = await runRemoteMcpJsonRpc(auth, body)
  } else {
    result = await handleMcpJsonRpc(body, { cloud: true })
  }

  if (preferSse) {
    setHeader(event, 'Content-Type', 'text/event-stream')
    setHeader(event, 'Cache-Control', 'no-cache')
    setHeader(event, 'Connection', 'keep-alive')
    return formatJsonRpcAsSse(result)
  }

  setHeader(event, 'Content-Type', 'application/json')
  return result
}
