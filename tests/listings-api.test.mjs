import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const listRoute = readFileSync(new URL('../server/api/v1/listings.get.ts', import.meta.url), 'utf8')
const productRoute = readFileSync(new URL('../server/api/v1/products/[id]/listings.get.ts', import.meta.url), 'utf8')
const indexRoute = readFileSync(new URL('../server/api/v1/index.get.ts', import.meta.url), 'utf8')

test('listings API is advertised', () => {
  assert.match(indexRoute, /listings:\s*\{\s*list:\s*'GET \/api\/v1\/listings'/)
  assert.match(indexRoute, /listings:\s*'GET \/api\/v1\/products\/:id\/listings'/)
})

test('global listings API is read-only and workspace-scoped', () => {
  assert.match(listRoute, /requireApiKey\(event,\s*'products:read'\)/)
  assert.match(listRoute, /\.from\('listings'\)/)
  assert.match(listRoute, /\.eq\('workspace_id',\s*ctx\.workspaceId\)/)
  assert.doesNotMatch(listRoute, /\.insert\(/)
  assert.doesNotMatch(listRoute, /\.update\(/)
  assert.doesNotMatch(listRoute, /\.delete\(/)
})

test('product listings API is product and workspace scoped', () => {
  assert.match(productRoute, /getRouterParam\(event,\s*'id'\)/)
  assert.match(productRoute, /\.eq\('workspace_id',\s*ctx\.workspaceId\)/)
  assert.match(productRoute, /\.eq\('product_id',\s*id!\)/)
  assert.doesNotMatch(productRoute, /\.insert\(/)
  assert.doesNotMatch(productRoute, /\.update\(/)
  assert.doesNotMatch(productRoute, /\.delete\(/)
})
