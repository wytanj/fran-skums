import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const genesis = readFileSync(new URL('../genesis.md', import.meta.url), 'utf8')
const contractDoc = readFileSync(new URL('../docs/fran-skums-contract.md', import.meta.url), 'utf8')
const operationsDoc = readFileSync(new URL('../docs/fran-product-operations.md', import.meta.url), 'utf8')
const metadata = readFileSync(new URL('../core/fran/productMetadata.ts', import.meta.url), 'utf8')
const productContext = readFileSync(new URL('../server/fran/productContext.ts', import.meta.url), 'utf8')
const franPos = readFileSync(new URL('../server/fran/pos.ts', import.meta.url), 'utf8')
const catalogRoute = readFileSync(new URL('../server/routes/fran/pos/catalog.get.ts', import.meta.url), 'utf8')
const scanRoute = readFileSync(new URL('../server/routes/fran/pos/scan/resolve.post.ts', import.meta.url), 'utf8')
const productRoute = readFileSync(new URL('../server/routes/fran/pos/products/[id].get.ts', import.meta.url), 'utf8')
const salesRoute = readFileSync(new URL('../server/routes/fran/pos/sales.post.ts', import.meta.url), 'utf8')
const returnsRoute = readFileSync(new URL('../server/routes/fran/pos/returns.post.ts', import.meta.url), 'utf8')
const crmRoute = readFileSync(new URL('../server/routes/fran/crm/product-context.get.ts', import.meta.url), 'utf8')
const storeOpsRoute = readFileSync(new URL('../server/routes/fran/store-ops/requests.post.ts', import.meta.url), 'utf8')
const coreMigration = readFileSync(new URL('../core/db/045_fran_product_metadata.sql', import.meta.url), 'utf8')
const supabaseMigration = readFileSync(new URL('../supabase/migrations/202606290045_fran_product_metadata.sql', import.meta.url), 'utf8')
const migrationIndex = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')
const supabaseIndex = readFileSync(new URL('../supabase/migrations/README.md', import.meta.url), 'utf8')
const types = readFileSync(new URL('../app/types/index.ts', import.meta.url), 'utf8')
const cors = readFileSync(new URL('../server/middleware/api-cors.ts', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../app/components/AppSidebar.vue', import.meta.url), 'utf8')

test('genesis source contract is preserved as buildout driver', () => {
  assert.match(genesis, /Fran SKUMS Genesis/)
  assert.match(genesis, /POS captures store reality/)
  assert.match(genesis, /SKUMS owns approval, reconciliation, 3PL execution, and exceptions/)
})

test('Fran docs define POS, CRM, and operations boundaries', () => {
  assert.match(contractDoc, /Fran SKUMS Contract/)
  assert.match(contractDoc, /\/fran\/pos\/scan\/resolve/)
  assert.match(contractDoc, /\/fran\/crm\/product-context/)
  assert.match(contractDoc, /Reward events are inventory context only/)
  assert.match(operationsDoc, /Fran Product Operations/)
  assert.match(operationsDoc, /fran_reward_eligible/)
  assert.match(operationsDoc, /reward_stock_mismatch/)
})

test('Fran product metadata is normalized in code and database projection', () => {
  for (const key of [
    'fran_category',
    'fran_brand',
    'fran_collection',
    'fran_reward_eligible',
    'fran_sample_eligible',
    'fran_skin_concern_tags',
    'fran_sensitivity_flags',
    'fran_return_policy_group',
    'fran_store_pickup_eligible',
    'fran_3pl_fulfillment_profile',
  ]) {
    assert.match(metadata, new RegExp(key))
    assert.match(coreMigration, new RegExp(key))
  }
  assert.match(productContext, /toFranProductContext/)
  assert.match(coreMigration, /create view public\.v_fran_product_context\s+with \(security_invoker = true\)/)
  assert.match(coreMigration, /grant select on public\.v_fran_product_context/)
  assert.equal(coreMigration, supabaseMigration)
  assert.match(migrationIndex, /045\s+\|\s+fran_product_metadata\.sql/)
  assert.match(supabaseIndex, /202606290045_fran_product_metadata\.sql/)
})

test('Fran route surface wraps generic SKUMS primitives with Fran context', () => {
  assert.match(catalogRoute, /posCatalogHandler/)
  assert.match(catalogRoute, /attachFranContext/)
  assert.match(scanRoute, /\.rpc\('resolve_pos_scan'/)
  assert.match(scanRoute, /attachFranContext/)
  assert.match(productRoute, /productSelectWithFranContext/)
  assert.match(salesRoute, /normalizeFranPosSaleBody/)
  assert.match(salesRoute, /createPosSaleFromBody/)
  assert.match(returnsRoute, /'return'/)
  assert.match(crmRoute, /requireApiKey\(event,\s*'products:read'\)/)
  assert.match(crmRoute, /toFranProductContext/)
  assert.match(cors, /path\.startsWith\('\/fran\/'\)/)
})

test('Fran POS writes preserve CRM and reward references without owning policy', () => {
  assert.match(franPos, /crm_customer_id/)
  assert.match(franPos, /crm_customer_ref/)
  assert.match(franPos, /loyalty_member_ref/)
  assert.match(franPos, /reward_commitment_ref/)
  assert.match(franPos, /return_ref/)
  assert.match(franPos, /source_app: 'fran_pos'/)
})

test('Fran store-ops request types map to generic store operations', () => {
  assert.match(franPos, /warehouse_replenishment/)
  assert.match(franPos, /3pl_store_shipment/)
  assert.match(franPos, /damaged_tester_sample/)
  assert.match(franPos, /pos_inventory_reconciliation/)
  assert.match(franPos, /reward_stock_mismatch/)
  assert.match(storeOpsRoute, /\.from\('store_replenishment_requests'\)/)
  assert.match(storeOpsRoute, /\.from\('store_replenishment_request_lines'\)/)
  assert.match(storeOpsRoute, /idempotency_key/)
})

test('shared app types and navigation expose Fran contracts', () => {
  assert.match(types, /export interface FranProductMetadata/)
  assert.match(types, /export interface FranProductContext/)
  assert.match(types, /export type FranStoreOpsRequestType/)
  assert.match(sidebar, /Fran Ops/)
  assert.match(sidebar, /href: '\/fran'/)
})
