/**
 * Phase E — floor adjustments + inventory movement logging
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const migration = read('core/db/058_inventory_adjustment_apply.sql')
const applyUtil = read('server/utils/inventoryAdjustments.ts')
const applyRoute = read('server/api/store-ops/adjustments/[id]/apply.post.ts')
const rejectRoute = read('server/api/store-ops/adjustments/[id]/reject.post.ts')
const listRoute = read('server/api/store-ops/adjustments.get.ts')
const inventoryEvents = read('server/api/v1/pos/inventory-events.post.ts')
const storeReceive = read('server/utils/storeReceive.ts')
const planDoc = read('docs/INVENTORY_AND_PURCHASE_LOGGING.md')
const storeOpsUi = read('app/pages/store-ops/index.vue')

test('058 migration defines apply and reject RPCs with ledger via upsert', () => {
  assert.match(migration, /create or replace function public\.apply_inventory_adjustment/)
  assert.match(migration, /create or replace function public\.reject_inventory_adjustment/)
  assert.match(migration, /upsert_inventory_level/)
  assert.match(migration, /when 'damage' then 'damage'/)
  assert.match(migration, /inventory\.cycle_count\.reported/)
  assert.match(migration, /status = 'applied'/)
  assert.match(migration, /status = 'rejected'/)
})

test('apply/reject APIs require inventory:write and write audit', () => {
  assert.match(applyRoute, /inventory:write/)
  assert.match(rejectRoute, /inventory:write/)
  assert.match(applyUtil, /recordAudit/)
  assert.match(applyUtil, /inventory\.adjustment\.applied/)
  assert.match(applyUtil, /inventory\.adjustment\.rejected/)
  assert.match(applyUtil, /apply_inventory_adjustment/)
  assert.match(listRoute, /store_ops:read/)
})

test('POS inventory events support cycle count and audit intake', () => {
  assert.match(inventoryEvents, /inventory\.cycle_count\.reported/)
  assert.match(inventoryEvents, /stocktake/)
  assert.match(inventoryEvents, /ledger_pending/)
  assert.match(inventoryEvents, /recordApiAudit/)
})

test('store receive uses canonical transfer_received movement_type', () => {
  assert.match(storeReceive, /p_movement_type: 'transfer_received'/)
  assert.doesNotMatch(storeReceive, /p_movement_type: 'transfer_in'/)
  assert.doesNotMatch(storeReceive, /p_movement_type: 'transfer_out'/)
})

test('logging plan documents inventory ledger and purchase ownership split', () => {
  assert.match(planDoc, /inventory_ledger/)
  assert.match(planDoc, /Fran CRM/)
  assert.match(planDoc, /Fran SKUMS/)
  assert.match(planDoc, /pos_outbox/)
  assert.match(planDoc, /points/)
})

test('Store Ops UI has floor adjustments tab with apply/reject', () => {
  assert.match(storeOpsUi, /Floor adjustments/)
  assert.match(storeOpsUi, /applyAdjustment/)
  assert.match(storeOpsUi, /rejectAdjustment/)
  assert.match(storeOpsUi, /\/api\/store-ops\/adjustments/)
})
