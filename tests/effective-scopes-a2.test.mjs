/**
 * A2 — effective scopes: key ∩ web user ∩ cloud ceiling
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  applyCloudMcpCeiling,
  bridgeWebScopesToMcp,
  computeEffectiveScopes,
  defaultMcpPackageForRole,
  expandKeyScopes,
  expandScopePackage,
  intersectScopes,
  MCP_CLOUD_SAFE_SCOPES,
} from '../server/utils/scopes.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = readFileSync(join(root, 'core/db/063_api_keys_bound_user.sql'), 'utf8')
const design = readFileSync(join(root, 'docs/MCP_USER_PERMISSION_DESIGN.md'), 'utf8')

test('migration 063 adds bound_user and soft revoke', () => {
  assert.match(mig, /bound_user_id/)
  assert.match(mig, /key_kind/)
  assert.match(mig, /max_package/)
  assert.match(mig, /revoked_at/)
})

test('design documents cap rule', () => {
  assert.match(design, /bound_user/)
  assert.match(design, /api:write/)
})

test('mcp packages expand to cloud-safe set', () => {
  const safe = expandScopePackage('mcp:safe')
  assert.ok(safe.includes('intel:read'))
  assert.ok(safe.includes('po:draft'))
  assert.ok(safe.includes('store_ops:write'))
  assert.ok(!safe.includes('po:submit'))
  assert.ok(!safe.includes('store_ops:execute_3pl'))
})

test('viewer package has no writes', () => {
  const v = expandScopePackage('mcp:viewer')
  assert.ok(v.includes('intel:read'))
  assert.ok(!v.includes('store_ops:write'))
  assert.ok(!v.includes('po:draft'))
})

test('defaultMcpPackageForRole', () => {
  assert.equal(defaultMcpPackageForRole('owner'), 'mcp:ops_safe')
  assert.equal(defaultMcpPackageForRole('viewer'), 'mcp:viewer')
  assert.equal(defaultMcpPackageForRole('member'), 'mcp:member')
})

test('bridgeWebScopesToMcp maps actions to po:draft', () => {
  const b = bridgeWebScopesToMcp(['actions:write', 'products:read', 'store_ops:write'])
  assert.ok(b.includes('po:draft'))
  assert.ok(b.includes('pipeline:propose'))
  assert.ok(b.includes('intel:read'))
  assert.ok(b.includes('store_ops:write'))
})

test('viewer web scopes cannot keep store_ops:write from key', () => {
  const key = expandScopePackage('mcp:safe')
  const user = bridgeWebScopesToMcp([
    'products:read',
    'inventory:read',
    'store_ops:read',
    'actions:read',
    'intel:read',
  ])
  const effective = computeEffectiveScopes({
    keyScopes: key,
    userWebScopes: user,
    cloud: true,
  })
  assert.ok(effective.includes('intel:read'))
  assert.ok(effective.includes('store_ops:read'))
  assert.ok(!effective.includes('store_ops:write'), 'viewer must not retain store_ops:write')
  assert.ok(!effective.includes('po:draft'))
})

test('owner web scopes retain approve under permission-based cloud ceiling', () => {
  const effective = computeEffectiveScopes({
    keyScopes: ['mcp:ops_safe'],
    userWebScopes: [
      'products:read',
      'products:write',
      'inventory:read',
      'inventory:write',
      'store_ops:read',
      'store_ops:write',
      'store_ops:approve',
      'store_ops:execute_3pl',
      'actions:write',
      'actions:submit',
      'actions:approve',
      'intel:read',
      'intel:write',
      'api:write',
    ],
    cloud: true,
  })
  assert.ok(effective.includes('store_ops:write'))
  assert.ok(effective.includes('store_ops:approve'), 'owner may approve on cloud when scoped')
  assert.ok(effective.includes('po:draft'))
  assert.ok(effective.includes('po:decide') || effective.includes('actions:approve'))
})

test('applyCloudMcpCeiling keeps store ops approve; strips credentials only', () => {
  const c = applyCloudMcpCeiling([
    'intel:read',
    'po:submit',
    'store_ops:execute_3pl',
    'store_ops:approve',
    'po:draft',
    'credentials:write',
  ])
  assert.ok(c.includes('intel:read'))
  assert.ok(c.includes('po:draft'))
  assert.ok(c.includes('po:submit'))
  assert.ok(c.includes('store_ops:execute_3pl'))
  assert.ok(c.includes('store_ops:approve'))
  assert.ok(!c.includes('credentials:write'))
})

test('intersectScopes and expandKeyScopes', () => {
  assert.deepEqual(
    intersectScopes(['a', 'b', 'c'], ['b', 'c', 'd']).sort(),
    ['b', 'c'],
  )
  assert.ok(expandKeyScopes(['mcp:viewer']).includes('intel:read'))
  assert.ok(MCP_CLOUD_SAFE_SCOPES.includes('po:draft'))
})

test('assistant tools and revoke route exist', () => {
  const tools = readFileSync(join(root, 'server/utils/assistantTools.ts'), 'utf8')
  assert.match(tools, /filterToolDefinitionsByScopes/)
  assert.match(tools, /ASSISTANT_TOOL_SCOPES/)
  const revoke = readFileSync(join(root, 'server/api/v1/keys/[id]/revoke.post.ts'), 'utf8')
  assert.match(revoke, /revoked_at/)
  assert.match(revoke, /owner\/admin/)
})
