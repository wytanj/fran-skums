/**
 * MCP backlog #8 composites
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  lowStockRequestPack,
  posEnableProposal,
  exceptionsSnapshot,
} from '../core/ops/index.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tools = readFileSync(join(root, 'mcp/src/tools.mjs'), 'utf8')
const scopes = readFileSync(join(root, 'mcp/src/toolScopes.mjs'), 'utf8')
const assistant = readFileSync(join(root, 'server/utils/assistantTools.ts'), 'utf8')
const storeOps = readFileSync(join(root, 'mcp/src/lib/storeOps.mjs'), 'utf8')
const todo = readFileSync(join(root, 'TODO.md'), 'utf8')
const backlog = readFileSync(join(root, 'docs/MCP_ACTION_BACKLOG.md'), 'utf8')

const TOOL_NAMES = [
  'expiry_snapshot',
  'exceptions_snapshot',
  'integrations_health',
  'attention_snapshot',
  'low_stock_request_pack',
  'pos_enable_proposal',
  'inbound_create_draft',
  'floor_adjustment_create_draft',
]

test('MCP registers all #8 tools', () => {
  for (const n of TOOL_NAMES) {
    assert.match(tools, new RegExp(`name: '${n}'`))
    assert.match(tools, new RegExp(`case '${n}'`))
    assert.match(scopes, new RegExp(n))
  }
})

test('assistant twins for #8 reads', () => {
  assert.match(assistant, /get_expiry_snapshot/)
  assert.match(assistant, /get_exceptions_snapshot/)
  assert.match(assistant, /get_integrations_health/)
  assert.match(assistant, /get_attention_snapshot/)
  assert.match(assistant, /get_low_stock_request_pack/)
  assert.match(assistant, /get_pos_enable_proposal/)
})

test('storeOps has inbound and floor draft', () => {
  assert.match(storeOps, /createInboundDraft/)
  assert.match(storeOps, /createFloorAdjustmentDraft/)
  assert.match(storeOps, /Never claim stock changed|NOT applied to ledger/)
})

test('lowStockRequestPack shapes draft args', async () => {
  const db = {
    from(table) {
      if (table === 'v_low_stock') {
        const api = {
          select() {
            return api
          },
          eq() {
            return api
          },
          order() {
            return api
          },
          limit() {
            return api
          },
          then(r) {
            return Promise.resolve({
              data: [
                {
                  product_id: 'p1',
                  product_title: 'Serum',
                  product_sku: 'S1',
                  total_available: 1,
                  low_stock_threshold: 5,
                },
              ],
              error: null,
            }).then(r)
          },
        }
        return api
      }
      throw new Error(table)
    },
  }
  const pack = await lowStockRequestPack(db, { workspace_id: 'ws', limit: 10 })
  assert.equal(pack.line_count, 1)
  assert.equal(pack.lines[0].sku, 'S1')
  assert.ok(pack.lines[0].requested_qty >= 1)
  assert.ok(pack.store_ops_create_draft_request_args.dry_run)
  assert.ok(pack.agent_hint)
})

test('posEnableProposal filters POS off', async () => {
  const db = {
    from() {
      const api = {
        select() {
          return api
        },
        eq() {
          return api
        },
        order() {
          return api
        },
        limit() {
          return api
        },
        then(r) {
          return Promise.resolve({
            data: [
              {
                id: '1',
                title: 'A',
                sku: 'A1',
                status: 'active',
                retail_price: 10,
                cost_price: 2,
                product_data: { pos_enabled: false },
                brand: { name: 'B' },
              },
              {
                id: '2',
                title: 'On',
                sku: 'A2',
                status: 'active',
                retail_price: 10,
                cost_price: 2,
                product_data: { pos_enabled: true },
                brand: { name: 'B' },
              },
            ],
            error: null,
          }).then(r)
        },
      }
      return api
    },
  }
  const prop = await posEnableProposal(db, { workspace_id: 'ws', limit: 10 })
  assert.equal(prop.candidate_count, 1)
  assert.equal(prop.candidates[0].sku, 'A1')
  assert.match(prop.agent_hint, /Activate|POS/i)
})

test('exceptionsSnapshot aggregates severity', async () => {
  const db = {
    from() {
      const api = {
        select() {
          return api
        },
        eq() {
          return api
        },
        in() {
          return api
        },
        order() {
          return api
        },
        limit() {
          return api
        },
        then(r) {
          return Promise.resolve({
            data: [
              { id: '1', severity: 'high', exception_type: 'short', status: 'open', title: 'T' },
              { id: '2', severity: 'high', exception_type: 'damage', status: 'open', title: 'U' },
            ],
            error: null,
          }).then(r)
        },
      }
      return api
    },
  }
  const snap = await exceptionsSnapshot(db, { workspace_id: 'ws' })
  assert.equal(snap.count, 2)
  assert.equal(snap.by_severity.high, 2)
})

test('TODO and backlog mark #8 shipped', () => {
  assert.match(todo, /#1.?8|Further MCP actions|expiry_snapshot/)
  assert.match(todo, /inbound_create_draft/)
  assert.match(backlog, /Shipped|expiry_snapshot/)
})
