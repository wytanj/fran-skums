import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../core/db/025_sku_assignment_helpers.sql', import.meta.url), 'utf8')
const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')

test('SKU assignment helper migration is registered', () => {
  assert.match(migrationsDoc, /\|\s*025\s*\|\s*sku_assignment_helpers\.sql\s*\|/)
})

test('assign_sku_to_trade_unit enforces non-empty SKU and writable workspace access', () => {
  assert.match(migration, /create or replace function public\.assign_sku_to_trade_unit/i)
  assert.match(migration, /SKU cannot be empty/)
  assert.match(migration, /get_my_writable_workspace_ids\(\)/)
  assert.match(migration, /raise exception 'Access denied'/)
})

test('assign_sku_to_trade_unit writes SKU as scoped trade-unit assignment', () => {
  assert.match(migration, /p_scope_type text default 'workspace'/)
  assert.match(migration, /p_scope_id uuid default null/)
  assert.match(migration, /trade_unit_id/)
  assert.match(migration, /product_identity_id/)
  assert.match(migration, /assignment_kind/)
})

test('primary SKU assignment is unique per trade unit and context by update behavior', () => {
  assert.match(migration, /if p_is_primary then/i)
  assert.match(migration, /set is_primary = false/i)
  assert.match(migration, /and scope_type = p_scope_type/i)
})

test('resolve_sku_for_context falls back to workspace SKU', () => {
  assert.match(migration, /create or replace function public\.resolve_sku_for_context/i)
  assert.match(migration, /Fallback to the default workspace SKU/)
  assert.match(migration, /scope_type = 'workspace'/)
  assert.match(migration, /scope_id is null/)
})

test('list_sku_assignments_for_product is product-scoped and read-authorized', () => {
  assert.match(migration, /create or replace function public\.list_sku_assignments_for_product/)
  assert.match(migration, /returns setof public\.sku_assignments/)
  assert.match(migration, /get_my_workspace_ids\(\)/)
})
