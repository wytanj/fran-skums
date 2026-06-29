import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const getRoute = readFileSync(new URL('../server/api/v1/products/[id]/sku-assignments.get.ts', import.meta.url), 'utf8')
const postRoute = readFileSync(new URL('../server/api/v1/trade-units/[id]/sku-assignments.post.ts', import.meta.url), 'utf8')
const indexRoute = readFileSync(new URL('../server/api/v1/index.get.ts', import.meta.url), 'utf8')

test('SKU assignment API endpoints are advertised', () => {
  assert.match(indexRoute, /skuAssignments:\s*'GET \/api\/v1\/products\/:id\/sku-assignments'/)
  assert.match(indexRoute, /tradeUnits:\s*\{\s*assignSku:\s*'POST \/api\/v1\/trade-units\/:id\/sku-assignments'/)
})

test('product SKU assignment read endpoint uses identity graph and workspace scope', () => {
  assert.match(getRoute, /requireApiKey\(event,\s*'products:read'\)/)
  assert.match(getRoute, /\.from\('v_product_identity_graph'\)/)
  assert.match(getRoute, /\.eq\('product_id',\s*id!\)/)
  assert.match(getRoute, /\.eq\('workspace_id',\s*ctx\.workspaceId\)/)
  assert.doesNotMatch(getRoute, /\.insert\(/)
  assert.doesNotMatch(getRoute, /\.update\(/)
})

test('trade unit SKU assignment write endpoint enforces workspace scope', () => {
  assert.match(postRoute, /requireApiKey\(event,\s*'products:write'\)/)
  assert.match(postRoute, /sku is required/)
  assert.match(postRoute, /\.from\('trade_units'\)/)
  assert.match(postRoute, /\.eq\('workspace_id',\s*ctx\.workspaceId\)/)
  assert.match(postRoute, /\.from\('sku_assignments'\)/)
  assert.match(postRoute, /setResponseStatus\(event,\s*201\)/)
})

test('trade unit SKU assignment write endpoint clears prior primary in same context', () => {
  assert.match(postRoute, /body\.is_primary === true/)
  assert.match(postRoute, /is_primary:\s*false/)
  assert.match(postRoute, /\.eq\('scope_type',\s*scopeType\)/)
  assert.match(postRoute, /\.is\('scope_id',\s*null\)/)
})
