/**
 * MCP + Catalog AI instruction tighten (composite #4)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  buildMcpAgentInstructions,
  getCloudMcpInstructions,
  getStdioMcpInstructions,
  COMPOSITE_ROUTING,
  ANSWER_STYLE,
} from '../mcp/src/agentInstructions.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const httpProto = readFileSync(join(root, 'mcp/src/httpProtocol.mjs'), 'utf8')
const stdio = readFileSync(join(root, 'mcp/src/index.mjs'), 'utf8')
const assistantPrompt = readFileSync(join(root, 'server/utils/assistantPrompt.ts'), 'utf8')
const readme = readFileSync(join(root, 'mcp/README.md'), 'utf8')
const todo = readFileSync(join(root, 'TODO.md'), 'utf8')

test('cloud and stdio wire shared agentInstructions module', () => {
  assert.match(httpProto, /getCloudMcpInstructions/)
  assert.match(stdio, /getStdioMcpInstructions/)
  assert.match(stdio, /instructions:\s*getStdioMcpInstructions/)
})

test('getCloudMcpInstructions is composite-first and short-answer', () => {
  const text = getCloudMcpInstructions()
  assert.match(text, /catalog_health/)
  assert.match(text, /product_inventory_status/)
  assert.match(text, /ops_snapshot/)
  assert.match(text, /capabilities/)
  assert.match(text, /1–2 tools|1-2 tools/)
  assert.match(text, /stock_quantity/)
  assert.match(text, /invoice/i)
  assert.match(text, /CLOUD-SAFE|cloud/i)
  assert.ok(text.length > 400)
  assert.ok(text.length < 4500, 'initialize.instructions should stay reasonably compact')
})

test('stdio instructions include PO clone stop rule', () => {
  const text = getStdioMcpInstructions()
  assert.match(text, /po_clone_as_draft|deep_link/)
  assert.match(text, /SAFE/)
})

test('routing table lists all composites', () => {
  for (const name of [
    'catalog_health',
    'catalog_sample',
    'catalog_search_summary',
    'product_inventory_status',
    'inventory_ats',
    'ops_snapshot',
    'capabilities',
    'help_resolve',
  ]) {
    assert.match(COMPOSITE_ROUTING, new RegExp(name))
  }
  assert.match(ANSWER_STYLE, /Lead with the direct answer/)
})

test('buildMcpAgentInstructions cloud vs local safety lines differ', () => {
  const cloud = buildMcpAgentInstructions({ cloud: true })
  const local = buildMcpAgentInstructions({ cloud: false })
  assert.match(cloud, /CLOUD-SAFE/)
  assert.match(local, /SAFE by default/)
})

test('Catalog AI prompt has answer style + composite routing table', () => {
  assert.match(assistantPrompt, /Answer style \(critical/)
  assert.match(assistantPrompt, /Composite-first routing/)
  assert.match(assistantPrompt, /get_catalog_health/)
  assert.match(assistantPrompt, /get_product_inventory_status/)
  assert.match(assistantPrompt, /get_ops_snapshot/)
  assert.match(assistantPrompt, /get_capabilities/)
  assert.match(assistantPrompt, /1–2 tool calls|Budget \*\*1–2/)
  assert.match(assistantPrompt, /Two AI surfaces/)
  assert.match(assistantPrompt, /NEVER invent product counts|Never invent product counts/i)
})

test('README points at agentInstructions source of truth', () => {
  assert.match(readme, /agentInstructions\.mjs/)
  assert.match(readme, /Composite-first/)
})

test('TODO marks #4 done and defers MCP user permission scopes', () => {
  assert.match(todo, /composite-first\)\s+✅/)
  assert.match(todo, /MCP user permission/)
  assert.match(todo, /Deferred \(user asked later\)/)
})
