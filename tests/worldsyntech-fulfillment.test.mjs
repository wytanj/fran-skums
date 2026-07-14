import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const fulfillmentTypes = readFileSync(new URL('../packages/@skums-types/fulfillment-adapter.ts', import.meta.url), 'utf8')
const packageIndex = readFileSync(new URL('../packages/@skums-types/index.ts', import.meta.url), 'utf8')
const registry = readFileSync(new URL('../fulfillment/_registry.ts', import.meta.url), 'utf8')
const importsFile = readFileSync(new URL('../fulfillment/_imports.ts', import.meta.url), 'utf8')
const client = readFileSync(new URL('../fulfillment/worldsyntech-ofs/client.ts', import.meta.url), 'utf8')
const mapping = readFileSync(new URL('../fulfillment/worldsyntech-ofs/mapping.ts', import.meta.url), 'utf8')
const adapter = readFileSync(new URL('../fulfillment/worldsyntech-ofs/adapter.ts', import.meta.url), 'utf8')
const testRoute = readFileSync(new URL('../server/api/integrations/worldsyntech-ofs/test.post.ts', import.meta.url), 'utf8')
const referenceRoute = readFileSync(new URL('../server/api/integrations/worldsyntech-ofs/sync-reference-data.post.ts', import.meta.url), 'utf8')
const inventoryRoute = readFileSync(new URL('../server/api/integrations/worldsyntech-ofs/pull-inventory.post.ts', import.meta.url), 'utf8')
const inboundRoute = readFileSync(new URL('../server/api/integrations/worldsyntech-ofs/create-inbound-shipment.post.ts', import.meta.url), 'utf8')
const replenishmentRoute = readFileSync(new URL('../server/api/integrations/worldsyntech-ofs/create-store-replenishment.post.ts', import.meta.url), 'utf8')
const integrationActions = readFileSync(new URL('../server/utils/integrationActions.ts', import.meta.url), 'utf8')
const composable = readFileSync(new URL('../app/composables/useIntegrations.ts', import.meta.url), 'utf8')
const integrationsPage = readFileSync(new URL('../app/pages/integrations.vue', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../core/db/043_fulfillment_integrations.sql', import.meta.url), 'utf8')
const supabaseMigration = readFileSync(new URL('../supabase/migrations/202606240043_fulfillment_integrations.sql', import.meta.url), 'utf8')

test('fulfillment adapter is a first-class generic contract separate from channels', () => {
  assert.match(fulfillmentTypes, /export interface FulfillmentAdapter/)
  assert.match(fulfillmentTypes, /StoreReplenishmentOrder/)
  assert.match(fulfillmentTypes, /InboundShipmentRequest/)
  assert.match(fulfillmentTypes, /FulfillmentInventoryRecord/)
  assert.match(packageIndex, /fulfillment-adapter/)
  assert.match(registry, /registerFulfillmentAdapter/)
  assert.match(registry, /getFulfillmentAdapter/)
  assert.match(importsFile, /worldsyntech-ofs/)
})

test('WorldSyntech/OFS adapter models Loft as 3PL warehouse replenishment', () => {
  assert.match(adapter, /id: 'worldsyntech_ofs'/)
  assert.match(adapter, /retail_replenishment/)
  assert.match(adapter, /inbound_warehouse/)
  assert.match(adapter, /stock_visibility/)
  assert.match(adapter, /type: 'basic_token'/)
  assert.match(adapter, /required_fields: \['base_url', 'basic_token', 'user_name', 'password'\]/)
  assert.match(adapter, /storeReplenishmentOrders/)
  assert.match(adapter, /inboundShipments/)
})

test('WorldSyntech/OFS client uses documented routes and validates success envelope', () => {
  assert.match(client, /rest_customer\/customer_security\/api_login/)
  assert.match(client, /grant_type/)
  assert.match(client, /Authorization: `Basic/)
  assert.match(client, /Authorization: `Bearer/)
  assert.match(client, /envelopeOk/)
  assert.match(client, /WorldSyntech\/OFS rejected request/)
  assert.match(client, /rest_customer\/inventory\/get_list/)
  assert.match(client, /rest_customer\/ship_to_warehouse\/create/)
  assert.match(client, /rest_customer\/order\/create/)
  assert.match(client, /rest_customer\/delivery_method\/get_list/)
})

test('WorldSyntech/OFS mapping keeps ecommerce optional and names store replenishment locally', () => {
  assert.match(mapping, /retail_replenishment/)
  assert.match(mapping, /mapStoreReplenishmentToWorldsyntechPayload/)
  assert.match(mapping, /cod_total: 0/)
  assert.match(mapping, /mapInboundShipmentToWorldsyntechPayload/)
  assert.match(mapping, /stock_incoming_id/)
  assert.match(mapping, /available_quantity/)
})

test('WorldSyntech/OFS server routes require workspace access and write integration execution logs', () => {
  for (const route of [testRoute, referenceRoute, inventoryRoute, inboundRoute, replenishmentRoute]) {
    assert.match(route, /worldsyntech-ofs/)
  }
  assert.match(testRoute, /loadIntegrationCredential/)
  assert.match(referenceRoute, /startIntegrationExecution/)
  assert.match(referenceRoute, /upsertIntegrationEntityMapping/)
  assert.match(inventoryRoute, /pull_inventory/)
  assert.match(inboundRoute, /create_inbound_shipment/)
  assert.match(replenishmentRoute, /create_store_replenishment/)
  const pullProductsRoute = readFileSync(new URL('../server/api/integrations/worldsyntech-ofs/pull-products.post.ts', import.meta.url), 'utf8')
  assert.match(pullProductsRoute, /pull_products/)
  assert.match(integrationActions, /requireWorkspaceAccess/)
  assert.match(integrationActions, /integration_entity_mappings/)
})

test('WorldSyntech/OFS integration is exposed in composable and UI action surface', () => {
  assert.match(composable, /\/api\/integrations\/worldsyntech-ofs\/test/)
  assert.match(composable, /syncWorldsyntechReferenceData/)
  assert.match(composable, /pullWorldsyntechInventory/)
  assert.match(integrationsPage, /isWorldsyntechCredential/)
  assert.match(integrationsPage, /isWorldsyntechConnection/)
  assert.match(integrationsPage, /Sync refs/)
  assert.match(integrationsPage, /Pull inventory/)
  assert.match(integrationsPage, /nodeGlyph/)
})

test('fulfillment migration creates generic mappings and seeds OFS app/node definitions', () => {
  for (const sql of [migration, supabaseMigration]) {
    assert.match(sql, /create table if not exists public\.integration_entity_mappings/)
    assert.match(sql, /inventory_snapshot/)
    assert.match(sql, /grant select, insert, update, delete on table public\.integration_entity_mappings/)
    assert.match(sql, /to authenticated, service_role/)
    assert.match(sql, /'worldsyntech-ofs'/)
    assert.match(sql, /'worldsyntech_ofs'/)
    assert.match(sql, /Loft Logistics/)
    assert.match(sql, /retail_replenishment/)
  }
})
