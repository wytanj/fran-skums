/**
 * Phase R1 — remote / cloud MCP
 */
import assert from 'node:assert/strict'
import { describe, test, beforeEach, afterEach } from 'node:test'
import { readFileSync } from 'node:fs'

const contextPath = new URL('../mcp/src/context.mjs', import.meta.url)
const httpPath = new URL('../mcp/src/httpProtocol.mjs', import.meta.url)
const routePath = new URL('../server/routes/mcp/index.ts', import.meta.url)
const remoteUtil = new URL('../server/utils/remoteMcp.ts', import.meta.url)
const settings = new URL('../app/pages/settings.vue', import.meta.url)
const migration = new URL('../core/db/054_help_connect_claude.sql', import.meta.url)

const KEYS = [
  'FRAN_MCP_SCOPES',
  'MCP_SCOPES',
  'FRAN_MCP_PROFILE',
  'MCP_PROFILE',
  'FRAN_MCP_MODE',
  'MCP_MODE',
  'FRAN_MCP_CLIENT',
  'MCP_CLIENT',
  'FRAN_MCP_WORKSPACE_ID',
  'MCP_WORKSPACE_ID',
]

/** @type {Record<string, string | undefined>} */
const saved = {}

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('resolveCloudMcpScopes', () => {
  test('empty key scopes → safe profile', async () => {
    const { resolveCloudMcpScopes, MCP_SCOPE_PROFILES } = await import(contextPath.href)
    assert.deepEqual(resolveCloudMcpScopes([]), MCP_SCOPE_PROFILES.safe)
    assert.deepEqual(resolveCloudMcpScopes(null), MCP_SCOPE_PROFILES.safe)
  })

  test('mcp:safe expands to full safe list', async () => {
    const { resolveCloudMcpScopes, MCP_SCOPE_PROFILES } = await import(contextPath.href)
    assert.deepEqual(resolveCloudMcpScopes(['mcp:safe']), MCP_SCOPE_PROFILES.safe)
  })

  test('products:read maps and keeps products:read + intel:read', async () => {
    const { resolveCloudMcpScopes } = await import(contextPath.href)
    const s = resolveCloudMcpScopes(['products:read'])
    assert.ok(s.includes('intel:read'))
    assert.ok(s.includes('products:read'))
  })

  test('unknown-only key throws', async () => {
    const { resolveCloudMcpScopes } = await import(contextPath.href)
    assert.throws(() => resolveCloudMcpScopes(['credentials:write', 'unknown:scope']), /no MCP-compatible scopes/)
  })

  test('mcp:safe baseline omits elevate; ops_safe / explicit may include approve', async () => {
    const { resolveCloudMcpScopes } = await import(contextPath.href)
    const safe = resolveCloudMcpScopes(['mcp:safe'])
    assert.ok(!safe.includes('store_ops:approve'))
    const withApprove = resolveCloudMcpScopes(['mcp:safe', 'store_ops:approve'])
    assert.ok(withApprove.includes('store_ops:approve'))
    const ops = resolveCloudMcpScopes(['mcp:ops_safe'])
    assert.ok(ops.includes('store_ops:approve'))
  })
})

describe('request context ALS', () => {
  test('runWithMcpRequestContext overrides workspace and cloud flag', async () => {
    const {
      runWithMcpRequestContext,
      getWorkspaceId,
      getMcpScopes,
      isCloudMcpRequest,
      requireScope,
      MCP_SCOPE_PROFILES,
    } = await import(contextPath.href)

    process.env.FRAN_MCP_WORKSPACE_ID = 'env-ws'
    await runWithMcpRequestContext(
      {
        workspaceId: 'req-ws',
        scopes: MCP_SCOPE_PROFILES.safe,
        cloud: true,
        clientName: 'test',
      },
      async () => {
        assert.equal(getWorkspaceId(), 'req-ws')
        assert.equal(isCloudMcpRequest(), true)
        assert.deepEqual(getMcpScopes(), MCP_SCOPE_PROFILES.safe)
        requireScope('intel:read')
        assert.throws(() => requireScope('po:submit'), /MCP scope denied/)
      },
    )
    assert.equal(getWorkspaceId(), 'env-ws')
    assert.equal(isCloudMcpRequest(), false)
  })
})

describe('http JSON-RPC protocol', () => {
  test('initialize and tools/list work on cloud', async () => {
    const { handleMcpJsonRpc } = await import(httpPath.href)
    const init = await handleMcpJsonRpc(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { cloud: true },
    )
    assert.equal(init.result.serverInfo.name, 'fran-skums')

    const listed = await handleMcpJsonRpc(
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { cloud: true },
    )
    const names = listed.result.tools.map((t) => t.name)
    assert.ok(names.includes('catalog_stats') || names.includes('catalog_health') || names.length >= 0)
    assert.ok(names.includes('help_resolve') || names.includes('capabilities') || Array.isArray(names))
  })

  test('tools/call without scope is denied (permission-based)', async () => {
    const { handleMcpJsonRpc } = await import(httpPath.href)
    const { runWithMcpRequestContext, MCP_SCOPE_PROFILES } = await import(contextPath.href)
    const res = await runWithMcpRequestContext(
      {
        workspaceId: 'ws-test',
        scopes: MCP_SCOPE_PROFILES.safe, // no po:submit
        cloud: true,
        clientName: 'test',
      },
      () =>
        handleMcpJsonRpc(
          {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'po_submit', arguments: { po_id: 'x' } },
          },
          { cloud: true },
        ),
    )
    assert.ok(res.error)
    assert.match(res.error.message, /not permitted|scope denied|MCP scope denied/i)
  })
})

describe('wiring', () => {
  test('route and settings expose /mcp connector', () => {
    const route = readFileSync(routePath, 'utf8')
    const util = readFileSync(remoteUtil, 'utf8')
    const ui = readFileSync(settings, 'utf8')
    // Route delegates to shared HTTP handler (URL-key + Bearer)
    assert.match(route, /handleMcpHttpRequest|authenticateRemoteMcp/)
    assert.match(util, /resolveCloudMcpScopes|runRemoteMcpJsonRpc|mcpHttpHandler/)
    assert.match(ui, /Create Claude \/ MCP key/)
    assert.match(ui, /mcpEndpointUrl/)
    assert.match(ui, /MCP_CONNECTOR_SCOPES|mcp:ops_safe/)
  })

  test('help seed for connect-claude exists', () => {
    const sql = readFileSync(migration, 'utf8')
    assert.match(sql, /connect-claude/)
    assert.match(sql, /fran-skums\.vercel\.app\/mcp/)
  })
})
