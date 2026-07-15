/**
 * Inventory ATS + product logistics status (MCP composite #2)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  deriveLifecycleStages,
  inventoryAts,
  productInventoryStatus,
  resolveProducts,
} from '../core/inventory/index.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tools = readFileSync(join(root, 'mcp/src/tools.mjs'), 'utf8')
const assistantTools = readFileSync(join(root, 'server/utils/assistantTools.ts'), 'utf8')
const assistantPrompt = readFileSync(join(root, 'server/utils/assistantPrompt.ts'), 'utf8')
const todo = readFileSync(join(root, 'TODO.md'), 'utf8')

test('MCP and assistant register inventory_ats + product status tools', () => {
  assert.match(tools, /name: 'inventory_ats'/)
  assert.match(tools, /name: 'product_inventory_status'/)
  assert.match(tools, /case 'inventory_ats'/)
  assert.match(tools, /case 'product_inventory_status'/)
  assert.match(assistantTools, /get_inventory_ats/)
  assert.match(assistantTools, /get_product_inventory_status/)
  assert.match(assistantPrompt, /get_product_inventory_status/)
  assert.match(todo, /product_inventory_status/)
})

test('deriveLifecycleStages prioritizes store ATS and inbound forwarder path', () => {
  const { primary_status, stages } = deriveLifecycleStages(
    [
      {
        location_code: 'LOFT-SG',
        location_type: '3pl',
        on_hand: 10,
        reserved: 0,
        ats: 10,
      },
      {
        location_code: 'XFER-LOFT-STORE',
        location_type: 'in_transit',
        on_hand: 3,
        reserved: 0,
        ats: 3,
      },
      {
        location_code: 'ST-MAIN',
        location_type: 'store',
        on_hand: 2,
        reserved: 0,
        ats: 2,
      },
    ],
    [
      {
        status: 'in_transit',
        offshore_forwarder: 'SG-FWD',
        local_forwarder: 'Local',
        tracking_number: 'TRK1',
        line_qty: 50,
      },
    ],
    [{ status: 'shipped', delivery_mode: 'delivery', line_qty: 5 }],
  )

  assert.ok(stages.some((s) => s.startsWith('in_stock_at_store')))
  assert.ok(stages.some((s) => s.startsWith('in_transit_loft_to_store')))
  assert.ok(stages.some((s) => s.startsWith('in_stock_at_loft')))
  assert.ok(stages.some((s) => s.includes('inbound_in_transit_to_loft')))
  assert.ok(stages.some((s) => s.startsWith('replenish_shipped_to_store')))
  assert.ok(primary_status.startsWith('in_stock_at_store'))
})

test('deriveLifecycleStages inbound draft / asn_sent labels', () => {
  const { stages } = deriveLifecycleStages(
    [],
    [
      { status: 'asn_sent', local_forwarder: 'LF', line_qty: 12 },
      { status: 'loft_receiving', line_qty: 12 },
    ],
    [],
  )
  assert.ok(stages.some((s) => s.startsWith('inbound_asn_sent_to_loft')))
  assert.ok(stages.some((s) => s.startsWith('inbound_loft_receiving')))
})

test('inventoryAts returns empty note when no products match', async () => {
  const db = {
    from(table) {
      if (table !== 'products') throw new Error(table)
      const api = {
        select() {
          return api
        },
        eq() {
          return api
        },
        in() {
          return api
        },
        or() {
          return api
        },
        limit() {
          return api
        },
        then(r) {
          return Promise.resolve({ data: [], error: null }).then(r)
        },
      }
      return api
    },
  }
  const result = await inventoryAts(db, { workspace_id: 'ws-1', skus: ['NOPE'] })
  assert.equal(result.products.length, 0)
  assert.match(result.note || '', /No matching/)
  assert.ok(result.agent_hint)
})

test('inventoryAts aggregates loft / store / xfer ATS', async () => {
  const product = { id: 'p1', title: 'Serum', sku: 'SKU-1' }
  const locLoft = { id: 'l1', code: 'LOFT-SG', name: 'Loft', location_type: '3pl', is_active: true }
  const locStore = { id: 'l2', code: 'ST-MAIN', name: 'Main', location_type: 'store', is_active: true }
  const locXfer = {
    id: 'l3',
    code: 'XFER-LOFT-STORE',
    name: 'Xfer',
    location_type: 'in_transit',
    is_active: true,
  }

  const db = {
    from(table) {
      if (table === 'products') {
        const api = {
          select() {
            return api
          },
          eq() {
            return api
          },
          in() {
            return api
          },
          then(r) {
            return Promise.resolve({ data: [product], error: null }).then(r)
          },
        }
        return api
      }
      if (table === 'inventory_locations') {
        const api = {
          select() {
            return api
          },
          eq() {
            return api
          },
          in() {
            return api
          },
          then(r) {
            return Promise.resolve({ data: [locLoft, locStore, locXfer], error: null }).then(r)
          },
        }
        return api
      }
      if (table === 'inventory_levels') {
        const api = {
          select() {
            return api
          },
          eq() {
            return api
          },
          in() {
            return api
          },
          then(r) {
            return Promise.resolve({
              data: [
                {
                  product_id: 'p1',
                  location_id: 'l1',
                  on_hand: 20,
                  reserved: 5,
                  on_order: 0,
                  in_transit: 0,
                  updated_at: null,
                },
                {
                  product_id: 'p1',
                  location_id: 'l2',
                  on_hand: 4,
                  reserved: 0,
                  on_order: 0,
                  in_transit: 0,
                  updated_at: null,
                },
                {
                  product_id: 'p1',
                  location_id: 'l3',
                  on_hand: 2,
                  reserved: 0,
                  on_order: 0,
                  in_transit: 0,
                  updated_at: null,
                },
              ],
              error: null,
            }).then(r)
          },
        }
        return api
      }
      throw new Error(table)
    },
  }

  const result = await inventoryAts(db, { workspace_id: 'ws-1', skus: ['SKU-1'] })
  assert.equal(result.products.length, 1)
  const p = result.products[0]
  assert.equal(p.loft_ats, 15)
  assert.equal(p.store_ats, 4)
  assert.equal(p.in_transit_ats, 2)
  assert.equal(p.total_ats, 21)
  assert.equal(p.locations.length, 3)
})

test('productInventoryStatus not_found and ambiguous', async () => {
  const emptyDb = {
    from(table) {
      if (table !== 'products') throw new Error(table)
      const api = {
        select() {
          return api
        },
        eq() {
          return api
        },
        in() {
          return api
        },
        or() {
          return api
        },
        limit() {
          return api
        },
        then(r) {
          return Promise.resolve({ data: [], error: null }).then(r)
        },
      }
      return api
    },
  }
  const nf = await productInventoryStatus(emptyDb, { workspace_id: 'ws-1', q: 'zzz' })
  assert.equal(nf.found, false)
  assert.equal(nf.lifecycle.primary_status, 'not_found')

  const ambDb = {
    from(table) {
      if (table !== 'products') throw new Error(table)
      const api = {
        select() {
          return api
        },
        eq() {
          return api
        },
        in() {
          return api
        },
        or() {
          return api
        },
        limit() {
          return api
        },
        then(r) {
          return Promise.resolve({
            data: [
              { id: 'a', title: 'A', sku: 'A1' },
              { id: 'b', title: 'B', sku: 'B1' },
            ],
            error: null,
          }).then(r)
        },
      }
      return api
    },
  }
  const amb = await productInventoryStatus(ambDb, { workspace_id: 'ws-1', q: 'serum' })
  assert.equal(amb.found, false)
  assert.equal(amb.lifecycle.primary_status, 'ambiguous')
  assert.ok(amb.ambiguous?.length === 2)
})

test('productInventoryStatus returns path_summary with inbound + loft stock', async () => {
  const product = { id: 'p1', title: 'Serum', sku: 'SKU-1' }
  const locLoft = { id: 'l1', code: 'LOFT-SG', name: 'Loft', location_type: '3pl', is_active: true }

  const db = {
    from(table) {
      if (table === 'products') {
        return {
          select(cols) {
            // full product select uses maybeSingle
            const api = {
              eq() {
                return api
              },
              in() {
                return api
              },
              or() {
                return api
              },
              limit() {
                return api
              },
              maybeSingle() {
                return Promise.resolve({
                  data: {
                    ...product,
                    status: 'active',
                    retail_price: 10,
                    cost_price: 4,
                    currency: 'SGD',
                    stock_quantity: 0,
                    product_data: { pos_enabled: true },
                    brand: { name: 'Brand' },
                  },
                  error: null,
                })
              },
              then(r) {
                // resolveProducts path
                return Promise.resolve({ data: [product], error: null }).then(r)
              },
            }
            return api
          },
        }
      }
      if (table === 'inventory_locations') {
        const api = {
          select() {
            return api
          },
          eq() {
            return api
          },
          then(r) {
            return Promise.resolve({ data: [locLoft], error: null }).then(r)
          },
        }
        return api
      }
      if (table === 'inventory_levels') {
        const api = {
          select() {
            return api
          },
          eq() {
            return api
          },
          in() {
            return api
          },
          then(r) {
            return Promise.resolve({
              data: [
                {
                  product_id: 'p1',
                  location_id: 'l1',
                  on_hand: 8,
                  reserved: 0,
                  on_order: 0,
                  in_transit: 0,
                  updated_at: null,
                },
              ],
              error: null,
            }).then(r)
          },
        }
        return api
      }
      if (table === 'inbound_shipment_lines') {
        const api = {
          select() {
            return api
          },
          or() {
            return api
          },
          limit() {
            return api
          },
          then(r) {
            return Promise.resolve({
              data: [
                {
                  id: 'il1',
                  sku: 'SKU-1',
                  product_id: 'p1',
                  quantity: 40,
                  quantity_received: 0,
                  quantity_spoil: 0,
                  shipment_id: 's1',
                },
              ],
              error: null,
            }).then(r)
          },
        }
        return api
      }
      if (table === 'inbound_shipments') {
        const api = {
          select() {
            return api
          },
          eq() {
            return api
          },
          in() {
            return api
          },
          then(r) {
            return Promise.resolve({
              data: [
                {
                  id: 's1',
                  shipment_number: 'ASN-1',
                  status: 'in_transit',
                  tracking_number: 'T1',
                  date_estimate: null,
                  local_forwarder: 'LocalFwd',
                  offshore_forwarder: 'OffFwd',
                  external_status: null,
                  workspace_id: 'ws-1',
                },
              ],
              error: null,
            }).then(r)
          },
        }
        return api
      }
      if (
        table === 'store_replenishment_order_lines' ||
        table === 'store_replenishment_request_lines' ||
        table === 'inventory_adjustment_lines'
      ) {
        const api = {
          select() {
            return api
          },
          or() {
            return api
          },
          eq() {
            return api
          },
          limit() {
            return api
          },
          then(r) {
            return Promise.resolve({ data: [], error: null }).then(r)
          },
        }
        return api
      }
      throw new Error(`unexpected ${table}`)
    },
  }

  const status = await productInventoryStatus(db, { workspace_id: 'ws-1', sku: 'SKU-1' })
  assert.equal(status.found, true)
  assert.equal(status.inventory.loft_ats, 8)
  assert.equal(status.logistics.inbound_asn.length, 1)
  assert.ok(status.path_summary.some((p) => /forwarder/i.test(p) || /Loft/i.test(p)))
  assert.ok(status.path_summary.some((p) => /LOFT-SG|available at/i.test(p)))
  assert.ok(status.lifecycle.primary_status.includes('loft') || status.lifecycle.stages.length > 0)
  assert.equal(status.product.catalog_stock_quantity_field, 0)
  assert.ok(status.agent_hint)
})

test('resolveProducts by sku', async () => {
  const db = {
    from(table) {
      if (table !== 'products') throw new Error(table)
      const api = {
        select() {
          return api
        },
        eq() {
          return api
        },
        in() {
          return api
        },
        then(r) {
          return Promise.resolve({
            data: [{ id: '1', title: 'T', sku: 'S1' }],
            error: null,
          }).then(r)
        },
      }
      return api
    },
  }
  const products = await resolveProducts(db, 'ws', { skus: ['S1'] })
  assert.equal(products.length, 1)
  assert.equal(products[0].sku, 'S1')
})
