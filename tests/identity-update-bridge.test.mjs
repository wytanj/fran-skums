import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../core/db/024_identity_spine_update_bridge.sql', import.meta.url), 'utf8')
const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')

test('identity update bridge migration is registered', () => {
  assert.match(migrationsDoc, /\|\s*024\s*\|\s*identity_spine_update_bridge\.sql\s*\|/)
})

test('product updates sync identity display fields', () => {
  assert.match(migration, /create or replace function public\.sync_product_identity_spine_from_product_update\(\)/i)
  assert.match(migration, /perform public\.ensure_product_identity_spine\(new\.id\)/i)
  assert.match(migration, /update public\.product_identities/i)
  assert.match(migration, /name = new\.title/i)
  assert.match(migration, /status = new\.status::text/i)
})

test('legacy product SKU remains a workspace-scoped bridge-owned assignment', () => {
  assert.match(migration, /metadata->>'source' = 'legacy_product_sku'/i)
  assert.match(migration, /scope_type = 'workspace'/i)
  assert.match(migration, /scope_id is null/i)
  assert.match(migration, /set is_active = false/i)
  assert.match(migration, /trim\(new\.sku\)/i)
})

test('product update trigger watches only legacy fields that map into identity spine', () => {
  assert.match(migration, /create trigger on_product_updated_identity_spine/i)
  assert.match(migration, /after update of\s+title,\s+description,\s+status,\s+sku,\s+gtin,\s+upc,\s+ean,\s+isbn,\s+asin,\s+mpn/is)
  assert.match(migration, /for each row execute function public\.sync_product_identity_spine_from_product_update\(\)/i)
})

test('internal update bridge function is not public RPC surface', () => {
  assert.match(migration, /revoke execute on function public\.sync_product_identity_spine_from_product_update\(\) from public, anon, authenticated/i)
})
