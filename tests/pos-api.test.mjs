import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const indexRoute = readFileSync(new URL('../server/api/v1/index.get.ts', import.meta.url), 'utf8')
const catalogRoute = readFileSync(new URL('../server/api/v1/pos/catalog.get.ts', import.meta.url), 'utf8')
const scanRoute = readFileSync(new URL('../server/api/v1/pos/scan.post.ts', import.meta.url), 'utf8')
const salesRoute = readFileSync(new URL('../server/api/v1/pos/sales.post.ts', import.meta.url), 'utf8')
const posSaleIngest = readFileSync(new URL('../server/utils/posSaleIngest.ts', import.meta.url), 'utf8')
const inventoryEventsRoute = readFileSync(new URL('../server/api/v1/pos/inventory-events.post.ts', import.meta.url), 'utf8')
const corsMiddleware = readFileSync(new URL('../server/middleware/api-cors.ts', import.meta.url), 'utf8')
const types = readFileSync(new URL('../app/types/index.ts', import.meta.url), 'utf8')
const openapiRoute = readFileSync(new URL('../server/api/v1/openapi.get.ts', import.meta.url), 'utf8')
const posInventoryEventsMigration = readFileSync(new URL('../core/db/040_pos_inventory_events.sql', import.meta.url), 'utf8')

