/**
 * Phase R1 — Remote MCP endpoint (Streamable HTTP + JSON-RPC).
 *
 * URL: https://fran-skums.vercel.app/mcp
 * Auth: Bearer sk_live_… (required for tools/*; initialize/ping can be unauthenticated)
 *
 * Claude custom connectors often:
 * 1) Probe GET /mcp
 * 2) POST initialize (sometimes before attaching API key)
 * 3) POST tools/list + tools/call with Authorization
 * 4) Expect 202 for notifications/initialized (no body)
 */
import { randomUUID } from 'node:crypto'
import {
  authenticateRemoteMcp,
  listToolsForTransport,
  remoteMcpCorsHeaders,
  runRemoteMcpJsonRpc,
} from '../../utils/remoteMcp'
import { handleMcpJsonRpc } from '../../../mcp/src/httpProtocol.mjs'

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
    // JSON-RPC notification = has method, no id
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
    // resources/list & prompts/list are empty — allow unauth so handshake completes
    if (method === 'resources/list' || method === 'prompts/list') return false
    return true
  })
}

export default defineEventHandler(async (event) => {
  const cors = remoteMcpCorsHeaders()
  for (const [k, v] of Object.entries(cors)) setHeader(event, k, v)

  // Advertise Streamable HTTP session support (stateless: new id per initialize is fine)
  setHeader(event, 'Access-Control-Expose-Headers', 'Mcp-Session-Id, X-Fran-Mcp-Workspace, X-Fran-Mcp-Profile')

  const method = getMethod(event)
  if (method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return ''
  }

  // DELETE session terminate — optional, accept no-op
  if (method === 'DELETE') {
    setResponseStatus(event, 204)
    return ''
  }

  // Discovery / health (no auth)
  if (method === 'GET') {
    // Claude may request SSE on GET — we don't push events; return discovery JSON
    // (Spec allows 405 for no SSE; discovery JSON is more helpful for humans/probes.)
    return {
      name: 'fran-skums',
      version: '0.6.1-cloud',
      transport: 'streamable-http-jsonrpc',
      protocolVersion: '2024-11-05',
      auth: 'Authorization: Bearer sk_live_… (required for tools/list and tools/call)',
      docs: 'https://fran-skums.vercel.app/help/connect-claude',
      tools_hint: listToolsForTransport(true).map((t: any) => t.name),
      note: 'Server is up. POST initialize may omit API key; tools require API key from Settings → Create Claude/MCP key.',
      claude_setup: {
        url: 'https://fran-skums.vercel.app/mcp',
        oauth: 'not_supported_yet_use_api_key',
        leave_oauth_blank: true,
        authorization_header: 'Bearer sk_live_…',
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

  // Notifications only (e.g. notifications/initialized) → 202 Accepted, empty body
  if (isNotificationOnly(body)) {
    setResponseStatus(event, 202)
    return ''
  }

  const requireAuth = needsAuth(body)
  let auth: Awaited<ReturnType<typeof authenticateRemoteMcp>> | null = null

  if (requireAuth) {
    try {
      auth = await authenticateRemoteMcp(event)
    } catch (e: any) {
      // Surface a clear JSON-RPC error for Claude UI instead of only HTTP 401 body
      const status = e?.statusCode || 401
      const msg =
        e?.statusMessage
        || e?.message
        || 'API key required. Settings → API keys → Create Claude/MCP key. Authorization: Bearer sk_live_…'
      setResponseStatus(event, status)
      setHeader(event, 'Content-Type', 'application/json')
      setHeader(event, 'WWW-Authenticate', 'Bearer realm="fran-skums-mcp", error="invalid_token"')
      const id = !Array.isArray(body) && body && typeof body === 'object' ? (body as any).id ?? null : null
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32001,
          message: msg,
          data: {
            docs: 'https://fran-skums.vercel.app/help/connect-claude',
            how: 'Create key in SKUMS Settings → API keys. In Claude connector, leave OAuth empty; set Authorization Bearer sk_live_…',
          },
        },
      }
    }
  }

  setHeader(event, 'Content-Type', 'application/json')
  setHeader(event, 'Mcp-Session-Id', randomUUID())

  if (auth) {
    setHeader(event, 'X-Fran-Mcp-Workspace', auth.workspaceId)
    setHeader(event, 'X-Fran-Mcp-Profile', 'cloud-safe')
    return runRemoteMcpJsonRpc(auth, body)
  }

  // Unauthenticated public methods (initialize / ping / empty lists)
  return handleMcpJsonRpc(body, { cloud: true })
})
