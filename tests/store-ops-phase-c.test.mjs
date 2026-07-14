import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

describe('Store ops Phase C + B.4', () => {
  test('near-expiry gate exists on send path', () => {
    const orch = readFileSync(new URL('../server/utils/storeReplenishment.ts', import.meta.url), 'utf8')
    assert.match(orch, /checkNearExpiryGate/)
    assert.match(orch, /overrideExpiry/)
    assert.match(orch, /minRemainingMonths/)

    const send = readFileSync(
      new URL('../server/api/store-ops/orders/[id]/send-to-loft.post.ts', import.meta.url),
      'utf8',
    )
    assert.match(send, /inventory:override_expiry/)
    assert.match(send, /override_expiry/)
  })

  test('receive + expected deliveries + exception verify routes', () => {
    const recv = readFileSync(new URL('../server/utils/storeReceive.ts', import.meta.url), 'utf8')
    assert.match(recv, /listExpectedDeliveries/)
    assert.match(recv, /submitStoreReceive/)
    assert.match(recv, /verifyInventoryException/)
    assert.match(recv, /listReadyForCollect/)
    assert.match(recv, /upsert_inventory_level/)
    assert.match(recv, /pending_verification/)
    assert.match(recv, /collector_name/)

    const expected = readFileSync(
      new URL('../server/api/store-ops/expected-deliveries.get.ts', import.meta.url),
      'utf8',
    )
    assert.match(expected, /pos_location_code/)

    const receiveRoute = readFileSync(
      new URL('../server/api/store-ops/receive.post.ts', import.meta.url),
      'utf8',
    )
    assert.match(receiveRoute, /idempotency_key/)
    assert.match(receiveRoute, /submitStoreReceive/)

    const franReceive = readFileSync(
      new URL('../server/routes/fran/store-ops/receive.post.ts', import.meta.url),
      'utf8',
    )
    assert.match(franReceive, /submitStoreReceive/)

    const ready = readFileSync(
      new URL('../server/api/store-ops/ready-for-collect.get.ts', import.meta.url),
      'utf8',
    )
    assert.match(ready, /listReadyForCollect|Self-collect/)

    const verify = readFileSync(
      new URL('../server/api/store-ops/exceptions/[id]/verify.post.ts', import.meta.url),
      'utf8',
    )
    assert.match(verify, /store_ops:verify/)
    assert.match(verify, /confirm/)
  })
})
