import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../core/db/026_listings.sql', import.meta.url), 'utf8')
const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')

test('listings migration is registered', () => {
  assert.match(migrationsDoc, /\|\s*026\s*\|\s*listings\.sql\s*\|/)
})

test('channels are modeled separately from integrations', () => {
  assert.match(migration, /create table if not exists public\.channels/i)
  assert.match(migration, /channel_key\s+text not null/i)
  assert.match(migration, /adapter_id\s+text/i)
  assert.match(migration, /Anyone can view global channels/)
})

test('listings are first-class projections of identity and trade unit', () => {
  assert.match(migration, /create table if not exists public\.listings/i)
  assert.match(migration, /product_identity_id\s+uuid not null references public\.product_identities\(id\)/i)
  assert.match(migration, /trade_unit_id\s+uuid references public\.trade_units\(id\)/i)
  assert.match(migration, /seller_sku\s+text/i)
  assert.match(migration, /external_listing_id\s+text/i)
})

test('listing identifiers and sync states are separate from product identity', () => {
  assert.match(migration, /create table if not exists public\.listing_identifiers/i)
  assert.match(migration, /create table if not exists public\.listing_sync_states/i)
  assert.match(migration, /sync_status\s+text not null default 'pending'/i)
})

test('global commerce channels are seeded', () => {
  for (const channel of ['shopify', 'amazon', 'tiktok_shop', 'shopee', 'lazada', 'custom_api']) {
    assert.match(migration, new RegExp(`'${channel}'`, 'i'))
  }
})
