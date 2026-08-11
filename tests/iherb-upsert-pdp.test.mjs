/**
 * iHerb PDP writer — mock DB + Merrymonde / SKIN1004 fixtures.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseIherbProduct } from '../marketplace/iherb/parseProduct.mjs'
import {
  buildPdpProductMetadata,
  buildPdpSnapshotSignals,
  upsertIherbPdp,
} from '../marketplace/iherb/upsertPdp.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const RANKINGS = join(root, 'extensions/sample-iherb-pdp-rankings.html')
const SKIN1004 = join(root, 'extensions/skin1004-product-page.html')
const hasRankings = existsSync(RANKINGS)
const hasSkin = existsSync(SKIN1004)

function createMockDb(seedProducts = []) {
  const products = seedProducts.map((p) => ({ ...p, metadata: p.metadata || {} }))
  const snapshots = []
  let seq = products.length

  return {
    products,
    snapshots,
    from(table) {
      const self = {
        select() {
          return self
        },
        eq() {
          return self
        },
        maybeSingle: async () => {
          if (table !== 'iherb_products') {
            return { data: null, error: { message: `unexpected select ${table}` } }
          }
          // Last filter chain left state on product — resolve by scan for tests
          const p = products[0] || null
          return { data: p, error: null }
        },
        single: async () => {
          const p = products[products.length - 1]
          return { data: p ? { id: p.id, metadata: p.metadata, brand_key: p.brand_key } : null, error: null }
        },
        upsert(row) {
          if (table !== 'iherb_products') {
            return {
              select() {
                return {
                  single: async () => ({ data: null, error: { message: 'bad table' } }),
                }
              },
            }
          }
          const existing = products.find(
            (p) =>
              p.workspace_id === row.workspace_id
              && p.country === row.country
              && p.part_number === row.part_number,
          )
          if (existing) {
            Object.assign(existing, row)
            return {
              select() {
                return {
                  single: async () => ({
                    data: { id: existing.id, metadata: existing.metadata, brand_key: existing.brand_key },
                    error: null,
                  }),
                }
              },
            }
          }
          const created = { ...row, id: `prod-${++seq}` }
          products.push(created)
          return {
            select() {
              return {
                single: async () => ({
                  data: { id: created.id, metadata: created.metadata, brand_key: created.brand_key },
                  error: null,
                }),
              }
            },
          }
        },
        update(row) {
          return {
            eq() {
              return {
                eq: async () => {
                  if (table === 'iherb_products' && products[0]) {
                    Object.assign(products[0], row)
                    if (row.metadata) products[0].metadata = row.metadata
                  }
                  return { error: null }
                },
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
      // Chainable eq that filters for maybeSingle
      const filters = {}
      const chain = {
        select() {
          return chain
        },
        eq(col, val) {
          filters[col] = val
          return chain
        },
        maybeSingle: async () => {
          if (table !== 'iherb_products') {
            return { data: null, error: null }
          }
          const hit = products.find((p) => {
            if (filters.id && p.id !== filters.id) return false
            if (filters.workspace_id && p.workspace_id !== filters.workspace_id) return false
            if (filters.country && p.country !== filters.country) return false
            if (filters.part_number && p.part_number !== filters.part_number) return false
            return true
          })
          return { data: hit || null, error: null }
        },
        single: async () => {
          const r = await chain.maybeSingle()
          if (!r.data) return { data: null, error: { message: 'not found' } }
          return {
            data: { id: r.data.id, metadata: r.data.metadata, brand_key: r.data.brand_key },
            error: null,
          }
        },
        upsert: (row) => self.upsert(row),
        update(row) {
          return {
            eq(col, val) {
              filters[col] = val
              return {
                eq: async (col2, val2) => {
                  filters[col2] = val2
                  const hit = products.find((p) => {
                    if (filters.id && p.id !== filters.id) return false
                    if (filters.workspace_id && p.workspace_id !== filters.workspace_id) return false
                    return true
                  })
                  if (hit) {
                    Object.assign(hit, row)
                    if (row.metadata) hit.metadata = row.metadata
                  }
                  return { error: null }
                },
              }
            },
          }
        },
        insert: (row) => self.insert(row),
      }
      return chain
    },
  }
}

test('buildPdpSnapshotSignals stamps harvest_source and rank_best', () => {
  const sig = buildPdpSnapshotSignals(
    {
      product_id: '150541',
      part_number: 'MMD-123',
      gtin: '123',
      rankings: [
        { rank: 5, category: 'K-Beauty Eyeliner', category_slug: 'k-beauty-eyeliner' },
        { rank: 39, category: 'Eyeliner', category_slug: 'eye-liner' },
      ],
      rank_best: { rank: 5, category: 'K-Beauty Eyeliner', category_slug: 'k-beauty-eyeliner' },
      sold_period: 'month',
      sold_label: '100+ sold in 30 days',
    },
    { brand_key: 'merrymonde', part_number: 'MMD-123' },
  )
  assert.equal(sig.harvest_source, 'iherb_pdp_enrich')
  assert.equal(sig.rank_best_rank, 5)
  assert.equal(sig.rank_best_category, 'K-Beauty Eyeliner')
  assert.equal(sig.rankings.length, 2)
  assert.match(sig.sold_field_note, /30-day/i)
})

test('buildPdpProductMetadata sets pdp_enriched_at and last_rankings', () => {
  const meta = buildPdpProductMetadata(
    { source_url: 'https://sg.iherb.com/c/x' },
    {
      rankings: [{ rank: 1, category: 'Test' }],
      rank_best: { rank: 1, category: 'Test' },
      brand_url: 'https://sg.iherb.com/c/x',
    },
    '2026-08-09T00:00:00.000Z',
  )
  assert.equal(meta.pdp_enriched_at, '2026-08-09T00:00:00.000Z')
  assert.equal(meta.rank_best.rank, 1)
  assert.equal(meta.source_url, 'https://sg.iherb.com/c/x')
})

test('upsertIherbPdp refuses not-found parse', async () => {
  const db = createMockDb()
  await assert.rejects(
    () =>
      upsertIherbPdp(db, {
        workspace_id: 'ws',
        pdp: { found: false, reason: 'bot wall' },
      }),
    (err) => err.code === 'IHERB_PDP_NOT_FOUND',
  )
})

test('upsertIherbPdp writes gtin + rankings snapshot for Merrymonde fixture', {
  skip: !hasRankings,
}, async () => {
  const pdp = parseIherbProduct(readFileSync(RANKINGS, 'utf8'), {
    url: 'https://sg.iherb.com/pr/merrymonde/150541',
    captured_at: '2026-08-09T12:00:00.000Z',
  })
  assert.equal(pdp.found, true)
  assert.ok(pdp.rankings.length >= 5)

  const db = createMockDb([
    {
      id: 'prod-1',
      workspace_id: 'ws',
      country: 'sg',
      part_number: pdp.part_number,
      brand_key: 'merrymonde',
      metadata: {},
    },
  ])

  const write = await upsertIherbPdp(db, {
    workspace_id: 'ws',
    brand_key: 'merrymonde',
    product_row_id: 'prod-1',
    part_number: pdp.part_number,
    pdp,
  })

  assert.equal(write.rankings_count, pdp.rankings.length)
  assert.equal(write.rank_best.rank, 5)
  assert.match(write.rank_best.category, /K-Beauty Eyeliner/i)
  assert.ok(write.gtin || pdp.gtin == null) // gtin may or may not be on this SKU

  assert.equal(db.snapshots.length, 1)
  const snap = db.snapshots[0]
  assert.equal(snap.signals.harvest_source, 'iherb_pdp_enrich')
  assert.equal(snap.signals.rank_best_rank, 5)
  assert.equal(snap.signals.rankings.length, pdp.rankings.length)
  assert.equal(db.products[0].metadata.pdp_enriched_at, pdp.captured_at)
  assert.equal(db.products[0].category_path_text, pdp.breadcrumb?.path_text)
})

test('upsertIherbPdp creates product when catalogue row missing (SKIN1004)', {
  skip: !hasSkin,
}, async () => {
  const pdp = parseIherbProduct(readFileSync(SKIN1004, 'utf8'))
  const db = createMockDb([])
  const write = await upsertIherbPdp(db, {
    workspace_id: 'ws',
    brand_key: 'skin1004',
    pdp,
  })
  assert.equal(write.part_number, 'SIO-26111')
  assert.equal(write.gtin, '8809576261110')
  assert.ok(write.rank_best)
  assert.equal(db.products.length, 1)
  assert.equal(db.products[0].gtin, '8809576261110')
  assert.equal(db.snapshots.length, 1)
})
