import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../core/db/022_identity_spine_backfill.sql', import.meta.url), 'utf8')
const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')

test('backfill migration is registered after identity spine', () => {
  assert.match(migrationsDoc, /\|\s*021\s*\|\s*identity_spine\.sql\s*\|/)
  assert.match(migrationsDoc, /\|\s*022\s*\|\s*identity_spine_backfill\.sql\s*\|/)
})

test('backfill exposes one-product and bulk idempotent helpers', () => {
  assert.match(migration, /create or replace function public\.ensure_product_identity_spine\(p_product_id uuid\)/i)
  assert.match(migration, /create or replace function public\.backfill_identity_spine\(p_workspace_id uuid default null\)/i)
  assert.match(migration, /on conflict \(workspace_id, product_id\) do update/i)
  assert.match(migration, /where not exists \(\s*select 1\s*from public\.sku_assignments/is)
})

test('backfill copies legacy SKU into workspace-scoped SKU assignment', () => {
  assert.match(migration, /v_product\.sku is not null/i)
  assert.match(migration, /scope_type,\s*product_identity_id,\s*trade_unit_id,\s*product_id/is)
  assert.match(migration, /'workspace',\s*v_identity\.id,\s*v_trade_unit\.id,\s*v_product\.id/is)
  assert.match(migration, /'legacy_product_sku'/i)
})

test('backfill copies legacy identifiers into first-class identifier records', () => {
  for (const field of ['gtin', 'upc', 'ean', 'isbn', 'asin', 'mpn']) {
    assert.match(migration, new RegExp(`\\('${field}',\\s*v_product\\.${field}\\)`, 'i'))
  }
  assert.match(migration, /insert into public\.identity_identifiers/i)
  assert.match(migration, /'legacy_product_column'/i)
})

test('future product inserts are bridged into identity spine', () => {
  assert.match(migration, /create or replace function public\.handle_product_identity_spine_insert\(\)/i)
  assert.match(migration, /create trigger on_product_created_identity_spine/i)
  assert.match(migration, /after insert on public\.products/i)
  assert.match(migration, /perform public\.ensure_product_identity_spine\(new\.id\)/i)
})

test('internal identity backfill functions are not public RPC surface', () => {
  assert.match(migration, /revoke execute on function public\.ensure_product_identity_spine\(uuid\) from public, anon, authenticated/i)
  assert.match(migration, /revoke execute on function public\.backfill_identity_spine\(uuid\) from public, anon, authenticated/i)
})
