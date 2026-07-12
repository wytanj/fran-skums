import assert from 'node:assert/strict'
import { describe, test, beforeEach, afterEach } from 'node:test'

const KEYS = [
  'FRAN_MCP_SCOPES',
  'MCP_SCOPES',
  'FRAN_MCP_PROFILE',
  'MCP_PROFILE',
  'FRAN_MCP_MODE',
  'MCP_MODE',
  'FRAN_MCP_CLIENT',
  'MCP_CLIENT',
  'FRAN_MCP_ACTOR_USER_ID',
  'MCP_ACTOR_USER_ID',
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

async function loadContext() {
  // Fresh import each time — module already loaded env once; we only test pure getters
  return import('../mcp/src/context.mjs')
}

describe('MCP scope profiles (M0)', () => {
  test('default (empty env) is safe profile', async () => {
    const { getMcpScopes, getMcpProfileName, MCP_SCOPE_PROFILES } = await loadContext()
    assert.equal(getMcpProfileName(), 'safe')
    assert.deepEqual(getMcpScopes(), MCP_SCOPE_PROFILES.safe)
  })

  test('FRAN_MCP_SCOPES=safe expands to safe list', async () => {
    process.env.FRAN_MCP_SCOPES = 'safe'
    const { getMcpScopes, getMcpProfileName, MCP_SCOPE_PROFILES } = await loadContext()
    assert.equal(getMcpProfileName(), 'safe')
    assert.deepEqual(getMcpScopes(), MCP_SCOPE_PROFILES.safe)
  })

  test('FRAN_MCP_PROFILE=full is unrestricted', async () => {
    process.env.FRAN_MCP_PROFILE = 'full'
    const { getMcpScopes, getMcpProfileName } = await loadContext()
    assert.equal(getMcpProfileName(), 'full')
    assert.equal(getMcpScopes(), null)
  })

  test('FRAN_MCP_SCOPES=full and * are unrestricted', async () => {
    const { getMcpScopes } = await loadContext()
    process.env.FRAN_MCP_SCOPES = 'full'
    assert.equal(getMcpScopes(), null)
    process.env.FRAN_MCP_SCOPES = '*'
    assert.equal(getMcpScopes(), null)
  })

  test('custom comma list', async () => {
    process.env.FRAN_MCP_SCOPES = 'intel:read, po:draft'
    const { getMcpScopes, getMcpProfileName, requireScope } = await loadContext()
    assert.equal(getMcpProfileName(), 'custom')
    assert.deepEqual(getMcpScopes(), ['intel:read', 'po:draft'])
    requireScope('po:draft')
    assert.throws(() => requireScope('po:decide'), /MCP scope denied/)
  })

  test('safe profile denies privileged scopes', async () => {
    process.env.FRAN_MCP_PROFILE = 'safe'
    const { requireScope, MCP_PRIVILEGED_SCOPES } = await loadContext()
    requireScope('po:draft')
    requireScope('pipeline:propose')
    requireScope('intel:read')
    for (const s of MCP_PRIVILEGED_SCOPES) {
      assert.throws(() => requireScope(s), /MCP scope denied/)
    }
  })

  test('client and actor helpers', async () => {
    process.env.FRAN_MCP_CLIENT = 'cursor'
    process.env.FRAN_MCP_ACTOR_USER_ID = '11111111-1111-1111-1111-111111111111'
    const { getMcpClientName, getMcpActorUserId } = await loadContext()
    assert.equal(getMcpClientName(), 'cursor')
    assert.equal(getMcpActorUserId(), '11111111-1111-1111-1111-111111111111')
  })

  test('FRAN_MCP_MODE=safe hard-blocks privileged even with full scopes', async () => {
    process.env.FRAN_MCP_SCOPES = 'full'
    process.env.FRAN_MCP_MODE = 'safe'
    const { requireScope } = await loadContext()
    assert.throws(() => requireScope('po:submit'), /MCP mode=safe blocks/)
    assert.throws(() => requireScope('pipeline:execute'), /MCP mode=safe blocks/)
  })
})
