import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { FIXED_IMPORT_FIELDS, proposeColumnMapping } from '../core/import/map.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('catalog import never maps a stock column onto products', () => {
  const headers = ['Title', 'Qty', 'Stock', 'Stock Quantity', 'Inventory', 'Quantity']
  const { mapping } = proposeColumnMapping(headers)
  assert.equal(mapping.Title, 'title')
  for (const header of headers) {
    assert.notEqual(mapping[header], 'stock_quantity', header)
  }
  assert.ok(!FIXED_IMPORT_FIELDS.some(f => f.key === 'stock_quantity'))
  assert.doesNotMatch(read('app/pages/import-export.vue'), /key: 'stock_quantity'/)
})

test('v1 product writes do not accept stock_quantity', () => {
  for (const path of ['server/api/v1/products.post.ts', 'server/api/v1/products/[id].put.ts']) {
    assert.doesNotMatch(read(path), /'stock_quantity'/, path)
  }
  assert.ok(!existsSync(new URL('../server/api/v1/products/bulk.post.ts', import.meta.url)))
})

test('product editor has no hand-typed stock quantity', () => {
  assert.doesNotMatch(read('app/pages/products/[id].vue'), /v-model[^=]*="form\.stock_quantity"/)
})

test('expiry lots are read-only outside inbound confirm', () => {
  const composable = read('app/composables/useExpiry.ts')
  const expiryWrite = /from\('expiry_(batches|items)'\)\s*\.(insert|update|delete|upsert)\(/
  assert.doesNotMatch(composable, expiryWrite)
  assert.doesNotMatch(read('app/pages/expiry/index.vue'), /createBatch|deleteBatch/)
  assert.doesNotMatch(read('app/pages/expiry/[id].vue'), /createItem|updateItemStatus|deleteItem/)
  assert.ok(!existsSync(new URL('../server/api/v1/expiry/batches.post.ts', import.meta.url)))
  assert.match(read('server/utils/inboundShipment.ts'), /expiry_batches/)
})

test('catalogue screens do not present products.stock_quantity as on-hand', () => {
  assert.doesNotMatch(read('app/pages/products/index.vue'), /stock_quantity/)
  assert.doesNotMatch(read('app/pages/index.vue'), /stock_quantity/)
  assert.doesNotMatch(read('server/api/v1/pos/catalog.get.ts'), /product\.stock_quantity/)
  assert.doesNotMatch(read('server/api/integrations/woocommerce/pull-products.post.ts'), /stock_quantity/)
})

test('Hanshow ESL stays', () => {
  assert.ok(existsSync(new URL('../esl/hanshow-allstar/client.ts', import.meta.url)))
  assert.match(read('app/pages/integrations.vue'), /hanshow-allstar/)
})
