/**
 * A2.4 — API key lifecycle on member role change / remove
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { defaultMcpPackageForRole, expandScopePackage } from '../server/utils/scopes.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lifecycle = readFileSync(join(root, 'server/utils/apiKeyLifecycle.ts'), 'utf8')
const roleRoute = readFileSync(join(root, 'server/api/v1/workspace/members/[userId]/role.put.ts'), 'utf8')
const removeRoute = readFileSync(join(root, 'server/api/v1/workspace/members/[userId]/index.delete.ts'), 'utf8')
const team = readFileSync(join(root, 'app/composables/useTeam.ts'), 'utf8')
const todo = readFileSync(join(root, 'TODO.md'), 'utf8')
const design = readFileSync(join(root, 'docs/MCP_USER_PERMISSION_DESIGN.md'), 'utf8')

test('lifecycle helpers export revoke and recap', () => {
  assert.match(lifecycle, /export async function revokeBoundApiKeys/)
  assert.match(lifecycle, /export async function recapBoundApiKeys/)
  assert.match(lifecycle, /api_key\.revoked/)
  assert.match(lifecycle, /api_key\.recapped/)
  assert.match(lifecycle, /api_key\.created/)
})

test('member role and remove routes wire lifecycle', () => {
  assert.match(roleRoute, /recapBoundApiKeys/)
  assert.match(roleRoute, /Only the workspace owner can appoint/)
  assert.match(removeRoute, /revokeBoundApiKeys/)
  assert.match(removeRoute, /member_removed/)
  assert.match(removeRoute, /Cannot remove the workspace owner/)
})

test('useTeam calls server lifecycle APIs', () => {
  assert.match(team, /\/api\/v1\/workspace\/members\//)
  assert.match(team, /method: 'PUT'/)
  assert.match(team, /method: 'DELETE'/)
})

test('demotion package shrinks power', () => {
  const admin = expandScopePackage(defaultMcpPackageForRole('admin'))
  const viewer = expandScopePackage(defaultMcpPackageForRole('viewer'))
  assert.ok(admin.includes('store_ops:write') || admin.includes('po:draft'))
  assert.ok(!viewer.includes('store_ops:write'))
  assert.ok(viewer.includes('intel:read'))
})

test('TODO and design mark A2.4', () => {
  assert.match(todo, /A2\.4|member lifecycle|recap/)
  assert.match(design, /A2\.4/)
})
