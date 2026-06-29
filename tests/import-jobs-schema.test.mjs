import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../core/db/028_import_jobs.sql', import.meta.url), 'utf8')
const reviewMigration = readFileSync(new URL('../core/db/039_import_review_pipeline.sql', import.meta.url), 'utf8')
const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')

test('import jobs migration is registered', () => {
  assert.match(migrationsDoc, /\|\s*028\s*\|\s*import_jobs\.sql\s*\|/)
})

test('import jobs stage files before graph commit', () => {
  assert.match(migration, /create table if not exists public\.import_jobs/i)
  assert.match(migration, /source_type\s+text not null default 'csv'/i)
  assert.match(migration, /column_mapping\s+jsonb not null default '\{\}'/i)
  assert.match(migration, /status\s+text not null default 'draft'/i)
})

test('import rows contain normalized product graph write plan', () => {
  assert.match(migration, /create table if not exists public\.import_job_rows/i)
  assert.match(migration, /normalized_product\s+jsonb not null default '\{\}'/i)
  assert.match(migration, /normalized_identity\s+jsonb not null default '\{\}'/i)
  assert.match(migration, /normalized_trade_units\s+jsonb not null default '\[\]'/i)
  assert.match(migration, /normalized_identifiers\s+jsonb not null default '\[\]'/i)
  assert.match(migration, /normalized_sku_assignments\s+jsonb not null default '\[\]'/i)
  assert.match(migration, /normalized_listings\s+jsonb not null default '\[\]'/i)
})

test('import summary view uses security invoker', () => {
  assert.match(migration, /create or replace view public\.v_import_job_summary/i)
  assert.match(migration, /with \(security_invoker = true\)/i)
})

test('import review pipeline supports changing XLSX formats before approval', () => {
  assert.match(migrationsDoc, /\|\s*039\s*\|\s*import_review_pipeline\.sql\s*\|/)
  assert.match(reviewMigration, /mapping_source text not null default 'manual'/i)
  assert.match(reviewMigration, /inferred_column_mapping jsonb not null default '\{\}'/i)
  assert.match(reviewMigration, /normalization_model text/i)
  assert.match(reviewMigration, /review_status text not null default 'pending'/i)
  assert.match(reviewMigration, /normalization_confidence numeric\(5,4\)/i)
  assert.match(reviewMigration, /approval_status text not null default 'pending'/i)
})
