/**
 * iHerb MCP read-path helpers (no live DB).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IHERB_SOLD_CAVEAT,
  compareBrandShopeeIherb,
  pickLatestSnapshots,
  summarizeIherbBrandRows,
} from '../marketplace/iherb/query.mjs'

test('pickLatestSnapshots keeps first per product when ordered desc', () => {
  const latest = pickLatestSnapshots([
    { product_row_id: 'a', price: 10, captured_at: '2026-08-02' },
    { product_row_id: 'a', price: 9, captured_at: '2026-08-01' },
    { product_row_id: 'b', price: 5, captured_at: '2026-08-02' },
  ])
  assert.equal(latest.get('a').price, 10)
  assert.equal(latest.get('b').price, 5)
  assert.equal(latest.size, 2)
})

test('summarizeIherbBrandRows computes coverage and sold sum', () => {
  const s = summarizeIherbBrandRows([
    { price: 10, currency: 'SGD', rating: 4.5, review_count: 100, sold_lower_bound: 1000, sold_period: 'month', in_stock: true },
    { price: 20, currency: 'SGD', rating: 4.7, review_count: 50, sold_lower_bound: null, sold_period: null, in_stock: false },
    { price: 15, currency: 'SGD', rating: 4.6, review_count: 10, sold_lower_bound: 500, sold_period: 'month', in_stock: true },
  ])
  assert.equal(s.products, 3)
  assert.equal(s.with_sold, 2)
  assert.equal(s.out_of_stock, 1)
  assert.equal(s.sold_30d_sum_lower, 1500)
  assert.equal(s.price_band.min, 10)
  assert.equal(s.price_band.max, 20)
  assert.equal(s.sold_period, 'month')
  assert.ok(s.coverage_ratio_sold > 0.6)
})

test('IHERB_SOLD_CAVEAT forbids ratio framing', () => {
  assert.match(IHERB_SOLD_CAVEAT, /30-DAY|30-day/i)
  assert.match(IHERB_SOLD_CAVEAT, /Never compute a ratio/i)
  assert.match(IHERB_SOLD_CAVEAT, /Shopee/i)
})

test('compareBrandShopeeIherb uses injected deps and never invents a ratio field', async () => {
  const productsPayload = {
    data: [
      { id: 'p1', brand_key: 'cosrx', brand_name: 'CosRx', brand_id: 'CRX' },
      { id: 'p2', brand_key: 'cosrx', brand_name: 'CosRx', brand_id: 'CRX' },
    ],
    error: null,
  }
  const snapsPayload = {
    data: [
      {
        product_row_id: 'p1',
        price: 20,
        currency: 'SGD',
        rating: 4.7,
        review_count: 100,
        sold_lower_bound: 2000,
        sold_period: 'month',
        in_stock: true,
        captured_at: '2026-08-08',
      },
      {
        product_row_id: 'p2',
        price: 15,
        currency: 'SGD',
        rating: 4.5,
        review_count: 50,
        sold_lower_bound: 500,
        sold_period: 'month',
        in_stock: true,
        captured_at: '2026-08-08',
      },
    ],
    error: null,
  }

  const chain = (payload) => {
    const api = {
      select: () => api,
      eq: () => api,
      in: () => api,
      order: () => api,
      limit: async () => payload,
      then: (resolve, reject) => Promise.resolve(payload).then(resolve, reject),
    }
    return api
  }

  const db = {
    from(table) {
      if (table === 'iherb_products') return chain(productsPayload)
      if (table === 'iherb_product_snapshots') return chain(snapsPayload)
      throw new Error(`unexpected table ${table}`)
    },
  }

  const result = await compareBrandShopeeIherb(
    db,
    'ws-1',
    { brand_key: 'cosrx' },
    {
      queryBrandRollup: async () => ({
        groups: [{ brand_key: 'cosrx', sku_count: 80, sold_sum: 50000, sold_max: 8000, price_p50: 18 }],
      }),
    },
  )

  assert.equal(result.brand_key, 'cosrx')
  assert.equal(result.shopee.listings, 80)
  assert.equal(result.shopee.sold_sum, 50000)
  assert.equal(result.iherb.products, 2)
  assert.equal(result.iherb.sold_30d_sum_lower, 2500)
  assert.equal(result.iherb.with_sold, 2)
  assert.ok(result.caveat)
  assert.ok(!('sold_ratio' in result))
  assert.ok(!('ratio' in result))
  assert.match(result.caveat, /Do NOT ratio/i)
})

test('MCP tools register iherb read tools', async () => {
  const { toolDefinitions } = await import('../mcp/src/tools.mjs')
  const names = toolDefinitions.map((t) => t.name)
  assert.ok(names.includes('market_iherb_brands'))
  assert.ok(names.includes('market_iherb_products'))
  assert.ok(names.includes('market_brand_compare'))
  const compare = toolDefinitions.find((t) => t.name === 'market_brand_compare')
  assert.ok(compare.inputSchema.required.includes('brand_key'))
})
