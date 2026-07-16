/**
 * Road-ahead order 1–4: M1/M2 packs, M3 exception_verify, inventory_manager, empty-key ≠ full.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { hasScope, expandScopePackage, defaultMcpPackageForRole } from '../server/utils/scopes.ts'
import { hasScope as apiKeyHasScope } from '../server/utils/apiAuth.ts'
import { resolveCloudMcpScopes } from '../mcp/src/context.mjs'
import { listToolsForTransport } from '../mcp/src/httpProtocol.mjs'
import { isToolPermitted } from '../mcp/src/toolScopes.mjs'

describe('M1–M3 MCP packs', () => {
  test('tool definitions and handlers exist', () => {
    const tools = readFileSync(new URL('../mcp/src/tools.mjs', import.meta.url), 'utf8')
    assert.match(tools, /name: 'store_request_status'/)
    assert.match(tools, /name: 'floor_adjustment_queue'/)
    assert.match(tools, /name: 'exception_verify'/)
    assert.match(tools, /getRequestStatusPack/)
    assert.match(tools, /floorAdjustmentQueue/)
    assert.match(tools, /verifyException/)
    assert.match(tools, /requireScope\('store_ops:verify'\)/)

    const lib = readFileSync(new URL('../mcp/src/lib/storeOps.mjs', import.meta.url), 'utf8')
    assert.match(lib, /export async function getRequestStatusPack/)
    assert.match(lib, /export async function floorAdjustmentQueue/)
    assert.match(lib, /export async function verifyException/)
  })

  test('tool scopes catalog maps M1–M3', () => {
    const cat = readFileSync(new URL('../mcp/src/toolScopes.mjs', import.meta.url), 'utf8')
    assert.match(cat, /store_request_status/)
    assert.match(cat, /floor_adjustment_queue/)
    assert.match(cat, /exception_verify/)
    assert.equal(isToolPermitted('store_request_status', { scopes: ['store_ops:read'], cloud: true }), true)
    assert.equal(isToolPermitted('exception_verify', { scopes: ['store_ops:read'], cloud: true }), false)
    assert.equal(isToolPermitted('exception_verify', { scopes: ['store_ops:verify'], cloud: true }), true)
  })

  test('inventory manager package has approve/verify, not execute_3pl', () => {
    const pkg = expandScopePackage('inventory_manager')
    assert.ok(hasScope(pkg, 'store_ops:approve'))
    assert.ok(hasScope(pkg, 'store_ops:verify'))
    assert.ok(hasScope(pkg, 'inventory:write'))
    assert.equal(hasScope(pkg, 'store_ops:execute_3pl'), false)
    assert.equal(defaultMcpPackageForRole('inventory_manager'), 'mcp:inventory_manager')
    assert.equal(defaultMcpPackageForRole('inventory_ops'), 'mcp:inventory_manager')

    const cloud = resolveCloudMcpScopes(['mcp:inventory_manager'])
    assert.ok(cloud.includes('store_ops:approve'))
    assert.ok(cloud.includes('store_ops:verify'))
    assert.ok(!cloud.includes('store_ops:execute_3pl'))
    const tools = listToolsForTransport(true, cloud)
    assert.ok(tools.some((t) => t.name === 'store_request_status'))
    assert.ok(tools.some((t) => t.name === 'exception_verify'))
    assert.ok(tools.some((t) => t.name === 'store_ops_decide'))
    assert.ok(!tools.some((t) => t.name === 'pipeline_execute'))
  })

  test('migration 065 inventory manager schema', () => {
    const sql = readFileSync(new URL('../core/db/065_inventory_manager_schema.sql', import.meta.url), 'utf8')
    assert.match(sql, /inventory_manager/)
    assert.match(sql, /Inventory Manager/)
    assert.match(sql, /inventory_ops/)
  })
})

describe('Phase P empty non-MCP keys ≠ full', () => {
  test('hasScope empty array denies by default', () => {
    assert.equal(hasScope([], 'pos:write'), false)
    assert.equal(hasScope([], 'pos:write', { emptyMeansFull: true }), true)
    assert.equal(hasScope(['*'], 'pos:write'), true)
  })

  test('apiAuth hasScope empty key denies', () => {
    assert.equal(apiKeyHasScope({ scopes: [] }, 'pos:write'), false)
    assert.equal(apiKeyHasScope({ scopes: ['pos:write'] }, 'pos:write'), true)
    assert.equal(apiKeyHasScope({ scopes: ['*'] }, 'store_ops:approve'), true)
  })
})
