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

  test('products:read maps to intel:read only', async () => {
    const { resolveCloudMcpScopes } = await import(contextPath.href)
    assert.deepEqual(resolveCloudMcpScopes(['products:read']), ['intel:read'])
  })

  test('pos-only key throws', async () => {
    const { resolveCloudMcpScopes } = await import(contextPath.href)
    assert.throws(() => resolveCloudMcpScopes(['pos:write']), /no MCP-compatible scopes/)
  })

  test('never returns privileged scopes', async () => {
    const { resolveCloudMcpScopes, MCP_PRIVILEGED_SCOPES } = await import(contextPath.href)
    const scopes = resolveCloudMcpScopes(['mcp:safe', 'po:submit', 'pipeline:execute'])
    for (const p of MCP_PRIVILEGED_SCOPES) {
      assert.ok(!scopes.includes(p), `should not include ${p}`)
    }
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
        assert.throws(() => requireScope('po:submit'), /Cloud MCP blocks privileged/)
      },
    )
    assert.equal(getWorkspaceId(), 'env-ws')
    assert.equal(isCloudMcpRequest(), false)
  })
})

describe('http JSON-RPC protocol', () => {
  test('initialize and tools/list filter privileged on cloud', async () => {
    const { handleMcpJsonRpc, privilegedToolNames } = await import(httpPath.href)
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
    assert.ok(names.includes('catalog_stats'))
    assert.ok(names.includes('help_resolve'))
    assert.ok(names.includes('help_get'))
    for (const p of privilegedToolNames()) {
      assert.ok(!names.includes(p), `cloud list must omit ${p}`)
    }
  })

  test('tools/call privileged name rejected on cloud without running handler', async () => {
    const { handleMcpJsonRpc } = await import(httpPath.href)
    const res = await handleMcpJsonRpc(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'po_submit', arguments: { po_id: 'x' } },
      },
      { cloud: true },
    )
    assert.ok(res.error)
    assert.match(res.error.message, /not available on cloud MCP/)
  })
})

describe('wiring', () => {
  test('route and settings expose /mcp connector', () => {
    const route = readFileSync(routePath, 'utf8')
    const util = readFileSync(remoteUtil, 'utf8')
    const ui = readFileSync(settings, 'utf8')
    assert.match(route, /authenticateRemoteMcp/)
    assert.match(route, /runRemoteMcpJsonRpc/)
    assert.match(util, /resolveCloudMcpScopes/)
    assert.match(ui, /Create Claude \/ MCP key/)
    assert.match(ui, /mcpEndpointUrl/)
    assert.match(ui, /MCP_SAFE_SCOPES/)
  })

  test('help seed for connect-claude exists', () => {
    const sql = readFileSync(migration, 'utf8')
    assert.match(sql, /connect-claude/)
    assert.match(sql, /fran-skums\.vercel\.app\/mcp/)
  })
})
