/**
 * Key-scoped permitted tools / capabilities fast path
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isToolPermitted,
  resolvePermittedTools,
  TOOL_SCOPE_CATALOG,
  privilegedToolNames,
} from '../mcp/src/toolScopes.mjs'
import { mcpCapabilities } from '../core/ops/index.mjs'
import { MCP_SCOPE_PROFILES } from '../mcp/src/context.mjs'

test('safe profile permits catalog + draft store request; not po_submit', () => {
  const safe = MCP_SCOPE_PROFILES.safe
  assert.equal(isToolPermitted('catalog_health', { scopes: safe, cloud: true }), true)
  assert.equal(isToolPermitted('capabilities', { scopes: safe, cloud: true }), true)
  assert.equal(isToolPermitted('store_ops_create_draft_request', { scopes: safe, cloud: true }), true)
  assert.equal(isToolPermitted('po_create_draft', { scopes: safe, cloud: true }), true)
  assert.equal(isToolPermitted('po_submit', { scopes: safe, cloud: true }), false)
  assert.equal(isToolPermitted('pipeline_execute', { scopes: safe, cloud: true }), false)
  assert.equal(isToolPermitted('bi_run_seed_now', { scopes: safe, cloud: true }), false)
})

test('intel:read-only key cannot draft store request or PO', () => {
  const scopes = ['intel:read']
  assert.equal(isToolPermitted('catalog_health', { scopes, cloud: true }), true)
  assert.equal(isToolPermitted('store_ops_create_draft_request', { scopes, cloud: true }), false)
  assert.equal(isToolPermitted('po_create_draft', { scopes, cloud: true }), false)
  assert.equal(isToolPermitted('store_ops_list_requests', { scopes, cloud: true }), false)
})

test('resolvePermittedTools returns human actions for safe cloud', () => {
  const r = resolvePermittedTools({ scopes: MCP_SCOPE_PROFILES.safe, cloud: true })
  assert.ok(r.permitted_actions.length > 10)
  assert.ok(r.permitted_tool_names.includes('capabilities'))
  assert.ok(r.permitted_tool_names.includes('catalog_health'))
  assert.ok(!r.permitted_tool_names.includes('po_submit'))
  assert.ok(
    r.denied_tools.some(
      (d) => d.tool === 'po_submit' && /requires_scope:po:submit|missing_scope/.test(d.reason),
    ),
  )
})

test('owner scopes permit store_ops_decide on cloud', () => {
  const scopes = [
    ...MCP_SCOPE_PROFILES.safe,
    'store_ops:approve',
    'inventory:write',
  ]
  assert.equal(isToolPermitted('store_ops_decide', { scopes, cloud: true }), true)
  assert.equal(isToolPermitted('floor_adjustment_apply', { scopes, cloud: true }), true)
  assert.equal(isToolPermitted('store_ops_decide', { scopes: MCP_SCOPE_PROFILES.safe, cloud: true }), false)
})

test('mcpCapabilities embeds key_permissions when permitted passed', () => {
  const permitted = resolvePermittedTools({ scopes: MCP_SCOPE_PROFILES.safe, cloud: true })
  const cap = mcpCapabilities({
    cloud: true,
    profile: 'safe',
    mode: 'safe',
    scopes: MCP_SCOPE_PROFILES.safe,
    key_name: 'Claude connector',
    permitted,
  })
  assert.ok(cap.key_permissions)
  assert.ok(cap.key_permissions.permitted_actions.length > 0)
  assert.equal(cap.runtime.key_name, 'Claude connector')
  assert.match(cap.agent_hint, /permitted_actions/)
  assert.equal(cap.can.draft_store_replenishment_request, true)
  assert.equal(cap.cannot.approve_store_replenishment, true)
})

test('every catalog tool has a scope entry', () => {
  assert.ok(TOOL_SCOPE_CATALOG.catalog_export_csv)
  assert.ok(TOOL_SCOPE_CATALOG.store_ops_create_draft_request)
  assert.ok(privilegedToolNames().includes('po_submit'))
})
