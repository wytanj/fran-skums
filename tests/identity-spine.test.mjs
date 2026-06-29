import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../core/db/021_identity_spine.sql', import.meta.url), 'utf8')

test('identity spine creates neutral identity and trade-unit tables', () => {
  for (const table of [
    'product_identities',
    'trade_units',
    'identity_identifiers',
    'sku_assignments',
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'))
  }
})

test('SKU assignments are scoped labels, not canonical product identity', () => {
  assert.match(migration, /scope_type\s+text\s+not null default 'workspace'/i)
  assert.match(migration, /'warehouse'/i)
  assert.match(migration, /'channel'/i)
  assert.match(migration, /'supplier'/i)
  assert.match(migration, /idx_sku_assignments_unique_in_scope/i)
  assert.doesNotMatch(migration, /unique\s*\(\s*workspace_id\s*,\s*sku\s*\)/i)
})

test('trade units support loose items, packs, cases, bundles, and bulk units', () => {
  assert.match(migration, /unit_kind\s+text\s+not null default 'each'/i)
  for (const kind of ['each', 'pack', 'case', 'pallet', 'bundle', 'bulk', 'sample']) {
    assert.match(migration, new RegExp(`'${kind}'`, 'i'))
  }
  assert.match(migration, /quantity\s+numeric\(18,6\)\s+not null default 1/i)
  assert.match(migration, /base_unit\s+text\s+not null default 'each'/i)
})

test('identifiers are first-class and can attach to identities or trade units', () => {
  assert.match(migration, /identifier_type\s+text\s+not null/i)
  for (const identifierType of ['gtin', 'upc', 'ean', 'asin', 'supplier_item', 'shopify_variant']) {
    assert.match(migration, new RegExp(`'${identifierType}'`, 'i'))
  }
  assert.match(migration, /product_identity_id is not null or trade_unit_id is not null/i)
})