test('POS API is advertised with explicit scopes', () => {
  assert.match(indexRoute, /pos:\s*\{/)
  assert.match(indexRoute, /catalog:\s*'GET \/api\/v1\/pos\/catalog'/)
  assert.match(indexRoute, /scan:\s*'POST \/api\/v1\/pos\/scan'/)
  assert.match(indexRoute, /createSale:\s*'POST \/api\/v1\/pos\/sales'/)
  assert.match(indexRoute, /inventoryEvents:\s*'POST \/api\/v1\/pos\/inventory-events'/)
  assert.match(indexRoute, /'pos:read'/)
  assert.match(indexRoute, /'pos:write'/)
})

test('catalog API returns POS-enabled active products with graph references', () => {
  assert.match(catalogRoute, /requireApiKey\(event,\s*'pos:read'\)/)
  assert.match(catalogRoute, /function isPosEnabled/)
  assert.match(catalogRoute, /'disabled'/)
  assert.match(catalogRoute, /\.from\('products'\)/)
  assert.doesNotMatch(catalogRoute, /count:\s*'exact'/)
  assert.match(catalogRoute, /\.range\(offset, offset \+ limit\)/)
  assert.match(catalogRoute, /const hasMore = fetchedRows\.length > limit/)
  assert.match(catalogRoute, /next_offset: hasMore \? offset \+ rows\.length : null/)
  assert.match(catalogRoute, /\.eq\('status',\s*'active'\)/)
  assert.match(catalogRoute, /pos_enabled/)
  assert.match(catalogRoute, /sellable_in_pos/)
  assert.match(catalogRoute, /\.from\('v_product_identity_graph'\)/)
  assert.match(catalogRoute, /product_identity_id/)
  assert.match(catalogRoute, /trade_unit_id/)
  assert.match(catalogRoute, /sku_assignment_id/)
  assert.match(catalogRoute, /function storageLocationCodeFromProductData/)
  assert.match(catalogRoute, /storage_location_code: storageLocationCode/)
  assert.match(catalogRoute, /productData\.store_location_code/)
  assert.match(catalogRoute, /productData\.bin_location/)
})

test('catalog API exposes timeout-safe cursor pagination', () => {
  assert.match(catalogRoute, /const limit = Math\.min\(Math\.max\(Math\.floor\(requestedLimit\), 1\), 250\)/)
  assert.match(catalogRoute, /has_more: hasMore/)
  assert.match(catalogRoute, /next_offset: hasMore \? offset \+ rows\.length : null/)
  assert.match(types, /export interface PosCatalogResponse/)
  assert.match(types, /has_more: boolean/)
  assert.match(types, /next_offset: number \| null/)
  assert.match(openapiRoute, /has_more: \{ type: 'boolean' \}/)
  assert.match(openapiRoute, /next_offset: \{ type: 'integer', nullable: true \}/)
  assert.match(openapiRoute, /storage_location_code: \{ type: 'string', nullable: true \}/)
})

test('API v1 allows browser POS clients to call SKUMS across origins', () => {
  assert.match(corsMiddleware, /path\.startsWith\('\/api\/v1\/'\)/)
  assert.match(corsMiddleware, /Access-Control-Allow-Origin/)
  assert.match(corsMiddleware, /Access-Control-Allow-Headers/)
  assert.match(corsMiddleware, /authorization,content-type,x-api-key/)
  assert.match(corsMiddleware, /getMethod\(event\) === 'OPTIONS'/)
})

test('scan API delegates deterministic resolution to RPC', () => {
  assert.match(scanRoute, /requireApiKey\(event,\s*'pos:read'\)/)
  assert.match(scanRoute, /\.rpc\('resolve_pos_scan'/)
  assert.match(scanRoute, /p_workspace_id:\s*ctx\.workspaceId/)
  assert.match(scanRoute, /p_identifier:\s*identifier/)
})

test('sales API writes sale, graph-aware items, and payments under workspace scope', () => {
  assert.match(salesRoute, /createPosSaleFromBody/)
  assert.match(posSaleIngest, /requireApiKey\(event,\s*'pos:write'\)/)
  assert.match(posSaleIngest, /\.from\('pos_sales'\)/)
  assert.match(posSaleIngest, /\.from\('pos_sale_items'\)/)
  assert.match(posSaleIngest, /\.from\('pos_sale_payments'\)/)
  assert.match(posSaleIngest, /workspace_id:\s*ctx\.workspaceId/)
  assert.match(posSaleIngest, /product_identity_id:\s*item\.product_identity_id/)
  assert.match(posSaleIngest, /trade_unit_id:\s*item\.trade_unit_id/)
  assert.match(posSaleIngest, /sku_assignment_id:\s*item\.sku_assignment_id/)
})

test('inventory event API accepts POS damage, found stock, and transfer receipts', () => {
  assert.match(inventoryEventsRoute, /requireApiKey\(event,\s*'pos:write'\)/)
  assert.match(inventoryEventsRoute, /inventory\.damage\.reported/)
  assert.match(inventoryEventsRoute, /inventory\.found_stock\.reported/)
  assert.match(inventoryEventsRoute, /inventory\.transfer_receive\.reported/)
  assert.match(inventoryEventsRoute, /\.from\('pos_inventory_events'\)/)
  assert.match(inventoryEventsRoute, /\.from\('inventory_adjustments'\)/)
  assert.match(inventoryEventsRoute, /\.from\('inventory_adjustment_lines'\)/)
  assert.match(inventoryEventsRoute, /\.rpc\('receive_inventory_transfer'/)
  assert.match(inventoryEventsRoute, /idempotency_key/)
  assert.match(openapiRoute, /createPosInventoryEvent/)
  assert.match(openapiRoute, /PosInventoryEvent/)
})

test('POS inventory event migration creates queue and transfer receipt RPC', () => {
  assert.match(posInventoryEventsMigration, /create table if not exists public\.pos_inventory_events/)
  assert.match(posInventoryEventsMigration, /inventory\.damage\.reported/)
  assert.match(posInventoryEventsMigration, /inventory\.found_stock\.reported/)
  assert.match(posInventoryEventsMigration, /inventory\.transfer_receive\.reported/)
  assert.match(posInventoryEventsMigration, /create unique index if not exists idx_pos_inventory_events_idempotency/)
  assert.match(posInventoryEventsMigration, /create or replace function public\.receive_inventory_transfer/)
  assert.match(posInventoryEventsMigration, /auth\.role\(\) <> 'service_role'/)
  assert.match(posInventoryEventsMigration, /transfer_received/)
})

test('SKUMS shared app types include POS graph contracts', () => {
  for (const name of ['PosLocation', 'PosRegister', 'PosSale', 'PosSaleItem', 'PosSalePayment', 'PosInventoryEvent', 'PosScanResolution', 'PosCatalogItem']) {
    assert.match(types, new RegExp(`export interface ${name}`))
  }
  assert.match(types, /export type PosInventoryEventType/)
  assert.match(types, /export type PosInventoryEventStatus/)
  assert.match(types, /product_identity_id: string \| null/)
  assert.match(types, /trade_unit_id: string \| null/)
  assert.match(types, /match_status: 'none' \| 'single' \| 'ambiguous'/)
  assert.match(types, /pos_enabled: boolean/)
  assert.match(types, /storage_location_code: string \| null/)
})
