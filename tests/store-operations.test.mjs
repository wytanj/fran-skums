import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const handoffDoc = readFileSync(new URL('../docs/POS_SKUMS_3PL_STORE_OPS_HANDOFF.md', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../core/db/044_store_operations.sql', import.meta.url), 'utf8')
const supabaseMigration = readFileSync(new URL('../supabase/migrations/202606240044_store_operations.sql', import.meta.url), 'utf8')
const coreMigrationIndex = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')
const supabaseMigrationIndex = readFileSync(new URL('../supabase/migrations/README.md', import.meta.url), 'utf8')
const types = readFileSync(new URL('../app/types/index.ts', import.meta.url), 'utf8')
const composable = readFileSync(new URL('../app/composables/useStoreOperations.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../app/pages/store-ops/index.vue', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../app/components/AppSidebar.vue', import.meta.url), 'utf8')

test('POS handoff doc gives POS a clear store-operations contract', () => {
  assert.match(handoffDoc, /# POS to SKUMS Store Operations Handoff/)
  assert.match(handoffDoc, /POS captures store reality/)
  assert.match(handoffDoc, /SKUMS decides, approves, reconciles/)
  assert.match(handoffDoc, /Loft Logistics/)
  assert.match(handoffDoc, /GET \/api\/v1\/pos\/catalog/)
  assert.match(handoffDoc, /POST \/api\/v1\/pos\/sales/)
  assert.match(handoffDoc, /POST \/api\/v1\/pos\/inventory-events/)
  assert.match(handoffDoc, /replenishment request/)
  assert.match(handoffDoc, /Store Receiving/)
})

test('store operations migration is registered and mirrored', () => {
  assert.match(coreMigrationIndex, /044\s+\|\s+store_operations\.sql\s+\|/)
  assert.match(supabaseMigrationIndex, /202606240044_store_operations\.sql/)
  assert.equal(migration, supabaseMigration)
})

test('store operations migration creates RLS-protected workflow tables and views', () => {
  for (const sql of [migration, supabaseMigration]) {
    for (const table of [
      'store_replenishment_requests',
      'store_replenishment_request_lines',
      'store_replenishment_orders',
      'store_replenishment_order_lines',
      'receiving_sessions',
      'receiving_session_lines',
      'inventory_exceptions',
    ]) {
      assert.match(sql, new RegExp(`create table if not exists public\\.${table}`))
      assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`))
      assert.match(sql, new RegExp(`grant select, insert, update, delete on table public\\.${table}`))
      assert.match(sql, /to authenticated, service_role/)
      assert.match(sql, /get_my_writable_workspace_ids/)
    }

    assert.match(sql, /create view public\.v_store_replenishment_requests\s+with \(security_invoker = true\)/)
    assert.match(sql, /create view public\.v_store_replenishment_orders\s+with \(security_invoker = true\)/)
    assert.match(sql, /grant select on public\.v_store_replenishment_requests/)
    assert.match(sql, /grant select on public\.v_store_replenishment_orders/)
  }
})

test('shared types expose store operations contracts', () => {
  for (const name of [
    'StoreReplenishmentRequest',
    'StoreReplenishmentRequestLine',
    'StoreReplenishmentOrder',
    'StoreReplenishmentOrderLine',
    'ReceivingSession',
    'ReceivingSessionLine',
    'InventoryException',
  ]) {
    assert.match(types, new RegExp(`export interface ${name}`))
  }
  assert.match(types, /export type StoreReplenishmentRequestStatus/)
  assert.match(types, /export type StoreReplenishmentOrderStatus/)
  assert.match(types, /export type ReceivingSessionStatus/)
  assert.match(types, /export type InventoryExceptionStatus/)
})

test('store operations composable loads queues and writes manager actions', () => {
  assert.match(composable, /\.from\('v_store_replenishment_requests'\)/)
  assert.match(composable, /\.from\('v_store_replenishment_orders'\)/)
  assert.match(composable, /createReplenishmentRequest/)
  assert.match(composable, /updateReplenishmentRequestStatus/)
  assert.match(composable, /createReplenishmentOrder/)
  assert.match(composable, /updateReplenishmentOrderStatus/)
  assert.match(composable, /createReceivingSession/)
  assert.match(composable, /createInventoryException/)
  assert.match(composable, /exceptionStatusBadge/)
})

test('Store Ops page exposes manager UI for queue, orders, receiving, and exceptions', () => {
  assert.match(page, /<h1 class="text-2xl font-bold text-white">Store Ops<\/h1>/)
  assert.match(page, /activeTab === 'queue'/)
  assert.match(page, /activeTab === 'orders'/)
  assert.match(page, /activeTab === 'receiving'/)
  assert.match(page, /activeTab === 'exceptions'/)
  assert.match(page, /convertRequestToOrder/)
  assert.match(page, /handleCreateReceivingSession/)
  assert.match(page, /handleCreateException/)
  assert.match(page, /setOrderStatus\(order, 'sent_to_3pl'\)/)
  assert.match(sidebar, /href: '\/store-ops'/)
})
