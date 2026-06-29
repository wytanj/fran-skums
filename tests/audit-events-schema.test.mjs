import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../core/db/029_audit_events.sql', import.meta.url), 'utf8')
const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')

test('audit events migration is registered', () => {
  assert.match(migrationsDoc, /\|\s*029\s*\|\s*audit_events\.sql\s*\|/)
})

test('audit_events is append-only provenance table', () => {
  assert.match(migration, /create table if not exists public\.audit_events/i)
  assert.match(migration, /before_data\s+jsonb/)
  assert.match(migration, /after_data\s+jsonb/)
  assert.match(migration, /No UPDATE or DELETE policies\. audit_events is append-only\./)
  assert.doesNotMatch(migration, /audit_events for update/i)
  assert.doesNotMatch(migration, /audit_events for delete/i)
})

test('generic graph audit trigger records old and new row data', () => {
  assert.match(migration, /create or replace function public\.record_graph_audit_event\(\)/i)
  assert.match(migration, /v_before := to_jsonb\(old\)/i)
  assert.match(migration, /v_after := to_jsonb\(new\)/i)
  assert.match(migration, /source_type,\s+before_data,\s+after_data/is)
  assert.match(migration, /'db_trigger'/)
  assert.match(migration, /if v_workspace_id is null then/i)
})

test('graph audit trigger function is internal only', () => {
  assert.match(migration, /revoke execute on function public\.record_graph_audit_event\(\) from public, anon, authenticated/i)
})

test('audit triggers cover identity, listing, and import graph tables', () => {
  for (const table of [
    'product_identities',
    'trade_units',
    'identity_identifiers',
    'sku_assignments',
    'listings',
    'listing_sync_states',
    'import_jobs',
    'import_job_rows',
  ]) {
    assert.match(migration, new RegExp(`on public\\.${table}`, 'i'))
  }
})
