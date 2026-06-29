import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const types = readFileSync(new URL('../app/types/index.ts', import.meta.url), 'utf8')

test('frontend types include identity-spine vocabulary', () => {
  for (const name of [
    'ProductIdentity',
    'TradeUnit',
    'IdentityIdentifier',
    'SkuAssignment',
    'ProductIdentityGraph',
  ]) {
    assert.match(types, new RegExp(`export interface ${name}`))
  }
})

test('frontend types model SKU as scoped assignment', () => {
  assert.match(types, /export type SkuScopeType =/)
  assert.match(types, /'warehouse'/)
  assert.match(types, /'channel'/)
  assert.match(types, /'listing'/)
  assert.match(types, /export interface SkuAssignment/)
  assert.match(types, /scope_type: SkuScopeType/)
})

test('frontend types include first-class channels and listings', () => {
  assert.match(types, /export interface Channel/)
  assert.match(types, /export interface Listing/)
  assert.match(types, /seller_sku: string \| null/)
  assert.match(types, /product_identity_id: string/)
  assert.match(types, /trade_unit_id: string \| null/)
})

test('frontend types include server-side import staging vocabulary', () => {
  assert.match(types, /export type ImportSourceType =/)
  assert.match(types, /export type ImportJobStatus =/)
  assert.match(types, /export interface ImportJob/)
  assert.match(types, /export interface ImportJobRow/)
  assert.match(types, /normalized_sku_assignments: Record<string, any>\[\]/)
  assert.match(types, /normalized_listings: Record<string, any>\[\]/)
})
