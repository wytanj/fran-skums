import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../core/db/037_app_platform.sql', import.meta.url), 'utf8')
const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')
const types = readFileSync(new URL('../app/types/index.ts', import.meta.url), 'utf8')

test('app platform migration is registered as agentic commerce core infrastructure', () => {
  assert.match(migrationsDoc, /\|\s*037\s*\|\s*app_platform\.sql\s*\|/)
  assert.match(migrationsDoc, /Agentic commerce core for POS, intelligence apps, connectors, and custom apps/)
  assert.match(migrationsDoc, /without making billing or packaging assumptions/)
})

test('app platform defines neutral app and workspace enablement primitives', () => {
  for (const table of ['app_definitions', 'workspace_apps', 'workspace_capability_sources']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'))
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
  }

  assert.match(migration, /app_type in \('core', 'first_party', 'connector', 'agent', 'external', 'custom'\)/)
  assert.match(migration, /status in \('configuring', 'enabled', 'disabled', 'suspended', 'error'\)/)
  assert.match(migration, /unique \(workspace_id, app_key\)/)
})

test('capability sources express operational ownership without payment assumptions', () => {
  assert.match(migration, /capability_key\s+text not null/)
  assert.match(migration, /owner_type in \('skums_core', 'workspace_app', 'integration_connection', 'external_system', 'manual'\)/)
  assert.match(migration, /mode in \('source_of_truth', 'read_only', 'write_through', 'event_sink', 'disabled'\)/)
  assert.match(migration, /conflict_policy in \('prefer_source', 'prefer_latest', 'manual_review', 'block'\)/)
  assert.doesNotMatch(migration, /\b(subscription_id|billing_account_id|invoice_id|plan_id)\b/i)
})

test('domain events are append-only and idempotent', () => {
  assert.match(migration, /create table if not exists public\.domain_events/i)
  assert.match(migration, /event_type\s+text not null/)
  assert.match(migration, /payload\s+jsonb not null default '\{\}'/)
  assert.match(migration, /idx_domain_events_idempotency/)
  assert.match(migration, /No UPDATE or DELETE policies\. domain_events is append-only\./)
  assert.doesNotMatch(migration, /domain_events for update/i)
  assert.doesNotMatch(migration, /domain_events for delete/i)
})

test('agent proposals use proposal approval execution primitives', () => {
  for (const table of ['agent_proposals', 'approval_requests', 'agent_execution_logs']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'))
  }

  assert.match(migration, /intent_summary\s+text not null/)
  assert.match(migration, /proposed_steps\s+jsonb not null default '\[\]'/)
  assert.match(migration, /policy_result\s+jsonb not null default '\{\}'/)
  assert.match(migration, /approval_required boolean not null default true/)
  assert.match(migration, /rollback_metadata jsonb not null default '\{\}'/)
})

test('global app seed covers non-POS app surfaces', () => {
  for (const appKey of ['skums_core', 'pos', 'skincare_intelligence', 'shopify', 'supplier_imports']) {
    assert.match(migration, new RegExp(`'${appKey}'`))
  }

  assert.match(migration, /market_intelligence/)
  assert.match(migration, /supplier_catalog_normalization/)
  assert.match(migration, /storefront_listings/)
})

test('frontend types expose app platform contracts', () => {
  for (const name of [
    'AppDefinition',
    'WorkspaceApp',
    'WorkspaceCapabilitySource',
    'DomainEvent',
    'AgentProposal',
    'ApprovalRequest',
    'AgentExecutionLog',
  ]) {
    assert.match(types, new RegExp(`export interface ${name}`))
  }
})
