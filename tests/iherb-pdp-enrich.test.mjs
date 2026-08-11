/**
 * iHerb PDP enrich helpers — candidate ranking + health (no browser).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectIherbPdpHealth,
  loadIherbPdpCandidates,
} from '../marketplace/iherb/pdpEnrich.mjs'

test('detectIherbPdpHealth: found product is ok', () => {
  assert.equal(
    detectIherbPdpHealth({
      url: 'https://sg.iherb.com/pr/x/1',
      foundProduct: true,
      title: 'Product',
    }),
    'ok',
  )
})

test('detectIherbPdpHealth: 403 / captcha is blocked', () => {
  assert.equal(detectIherbPdpHealth({ status: 403 }), 'blocked')
  assert.equal(
    detectIherbPdpHealth({ title: 'Access Denied', bodyText: 'request blocked' }),
    'blocked',
  )
})

test('detectIherbPdpHealth: PDP url without product is unknown not ok', () => {
  assert.equal(
    detectIherbPdpHealth({
      url: 'https://sg.iherb.com/pr/missing/999',
      foundProduct: false,
      title: 'iHerb',
    }),
    'unknown',
  )
})

test('enrichIherbPdps accepts pages array shape (concurrency cap)', async () => {
  // Dry path only — no browser. Ensures multi-tab API doesn't throw on empty candidates.
  const { enrichIherbPdps } = await import('../marketplace/iherb/pdpEnrich.mjs')
  const fakePage = {}
  const res = await enrichIherbPdps([fakePage, fakePage, fakePage], {
    workspace_id: 'ws',
    dry_run: true,
    candidates: [
      { part_number: 'A', url: 'https://sg.iherb.com/pr/a/1', sold_lower_bound: 10 },
      { part_number: 'B', url: 'https://sg.iherb.com/pr/b/2', sold_lower_bound: 5 },
    ],
    concurrency: 3,
  })
  assert.equal(res.candidates, 2)
  assert.equal(res.skipped, 2)
  assert.equal(res.concurrency, 3)
})

test('loadIherbPdpCandidates prefers high sold and only_missing', async () => {
  const products = [
    {
      id: 'a',
      part_number: 'A-1',
      product_id: '1',
      gtin: null,
      name: 'Low sold',
      brand_key: 'anua',
      brand_name: 'Anua',
      url: 'https://sg.iherb.com/pr/low/1',
      metadata: {},
      last_seen_at: '2026-08-01',
    },
    {
      id: 'b',
      part_number: 'B-1',
      product_id: '2',
      gtin: null,
      name: 'High sold',
      brand_key: 'anua',
      brand_name: 'Anua',
      url: 'https://sg.iherb.com/pr/high/2',
      metadata: {},
      last_seen_at: '2026-08-02',
    },
    {
      id: 'c',
      part_number: 'C-1',
      product_id: '3',
      gtin: '880',
      name: 'Already enriched',
      brand_key: 'anua',
      brand_name: 'Anua',
      url: 'https://sg.iherb.com/pr/done/3',
      metadata: { pdp_enriched_at: '2026-08-01T00:00:00.000Z' },
      last_seen_at: '2026-08-03',
    },
  ]
  const snaps = [
    { product_row_id: 'a', sold_lower_bound: 100, sold_label: '100+', captured_at: '2026-08-08', signals: {} },
    { product_row_id: 'b', sold_lower_bound: 5000, sold_label: '5,000+', captured_at: '2026-08-08', signals: {} },
    { product_row_id: 'c', sold_lower_bound: 9000, sold_label: '9,000+', captured_at: '2026-08-08', signals: {} },
  ]

  const db = {
    from(table) {
      if (table === 'iherb_products') {
        const chain = {
          select() {
            return chain
          },
          eq() {
            return chain
          },
          order() {
            return chain
          },
          limit: async () => ({ data: products, error: null }),
        }
        // terminal: limit returns then we need await on whole chain —
        // supabase returns promise from limit(); emulate:
        chain.limit = (n) => {
          chain._limit = n
          return Promise.resolve({ data: products.slice(0, n), error: null })
        }
        return chain
      }
      if (table === 'iherb_product_snapshots') {
        const chain = {
          select() {
            return chain
          },
          in() {
            return chain
          },
          order() {
            return chain
          },
          limit: () => Promise.resolve({ data: snaps, error: null }),
        }
        return chain
      }
      throw new Error(table)
    },
  }

  const missing = await loadIherbPdpCandidates(db, 'ws', {
    brand_key: 'anua',
    top: 10,
    only_missing: true,
  })
  assert.equal(missing.length, 2)
  assert.equal(missing[0].part_number, 'B-1') // higher sold first
  assert.equal(missing[1].part_number, 'A-1')
  assert.ok(missing.every((c) => !c.has_pdp_enrich))

  const all = await loadIherbPdpCandidates(db, 'ws', {
    brand_key: 'anua',
    top: 10,
    only_missing: false,
  })
  assert.equal(all.length, 3)
  assert.equal(all[0].part_number, 'C-1') // highest sold even if enriched
})
