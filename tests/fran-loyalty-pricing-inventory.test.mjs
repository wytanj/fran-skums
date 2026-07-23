import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const contractDoc = readFileSync(new URL('../docs/fran-skums-contract.md', import.meta.url), 'utf8')
const pricingInventory = readFileSync(new URL('../server/fran/pricingInventory.ts', import.meta.url), 'utf8')
const quoteRoute = readFileSync(new URL('../server/routes/fran/pos/basket/quote.post.ts', import.meta.url), 'utf8')
const reservationsRoute = readFileSync(new URL('../server/routes/fran/pos/reservations/index.post.ts', import.meta.url), 'utf8')
const commitRoute = readFileSync(new URL('../server/routes/fran/pos/reservations/[id]/commit.post.ts', import.meta.url), 'utf8')
const releaseRoute = readFileSync(new URL('../server/routes/fran/pos/reservations/[id]/release.post.ts', import.meta.url), 'utf8')
const posSaleIngest = readFileSync(new URL('../server/utils/posSaleIngest.ts', import.meta.url), 'utf8')
const coreMigration = readFileSync(new URL('../core/db/046_loyalty_pricing_inventory.sql', import.meta.url), 'utf8')
const supabaseMigration = readFileSync(new URL('../supabase/migrations/202607090046_loyalty_pricing_inventory.sql', import.meta.url), 'utf8')
const migrationIndex = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')
const supabaseIndex = readFileSync(new URL('../supabase/migrations/README.md', import.meta.url), 'utf8')
const types = readFileSync(new URL('../app/types/index.ts', import.meta.url), 'utf8')

test('Fran contract advertises quote-first pricing and reservation lifecycle', () => {
  assert.match(contractDoc, /\/fran\/pos\/basket\/quote/)
  assert.match(contractDoc, /\/fran\/pos\/reservations/)
  assert.match(contractDoc, /\/fran\/pos\/reservations\/\[id\]\/commit/)
  assert.match(contractDoc, /\/fran\/pos\/reservations\/\[id\]\/release/)
  assert.match(contractDoc, /quote response is the live pricing basis/)
  assert.match(contractDoc, /inventory_levels/)
  assert.match(contractDoc, /pos_reservation_id/)
})

test('L-skums sale contract preserves loyalty refs without settling points', () => {
  const posNorm = readFileSync(new URL('../server/fran/pos.ts', import.meta.url), 'utf8')
  assert.match(posNorm, /loyalty_member_ref/)
  assert.match(posNorm, /loyalty_policy_version_id/)
  assert.match(posNorm, /loyalty_skums_quote_id/)
  assert.match(posNorm, /loyalty_voucher_ids/)
  assert.match(posNorm, /points_earned/)
  assert.match(posNorm, /points_redeemed/)
  assert.match(contractDoc, /Loyalty Sale Contract/)
  assert.match(contractDoc, /SKUMS never computes or mutates point balances/)
  assert.match(contractDoc, /\/fran\/pos\/products\/context/)
})

test('L-skums bulk product context route exists for POS/CRM evaluation', () => {
  const bulk = readFileSync(
    new URL('../server/routes/fran/pos/products/context.post.ts', import.meta.url),
    'utf8',
  )
  assert.match(bulk, /product_ids/)
  assert.match(bulk, /toFranProductContext/)
  assert.match(bulk, /pos:read/)
  assert.match(bulk, /Does not compute points/)
})

test('quote route prices from product facts and inventory levels with TTL provenance', () => {
  assert.match(quoteRoute, /createBasketQuoteFromBody/)
  assert.match(pricingInventory, /requireApiKey\(event,\s*'pos:read'\)/)
  assert.match(pricingInventory, /\.from\('pos_basket_quotes'\)/)
  assert.match(pricingInventory, /\.from\('pos_basket_quote_lines'\)/)
  assert.match(pricingInventory, /\.from\('products'\)/)
  assert.match(pricingInventory, /\.from\('inventory_levels'\)/)
  assert.match(pricingInventory, /legacy_product_price/)
  assert.match(pricingInventory, /quote_revision/)
  assert.match(pricingInventory, /ttl_seconds/)
  assert.match(pricingInventory, /blocked_lines/)
  assert.match(pricingInventory, /toFranProductContext/)
  assert.match(pricingInventory, /response_snapshot/)
})

test('reservation routes hold, commit, and release existing inventory reservations', () => {
  assert.match(reservationsRoute, /createReservationFromBody/)
  assert.match(commitRoute, /commitReservationFromBody/)
  assert.match(releaseRoute, /releaseReservationFromBody/)
  assert.match(pricingInventory, /requireApiKey\(event,\s*'pos:write'\)/)
  assert.match(pricingInventory, /\.from\('pos_reservations'\)/)
  assert.match(pricingInventory, /\.from\('pos_reservation_lines'\)/)
  assert.match(pricingInventory, /\.from\('inventory_reservations'\)/)
  assert.match(pricingInventory, /\.rpc\('upsert_inventory_level'/)
  assert.match(pricingInventory, /p_quantity_type:\s*'reserved'/)
  assert.match(pricingInventory, /p_movement_type:\s*'reservation'/)
  assert.match(pricingInventory, /p_movement_type:\s*'unreservation'/)
})

test('sale ingest commits reservation stock or direct sale movements', () => {
  assert.match(posSaleIngest, /commitInventoryForPosSale/)
  assert.match(posSaleIngest, /inventory_commit/)
  assert.match(pricingInventory, /mode:\s*'reservation_commit'/)
  assert.match(pricingInventory, /mode:\s*'direct_sale_movement'/)
  assert.match(pricingInventory, /p_movement_type:\s*movementType/)
  assert.match(pricingInventory, /p_reference_type:\s*'pos_sale'/)
})

test('loyalty pricing inventory migration is mirrored and protected by RLS', () => {
  assert.equal(coreMigration, supabaseMigration)
  assert.match(coreMigration, /create table if not exists public\.pos_basket_quotes/)
  assert.match(coreMigration, /create table if not exists public\.pos_basket_quote_lines/)
  assert.match(coreMigration, /create table if not exists public\.pos_reservations/)
  assert.match(coreMigration, /create table if not exists public\.pos_reservation_lines/)
  assert.match(coreMigration, /alter table public\.inventory_reservations/)
  assert.match(coreMigration, /pos_reservation_id uuid/)
  assert.match(coreMigration, /quote_line_id uuid/)
  assert.match(coreMigration, /reason_type in \(/)
  assert.match(coreMigration, /'reward'/)
  assert.match(coreMigration, /'sample'/)
  assert.match(coreMigration, /enable row level security/)
  assert.match(coreMigration, /grant select, insert, update, delete on table/)
  assert.match(migrationIndex, /046\s+\|\s+loyalty_pricing_inventory\.sql/)
  assert.match(supabaseIndex, /202607090046_loyalty_pricing_inventory\.sql/)
})

test('shared app types expose quote and reservation contracts', () => {
  assert.match(types, /export interface PosBasketQuote/)
  assert.match(types, /export interface PosBasketQuoteLine/)
  assert.match(types, /export interface PosQuoteAvailability/)
  assert.match(types, /export interface PosReservation/)
  assert.match(types, /export interface PosReservationLine/)
  assert.match(types, /export type PosQuoteMode/)
  assert.match(types, /export type PosReservationStatus/)
})
