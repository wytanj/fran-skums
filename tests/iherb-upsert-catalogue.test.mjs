/**
 * iHerb catalogue writer — mock DB + real Anua fixture.
 *
 * @see marketplace/iherb/upsertCatalogue.mjs
 * @see docs/IHERB_HANDOFF.md Task 2
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseIherbCatalogue } from '../marketplace/iherb/parseCatalogue.mjs'
import {
  assertCurrencyConsistent,
  normaliseCoverage,
  upsertIherbCatalogue,
} from '../marketplace/iherb/upsertCatalogue.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = join(root, 'extensions/sample-iherb-anua.html')
const hasFixture = existsSync(FIXTURE)
const html = hasFixture ? readFileSync(FIXTURE, 'utf8') : ''
const catalogue = hasFixture
  ? parseIherbCatalogue(html, {
      url: 'https://sg.iherb.com/c/anua',
      captured_at: '2026-08-01T00:00:00.000Z',
    })
  : null

/** Minimal Supabase-shaped mock that records upserts/inserts. */
function createMockDb() {
  const products = []
  const snapshots = []
  let seq = 0

  const db = {
    products,
    snapshots,
    from(table) {
      return {
        upsert(row) {
          if (table !== 'iherb_products') {
            return {
              select() {
                return {
                  single: async () => ({
                    data: null,
                    error: { message: `unexpected upsert ${table}` },
                  }),
                }
              },
            }
          }
          const key = `${row.workspace_id}|${row.country}|${row.part_number}`
          let existing = products.find(
            (p) => `${p.workspace_id}|${p.country}|${p.part_number}` === key,
          )
          if (existing) {
            Object.assign(existing, row)
          } else {
            existing = { ...row, id: `prod-${++seq}` }
            products.push(existing)
          }
          return {
            select() {
              return {
                single: async () => ({ data: { id: existing.id }, error: null }),
              }
            },
          }
        },
        insert(row) {
          if (table === 'iherb_product_snapshots') {
            snapshots.push(row)
            return Promise.resolve({ error: null })
          }
          return Promise.resolve({ error: { message: `unexpected insert ${table}` } })
        },
      }
    },
  }

  return db
}

// ---------------------------------------------------------------------------
// Pure guards
// ---------------------------------------------------------------------------

test('assertCurrencyConsistent throws on mixed currencies', () => {
  assert.throws(
    () => assertCurrencyConsistent({ currency_consistent: false, currencies: ['SGD', 'USD'] }),
    (err) => err.code === 'IHERB_CURRENCY_INCONSISTENT',
  )
})

test('assertCurrencyConsistent allows consistent or empty coverage', () => {
  assert.doesNotThrow(() => assertCurrencyConsistent({ currency_consistent: true, currencies: ['SGD'] }))
  assert.doesNotThrow(() => assertCurrencyConsistent(null))
  assert.doesNotThrow(() => assertCurrencyConsistent({}))
})

test('normaliseCoverage fills defaults and preserves sold_period', () => {
  const c = normaliseCoverage({
    products: 10,
    with_sold: 7,
    currencies: ['SGD'],
    currency_consistent: true,
    sold_period: 'month',
  })
  assert.equal(c.with_sold, 7)
  assert.equal(c.sold_period, 'month')
  assert.equal(c.currency_consistent, true)
})

// ---------------------------------------------------------------------------
// Writer against mock DB
// ---------------------------------------------------------------------------

test('upsertIherbCatalogue refuses mixed-currency catalogue before any write', async () => {
  const db = createMockDb()
  await assert.rejects(
    () => upsertIherbCatalogue(db, {
      workspace_id: 'ws-1',
      brand_key: 'anua',
      catalogue: {
        products: [
          { part_number: 'A-1', name: 'X', price: 1, currency: 'SGD' },
          { part_number: 'A-2', name: 'Y', price: 2, currency: 'USD' },
        ],
        coverage: {
          products: 2,
          with_sold: 0,
          with_price: 2,
          currencies: ['SGD', 'USD'],
          currency_consistent: false,
        },
      },
    }),
    (err) => err.code === 'IHERB_CURRENCY_INCONSISTENT',
  )
  assert.equal(db.products.length, 0)
  assert.equal(db.snapshots.length, 0)
})

test('upsertIherbCatalogue requires workspace_id and brand_key', async () => {
  const db = createMockDb()
  await assert.rejects(
    () => upsertIherbCatalogue(db, { brand_key: 'anua', catalogue: { products: [] } }),
    /workspace_id/,
  )
  await assert.rejects(
    () => upsertIherbCatalogue(db, { workspace_id: 'ws-1', catalogue: { products: [] } }),
    /brand_key/,
  )
})

test('upsertIherbCatalogue skips rows without part_number', async () => {
  const db = createMockDb()
  const result = await upsertIherbCatalogue(db, {
    workspace_id: 'ws-1',
    brand_key: 'Anua',
    catalogue: {
      products: [
        { name: 'no key', price: 1, currency: 'SGD' },
        { part_number: 'AUU-1', name: 'ok', price: 2, currency: 'SGD' },
      ],
      coverage: {
        products: 2,
        with_sold: 0,
        with_price: 2,
        currencies: ['SGD'],
        currency_consistent: true,
      },
    },
  })
  assert.equal(result.skipped, 1)
  assert.equal(result.products_upserted, 1)
  assert.equal(result.snapshots_inserted, 1)
  assert.equal(db.products[0].brand_key, 'anua')
})

