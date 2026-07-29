/**
 * Track K Rpt-6 — real report section handlers (hybrid live + stub).
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  runStubSections,
  runReportSections,
  REPORT_SECTION_IDS,
} from '../core/reports/sections.mjs'

function createMockClient(tables) {
  return {
    from(table) {
      const rows = tables[table]
      let limitN = 5000
      let headCount = false
      let maybe = false

      const builder = {
        select(_cols, opts) {
          if (opts?.head && opts?.count === 'exact') headCount = true
          return builder
        },
        eq() {
          return builder
        },
        in() {
          return builder
        },
        or() {
          return builder
        },
        order() {
          return builder
        },
        limit(n) {
          limitN = n
          return builder
        },
        maybeSingle() {
          maybe = true
          return builder.then((r) => r)
        },
        then(resolve, reject) {
          try {
            if (rows === undefined) {
              return Promise.resolve({ data: headCount ? null : [], error: null, count: 0 }).then(
                resolve,
                reject,
              )
            }
            if (headCount) {
              const n = Array.isArray(rows) ? rows.length : rows ? 1 : 0
              return Promise.resolve({ data: null, error: null, count: n }).then(resolve, reject)
            }
            if (maybe) {
              const data = Array.isArray(rows) ? rows[0] ?? null : rows
              return Promise.resolve({ data, error: null }).then(resolve, reject)
            }
            let data = Array.isArray(rows) ? rows.slice(0, limitN) : rows
            return Promise.resolve({
              data,
              error: null,
              count: Array.isArray(data) ? data.length : 0,
            }).then(resolve, reject)
          } catch (e) {
            return Promise.reject(e).then(resolve, reject)
          }
        },
      }
      return builder
    },
  }
}

describe('Rpt-6 section handlers', () => {
  test('exports live handler ids for seed + demand packs', () => {
    for (const id of [
      'demand.velocity_snapshot',
      'reorder.store_fill',
      'reorder.supplier_buy',
      'sales.top_movers',
      'sales.category_rollup',
      'inventory.ats_by_location',
      'inventory.cover_days',
      'ops.open_queues',
      'ops.wave_baseline',
      'finance.stock_position',
      'loyalty.rewards_liability',
      'data_quality.gaps',
    ]) {
      assert.ok(REPORT_SECTION_IDS.includes(id), `missing handler ${id}`)
    }
  })

  test('runStubSections still suggest-only', () => {
    const r = runStubSections(['sales.top_movers', 'unknown.section'])
    assert.equal(r.sections.length, 2)
    assert.ok(r.markdown.includes('Suggest'))
    assert.ok(r.sections.every((s) => s.status === 'stub'))
  })

  test('runReportSections without client falls back to stubs', async () => {
    const r = await runReportSections(null, '', ['sales.top_movers', 'demand.velocity_snapshot'])
    assert.equal(r.sections.length, 2)
    assert.ok(r.sections.every((s) => s.status === 'stub'))
  })

  test('runReportSections with mock client returns ok path A/B', async () => {
    const client = createMockClient({
      v_demand_velocity: [
        {
          product_id: 'p1',
          product_title: 'Serum A',
          product_sku: 'SKU-1',
          velocity_7d: 1,
          velocity_30d: 0.8,
          velocity_90d: 0.5,
          best_velocity: 0.8,
          days_with_sales: 20,
          units_30d: 24,
          units_90d: 45,
          units_7d: 7,
          last_sale_date: '2026-07-20',
        },
      ],
      v_reorder_alerts: [
        {
          product_id: 'p1',
          product_title: 'Serum A',
          product_sku: 'SKU-1',
          daily_velocity: 0.8,
          available_to_sell: 2,
          total_on_order: 0,
          days_of_stock_remaining: 2,
          lead_time_days: 14,
          alert_level: 'critical',
          suggested_order_qty: 36,
          reorder_point: 20,
        },
        {
          product_id: 'p2',
          product_title: 'Mask B',
          product_sku: 'SKU-2',
          daily_velocity: 1.2,
          available_to_sell: 0,
          total_on_order: 0,
          days_of_stock_remaining: 0,
          lead_time_days: 14,
          alert_level: 'stockout',
          suggested_order_qty: 50,
          reorder_point: 20,
        },
      ],
      inventory_locations: [
        { id: 'loc-wh', location_type: 'warehouse', name: 'Loft', code: 'WH', is_active: true },
        { id: 'loc-st', location_type: 'store', name: 'Orchard', code: 'ST1', is_active: true },
      ],
      inventory_levels: [
        { product_id: 'p1', location_id: 'loc-wh', on_hand: 50, reserved: 0, on_order: 0 },
        { product_id: 'p1', location_id: 'loc-st', on_hand: 2, reserved: 0, on_order: 0 },
        // p2 has no warehouse stock → path B
      ],
      products: [{ id: 'p1', category_id: 'c1', categories: { name: 'Skincare' } }],
      workspace_crm_links: null,
      store_replenishment_requests: [],
      inventory_adjustments: [],
      inventory_exceptions: [],
      inbound_shipments: [],
      store_replenishment_waves: [],
    })

    const r = await runReportSections(client, 'ws-1', [
      'demand.velocity_snapshot',
      'reorder.store_fill',
      'reorder.supplier_buy',
      'sales.top_movers',
      'finance.stock_position',
      'unknown.future',
    ])

    assert.ok(r.meta)
    assert.equal(r.meta.total, 6)
    const byId = Object.fromEntries(r.sections.map((s) => [s.id, s]))
    assert.equal(byId['demand.velocity_snapshot'].status, 'ok')
    assert.equal(byId['reorder.store_fill'].status, 'ok')
    assert.equal(byId['reorder.store_fill'].data.path, 'store_fill')
    assert.ok(
      (byId['reorder.store_fill'].data.lines || []).some((l) => l.product_id === 'p1'),
      'path A should include p1 with loft stock',
    )
    assert.equal(byId['reorder.supplier_buy'].status, 'ok')
    assert.ok(
      (byId['reorder.supplier_buy'].data.lines || []).some((l) => l.product_id === 'p2'),
      'path B should include p2 without loft stock',
    )
    assert.equal(byId['unknown.future'].status, 'stub')
    assert.ok(r.markdown.includes('Suggest'))
  })

  test('reportRegistry and MCP wire runReportSections', () => {
    const reg = readFileSync(new URL('../server/utils/reportRegistry.ts', import.meta.url), 'utf8')
    assert.match(reg, /runReportSections/)
    assert.doesNotMatch(reg, /Stub sections until Rpt-6/)
    const mcp = readFileSync(new URL('../mcp/src/lib/reports.mjs', import.meta.url), 'utf8')
    assert.match(mcp, /runReportSections/)
  })
})
