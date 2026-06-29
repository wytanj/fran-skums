import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../core/db/027_integration_listing_bridge.sql', import.meta.url), 'utf8')
const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')

test('integration listing bridge migration is registered', () => {
  assert.match(migrationsDoc, /\|\s*027\s*\|\s*integration_listing_bridge\.sql\s*\|/)
})

test('existing integration sync mappings gain listing_id bridge column', () => {
  assert.match(migration, /alter table public\.integration_sync_mappings/i)
  assert.match(migration, /add column if not exists listing_id uuid references public\.listings\(id\)/i)
  assert.match(migration, /idx_sync_mappings_listing/i)
})

test('bridge creates listing from integration connection, node, product identity, and trade unit', () => {
  assert.match(migration, /ensure_listing_for_integration_sync_mapping/i)
  assert.match(migration, /public\.integration_connections/)
  assert.match(migration, /public\.integration_node_definitions/)
  assert.match(migration, /public\.ensure_product_identity_spine\(v_mapping\.product_id\)/)
  assert.match(migration, /insert into public\.listings/i)
})

test('bridge writes listing sync state from legacy mapping state', () => {
  assert.match(migration, /insert into public\.listing_sync_states/i)
  assert.match(migration, /v_mapping\.sync_status/)
  assert.match(migration, /v_mapping\.local_hash/)
  assert.match(migration, /v_mapping\.remote_hash/)
})

test('future sync mapping inserts are bridged by trigger', () => {
  assert.match(migration, /create trigger on_sync_mapping_created_listing_bridge/i)
  assert.match(migration, /after insert on public\.integration_sync_mappings/i)
  assert.match(migration, /handle_integration_sync_mapping_listing_bridge/)
})

test('internal listing bridge functions are not public RPC surface', () => {
  assert.match(migration, /revoke execute on function public\.ensure_listing_for_integration_sync_mapping\(uuid\) from public, anon, authenticated/i)
  assert.match(migration, /revoke execute on function public\.backfill_integration_listing_bridge\(\) from public, anon, authenticated/i)
})
