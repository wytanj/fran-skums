import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../core/db/036_pos_core.sql', import.meta.url), 'utf8')
const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')

test('POS core migration is registered without taking planned Phase C slots', () => {
  assert.match(migrationsDoc, /\|\s*036\s*\|\s*pos_core\.sql\s*\|/)
  assert.match(migrationsDoc, /avoid occupying the planned Phase C spine slots/)
})

test('POS core models registers, sessions, sales, items, and payments', () => {
  for (const table of [
    'pos_locations',
    'pos_registers',
    'pos_register_sessions',
    'pos_sales',
    'pos_sale_items',
    'pos_sale_payments',
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'))
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
  }
})

test('POS sale items reference the product graph instead of flattening SKU as identity', () => {
  assert.match(migration, /product_identity_id\s+uuid references public\.product_identities/i)
  assert.match(migration, /trade_unit_id\s+uuid references public\.trade_units/i)
  assert.match(migration, /listing_id\s+uuid references public\.listings/i)
  assert.match(migration, /sku_assignment_id\s+uuid references public\.sku_assignments/i)
  assert.match(migration, /identifier_id\s+uuid references public\.identity_identifiers/i)
  assert.match(migration, /scanned_value\s+text/)
  assert.doesNotMatch(migration, /sku\s+text\s+not null/i)
})

test('POS scan resolution checks identifiers, scoped SKUs, and listings', () => {
  assert.match(migration, /create or replace function public\.resolve_pos_scan/i)
  assert.match(migration, /from public\.identity_identifiers/i)
  assert.match(migration, /from public\.sku_assignments/i)
  assert.match(migration, /from public\.listing_identifiers/i)
  assert.match(migration, /from public\.listings/i)
  assert.match(migration, /'ambiguous_identifier'/)
})

test('POS graph tables are audited', () => {
  for (const table of ['pos_locations', 'pos_registers', 'pos_register_sessions', 'pos_sales', 'pos_sale_items', 'pos_sale_payments']) {
    assert.match(migration, new RegExp(`audit_${table}`, 'i'))
    assert.match(migration, new RegExp(`on public\\.${table}`, 'i'))
  }
})
