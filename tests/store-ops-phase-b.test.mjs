import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

describe('Store ops Phase B', () => {
  test('migration 056 defines waves, inbox, decisions, Mon/Thu default', () => {
    const sql = readFileSync(new URL('../core/db/056_store_ops_waves_inbox.sql', import.meta.url), 'utf8')
    assert.match(sql, /store_replenishment_waves/)
    assert.match(sql, /store_ops_notifications/)
    assert.match(sql, /deferred_to_wave/)
    assert.match(sql, /delivery_mode/)
    assert.match(sql, /wave_weekdays/)
    assert.match(sql, /'\{1,4\}'/)
    assert.match(sql, /next_replenishment_wave_dates/)
  })

  test('orchestrator and API routes exist with correct scope names', () => {
    const orch = readFileSync(new URL('../server/utils/storeReplenishment.ts', import.meta.url), 'utf8')
    assert.match(orch, /notifyReplenishmentRequestSubmitted/)
    assert.match(orch, /decideReplenishmentRequest/)
    assert.match(orch, /approve_now/)
    assert.match(orch, /defer_to_wave/)
    assert.match(orch, /sendOrderToLoft/)
    assert.match(orch, /recommendReplenishmentDecision/)
    assert.match(orch, /never|Never|do not auto/i)

    const decide = readFileSync(
      new URL('../server/api/store-ops/requests/[id]/decide.post.ts', import.meta.url),
      'utf8',
    )
    assert.match(decide, /store_ops:approve/)
    assert.doesNotMatch(decide, /createWorldsyntech/)

    const send = readFileSync(
      new URL('../server/api/store-ops/orders/[id]/send-to-loft.post.ts', import.meta.url),
      'utf8',
    )
    assert.match(send, /store_ops:execute_3pl/)

    const req = readFileSync(
      new URL('../server/routes/fran/store-ops/requests.post.ts', import.meta.url),
      'utf8',
    )
    assert.match(req, /notifyReplenishmentRequestSubmitted/)
    assert.match(req, /queued_for_review/)
  })

  test('MCP store ops tools are read-only and on safe profile', () => {
    const ctx = readFileSync(new URL('../mcp/src/context.mjs', import.meta.url), 'utf8')
    assert.match(ctx, /store_ops:read/)
    assert.match(ctx, /store_ops:approve/)

    const tools = readFileSync(new URL('../mcp/src/tools.mjs', import.meta.url), 'utf8')
    assert.match(tools, /store_ops_list_requests/)
    assert.match(tools, /store_ops_list_waves/)
    assert.match(tools, /store_ops_recommend/)
    assert.match(tools, /requireScope\('store_ops:read'\)/)

    const lib = readFileSync(new URL('../mcp/src/lib/storeOps.mjs', import.meta.url), 'utf8')
    assert.match(lib, /advisory_only/)
    assert.match(lib, /cannot approve/)
  })

  test('poll-orders route maps remote status', () => {
    const poll = readFileSync(
      new URL('../server/api/integrations/worldsyntech-ofs/poll-orders.post.ts', import.meta.url),
      'utf8',
    )
    assert.match(poll, /order\/get_list/)
    assert.match(poll, /mapRemoteOrderStatus/)
  })
})
