import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

describe('Inbound Phase D', () => {
  test('migration 057 defines ASN lifecycle', () => {
    const sql = readFileSync(new URL('../core/db/057_inbound_shipments.sql', import.meta.url), 'utf8')
    assert.match(sql, /inbound_shipments/)
    assert.match(sql, /inbound_shipment_lines/)
    assert.match(sql, /lise_confirmed/)
    assert.match(sql, /full_pallet/)
    assert.match(sql, /M&P|local_forwarder/)
  })

  test('inbound service and routes', () => {
    const svc = readFileSync(new URL('../server/utils/inboundShipment.ts', import.meta.url), 'utf8')
    assert.match(svc, /createInboundShipment/)
    assert.match(svc, /sendInboundToLoft/)
    assert.match(svc, /pollInboundFromLoft/)
    assert.match(svc, /confirmInboundAndPromote/)
    assert.match(svc, /LOFT-SG/)
    assert.match(svc, /ship_to_warehouse/)

    const create = readFileSync(new URL('../server/api/store-ops/inbound.post.ts', import.meta.url), 'utf8')
    assert.match(create, /store_ops:inbound/)

    const send = readFileSync(
      new URL('../server/api/store-ops/inbound/[id]/send-to-loft.post.ts', import.meta.url),
      'utf8',
    )
    assert.match(send, /sendInboundToLoft/)

    const confirm = readFileSync(
      new URL('../server/api/store-ops/inbound/[id]/confirm.post.ts', import.meta.url),
      'utf8',
    )
    assert.match(confirm, /confirmInboundAndPromote/)
    assert.match(confirm, /inventory:write/)

    const poll = readFileSync(
      new URL('../server/api/integrations/worldsyntech-ofs/poll-inbound.post.ts', import.meta.url),
      'utf8',
    )
    assert.match(poll, /poll_inbound/)
  })
})
