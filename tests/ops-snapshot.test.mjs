/**
 * Ops snapshot + capabilities (MCP composite #3)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { mcpCapabilities, opsSnapshot } from '../core/ops/index.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tools = readFileSync(join(root, 'mcp/src/tools.mjs'), 'utf8')
const assistantTools = readFileSync(join(root, 'server/utils/assistantTools.ts'), 'utf8')
const assistantPrompt = readFileSync(join(root, 'server/utils/assistantPrompt.ts'), 'utf8')
const todo = readFileSync(join(root, 'TODO.md'), 'utf8')

function headChain(count) {
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
    then(r) {
      return Promise.resolve({ count, error: null }).then(r)
    },
  }
  return api
}

function listChain(rows) {
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
      return Promise.resolve({ data: rows, error: null }).then(r)
    },
  }
  return api
}

test('MCP and assistant register ops_snapshot + capabilities', () => {
  assert.match(tools, /name: 'ops_snapshot'/)
  assert.match(tools, /name: 'capabilities'/)
  assert.match(tools, /case 'ops_snapshot'/)
  assert.match(tools, /case 'capabilities'/)
  assert.match(assistantTools, /get_ops_snapshot/)
  assert.match(assistantTools, /get_capabilities/)
  assert.match(assistantPrompt, /get_ops_snapshot/)
  assert.match(todo, /ops_snapshot \+ capabilities/)
})

test('mcpCapabilities states no invoices and blocks approve/execute', () => {
  const cap = mcpCapabilities({ cloud: true, profile: 'safe', mode: 'safe', surface: 'mcp' })
  assert.equal(cap.cannot.create_or_send_invoices, true)
  assert.equal(cap.cannot.approve_store_replenishment, true)
  assert.equal(cap.cannot.execute_3pl_send_to_loft, true)
  assert.ok(cap.domain_objects.does_not_exist.some((x) => /invoice/i.test(x)))
  assert.ok(cap.preferred_tools.whats_outstanding.includes('ops_snapshot'))
  assert.ok(cap.agent_hint)
  assert.equal(cap.runtime.cloud, true)
})

test('opsSnapshot aggregates counts and attention', async () => {
  let headCalls = 0
  const db = {
    from(table) {
      // head counts vs list samples share tables — use call pattern
      return {
        select(cols, opts) {
          if (opts?.head || (typeof cols === 'string' && cols === 'id' && opts?.count === 'exact')) {
            headCalls += 1
            // simulate open queues only for requests
            const n = table === 'store_replenishment_requests' ? 2 : 0
            return headChain(n)
          }
          if (table === 'store_replenishment_waves') {
            return listChain([
              {
                id: 'w1',
                wave_date: '2026-07-16',
                status: 'open',
                metadata: { source: 'ensure_wave' },
                created_at: '2026-07-01',
              },
            ])
          }
          if (table === 'store_replenishment_requests') {
            return listChain([
              {
                id: 'r1',
                request_number: 'REQ-1',
                status: 'submitted',
                priority: 'normal',
                needed_by: null,
                wave_date: null,
                created_at: '2026-07-14',
              },
            ])
          }
          return listChain([])
        },
      }
    },
    rpc(name) {
      if (name === 'next_replenishment_wave_dates') {
        return Promise.resolve({
          data: [{ wave_date: '2026-07-16' }, { wave_date: '2026-07-20' }],
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: { message: 'unknown rpc' } })
    },
  }

  const snap = await opsSnapshot(db, { workspace_id: 'ws-1' })
  assert.ok(snap.counts)
  assert.equal(snap.counts.store_requests_open_queue, 2)
  assert.ok(snap.attention.some((a) => /store request/i.test(a)))
  assert.equal(snap.waves.upcoming_dates[0].wave_date, '2026-07-16')
  assert.ok(snap.samples?.open_requests?.length >= 1)
  assert.match(snap.domain_notes.invoices, /not_in_skums/)
  assert.ok(snap.agent_hint)
  assert.ok(headCalls >= 1)
})

test('opsSnapshot empty queues still returns domain notes', async () => {
  const db = {
    from() {
      return {
        select(cols, opts) {
          if (opts?.count === 'exact' || opts?.head) return headChain(0)
          return listChain([])
        },
      }
    },
    rpc() {
      return Promise.resolve({ data: [], error: null })
    },
  }
  const snap = await opsSnapshot(db, { workspace_id: 'ws-1', include_samples: false })
  assert.equal(snap.counts.inventory_exceptions_open, 0)
  assert.ok(snap.attention.some((a) => /No open|empty/i.test(a)))
  assert.equal(snap.samples, undefined)
})
