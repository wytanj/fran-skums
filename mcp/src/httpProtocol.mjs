/**
 * Stateless JSON-RPC MCP over HTTP (Phase R1).
 * Supports initialize, tools/list, tools/call, ping — enough for remote clients.
 */
import { toolDefinitions, handleTool } from './tools.mjs'
import { MCP_PRIVILEGED_SCOPES, MCP_SCOPE_PROFILES } from './context.mjs'

const SERVER_INFO = {
  name: 'fran-skums',
  version: '0.6.0-cloud',
}

/** Prefer widely supported version; clients may send 2025-03-26 / 2025-06-18 */
const PROTOCOL_VERSION = '2024-11-05'
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
])

/** Tools that require privileged scopes — never listed on cloud */
const PRIVILEGED_TOOL_NAMES = new Set([
  'pipeline_decide',
  'pipeline_execute',
  'po_submit',
  'po_decide',
  'bi_upsert_seed',
  'bi_set_cadence',
  'bi_run_seed_now',
])

/**
 * @param {boolean} cloud
 */
export function listToolsForTransport(cloud = false) {
  if (!cloud) return toolDefinitions
  return toolDefinitions.filter((t) => !PRIVILEGED_TOOL_NAMES.has(t.name))
}

/**
 * @param {unknown} body
 * @param {{ cloud?: boolean }} [opts]
 */
export async function handleMcpJsonRpc(body, opts = {}) {
  const cloud = opts.cloud === true
  const messages = Array.isArray(body) ? body : [body]
  const results = []

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') {
      results.push(rpcError(null, -32600, 'Invalid Request'))
      continue
    }

    const { id, method, params } = msg

    // Notifications (no id) — acknowledge without body requirement
    if (id === undefined && method && String(method).startsWith('notifications/')) {
      continue
    }

    if (!method) {
      results.push(rpcError(id ?? null, -32600, 'Invalid Request: method required'))
      continue
    }

    try {
      const result = await dispatchMethod(String(method), params || {}, { cloud })
      if (id !== undefined) {
        results.push({ jsonrpc: '2.0', id, result })
      }
    } catch (err) {
      const message = err?.message || String(err)
      const code = /scope denied|blocks privileged|API key/i.test(message) ? -32001 : -32000
      if (id !== undefined) {
        results.push(rpcError(id, code, message))
      }
    }
  }

  if (!Array.isArray(body)) return results[0] ?? { jsonrpc: '2.0', result: {} }
  return results
}

/**
 * @param {string} method
 * @param {Record<string, unknown>} params
 * @param {{ cloud?: boolean }} opts
 */
async function dispatchMethod(method, params, opts) {
  switch (method) {
    case 'initialize': {
      const requested = String(params.protocolVersion || PROTOCOL_VERSION)
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested)
        ? requested
        : PROTOCOL_VERSION
      return {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          // No resources/prompts required for R1
        },
        serverInfo: SERVER_INFO,
        instructions:
          'Fran SKUMS remote MCP (cloud-safe). Auth: Authorization Bearer sk_live_… from SKUMS Settings → API keys (leave OAuth client id/secret empty). Use catalog_* for product Q&A; help_resolve / help_get for store-ops how-to; draft PO tools only. Humans approve in Actions UI. tools/list and tools/call require API key.',
      }
    }

    case 'ping':
      return {}

    case 'tools/list':
      return { tools: listToolsForTransport(opts.cloud === true) }

    case 'tools/call': {
      const name = String(params.name || '')
      if (!name) throw new Error('tools/call requires params.name')
      if (opts.cloud && PRIVILEGED_TOOL_NAMES.has(name)) {
        throw new Error(
          `Tool "${name}" is not available on cloud MCP. Use SKUMS Actions UI for privileged steps.`,
        )
      }
      const args =
        params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
          ? params.arguments
          : {}
      return handleTool(name, args)
    }

    case 'resources/list':
      return { resources: [] }

    case 'prompts/list':
      return { prompts: [] }

    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 })
  }
}

function rpcError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  }
}

export function cloudSafeScopes() {
  return [...MCP_SCOPE_PROFILES.safe]
}

export function privilegedToolNames() {
  return [...PRIVILEGED_TOOL_NAMES]
}

export { MCP_PRIVILEGED_SCOPES }
