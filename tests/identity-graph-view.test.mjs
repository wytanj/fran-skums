import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../core/db/023_identity_graph_views.sql', import.meta.url), 'utf8')
const route = readFileSync(new URL('../server/api/v1/products/[id]/identity.get.ts', import.meta.url), 'utf8')
const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')

test('identity graph view migration is registered', () => {
  assert.match(migrationsDoc, /\|\s*023\s*\|\s*identity_graph_views\.sql\s*\|/)
})

test('identity graph view projects trade units, identifiers, and SKU assignments', () => {
  assert.match(migration, /create or replace view public\.v_product_identity_graph/i)
  assert.match(migration, /with \(security_invoker = true\)/i)
  assert.match(migration, /trade_units/i)
  assert.match(migration, /identifiers/i)
  assert.match(migration, /sku_assignments/i)
  assert.match(migration, /join public\.product_identities pi/i)
})

test('identity graph API is read-only and workspace-scoped', () => {
  assert.match(route, /requireApiKey\(event,\s*'products:read'\)/)
  assert.match(route, /\.from\('v_product_identity_graph'\)/)
  assert.match(route, /\.eq\('product_id',\s*id!\)/)
  assert.match(route, /\.eq\('workspace_id',\s*ctx\.workspaceId\)/)
  assert.doesNotMatch(route, /\.insert\(/)
  assert.doesNotMatch(route, /\.update\(/)
  assert.doesNotMatch(route, /\.delete\(/)
})