test('upsertIherbCatalogue writes product + snapshot and re-upserts identity', async () => {
  const db = createMockDb()
  const input = {
    workspace_id: 'ws-1',
    brand_key: 'anua',
    country: 'sg',
    captured_at: '2026-08-01T12:00:00.000Z',
    catalogue: {
      url: 'https://sg.iherb.com/c/anua',
      products: [
        {
          product_id: '131859',
          part_number: 'AUU-73442',
          name: 'Anua Heartleaf',
          brand_name: 'Anua',
          brand_id: 'AUU',
          url: 'https://sg.iherb.com/pr/x/131859',
          price: 17.31,
          list_price: 17.31,
          discount_pct: 0,
          currency: 'SGD',
          rating: 4.7,
          review_count: 7354,
          sold_label: '4,000+ sold in 30 days',
          sold_lower_bound: 4000,
          sold_is_bucket: true,
          sold_period: 'month',
          in_stock: true,
          is_sponsored: false,
          position: 1,
        },
      ],
      coverage: {
        products: 1,
        with_sold: 1,
        with_price: 1,
        with_rating: 1,
        currencies: ['SGD'],
        currency_consistent: true,
        sold_period: 'month',
      },
    },
  }

  const first = await upsertIherbCatalogue(db, input)
  assert.equal(first.products_upserted, 1)
  assert.equal(first.snapshots_inserted, 1)
  assert.equal(db.products.length, 1)
  assert.equal(db.products[0].part_number, 'AUU-73442')
  assert.equal(db.snapshots[0].sold_period, 'month')
  assert.equal(db.snapshots[0].sold_lower_bound, 4000)
  assert.equal(db.snapshots[0].signals.run_coverage.with_sold, 1)
  assert.match(db.snapshots[0].signals.sold_field_note, /30-day/)

  // Second run same part_number → one product row, two snapshots
  input.captured_at = '2026-08-02T12:00:00.000Z'
  input.catalogue.products[0].price = 16.99
  const second = await upsertIherbCatalogue(db, input)
  assert.equal(second.products_upserted, 1)
  assert.equal(second.snapshots_inserted, 1)
  assert.equal(db.products.length, 1)
  assert.equal(db.snapshots.length, 2)
  assert.equal(db.snapshots[1].price, 16.99)
})

// ---------------------------------------------------------------------------
// Real Anua fixture end-to-end through writer
// ---------------------------------------------------------------------------

test('Anua fixture: 48 products + 48 snapshots via writer', { skip: !hasFixture }, async () => {
  const db = createMockDb()
  const result = await upsertIherbCatalogue(db, {
    workspace_id: 'ws-fixture',
    brand_key: 'anua',
    catalogue,
  })

  assert.equal(catalogue.coverage.products, 48)
  assert.equal(result.products_upserted, 48)
  assert.equal(result.snapshots_inserted, 48)
  assert.equal(result.skipped, 0)
  assert.equal(result.errors.length, 0)
  assert.equal(db.products.length, 48)
  assert.equal(db.snapshots.length, 48)

  // Coverage contract from handoff: sold is partial (~70%), currency SGD only
  assert.ok(result.coverage.with_sold >= 30 && result.coverage.with_sold < 48)
  assert.equal(result.coverage.with_price, 48)
  assert.deepEqual(result.coverage.currencies, ['SGD'])
  assert.equal(result.coverage.currency_consistent, true)
  assert.equal(result.coverage.sold_period, 'month')

  const first = db.products[0]
  assert.equal(first.brand_key, 'anua')
  assert.equal(first.country, 'sg')
  assert.ok(first.part_number)
  assert.equal(first.metadata.last_harvest_coverage.products, 48)

  const soldSnaps = db.snapshots.filter((s) => s.sold_lower_bound != null)
  assert.equal(soldSnaps.length, result.coverage.with_sold)
  assert.ok(soldSnaps.every((s) => s.sold_period === 'month'))
})

test('migration 086 defines separate iherb tables with RLS', () => {
  // CRLF-safe: never use /--.*$/ which fails on Windows checkouts.
  const sql = readFileSync(join(root, 'core/db/086_iherb_catalogue.sql'), 'utf8')
  assert.match(sql, /create table if not exists public\.iherb_products/)
  assert.match(sql, /create table if not exists public\.iherb_product_snapshots/)
  assert.match(sql, /unique \(workspace_id, country, part_number\)/)
  assert.match(sql, /enable row level security/)
  assert.match(sql, /get_my_workspace_ids/)
  assert.match(sql, /get_my_writable_workspace_ids/)
  assert.match(sql, /idx_iherb_products_workspace_brand/)
  assert.match(sql, /product_row_id, captured_at desc/)
  // Creates only iherb_* tables (comments may mention marketplace_listings as a warning)
  assert.doesNotMatch(sql, /create table if not exists public\.marketplace_listings/i)
  assert.doesNotMatch(sql, /create table if not exists public\.marketplace_brand_rollup/i)
  assert.match(sql, /Separate from marketplace_listings/)
})
