/**
 * catalog_export_csv + catalog_data_ops (MCP composites #5–6)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  catalogDataOps,
  catalogExportCsv,
  escapeCsvCell,
  rowsToCsv,
} from '../core/catalog/index.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tools = readFileSync(join(root, 'mcp/src/tools.mjs'), 'utf8')
const assistantTools = readFileSync(join(root, 'server/utils/assistantTools.ts'), 'utf8')
const assistantPrompt = readFileSync(join(root, 'server/utils/assistantPrompt.ts'), 'utf8')
const todo = readFileSync(join(root, 'TODO.md'), 'utf8')
const instructions = readFileSync(join(root, 'mcp/src/agentInstructions.mjs'), 'utf8')

test('MCP and assistant register export + data_ops tools', () => {
  assert.match(tools, /name: 'catalog_export_csv'/)
  assert.match(tools, /name: 'catalog_data_ops'/)
  assert.match(tools, /case 'catalog_export_csv'/)
  assert.match(tools, /case 'catalog_data_ops'/)
  assert.match(assistantTools, /export_catalog_csv/)
  assert.match(assistantTools, /get_catalog_data_ops/)
  assert.match(assistantPrompt, /export_catalog_csv/)
  assert.match(assistantPrompt, /get_catalog_data_ops/)
  assert.match(instructions, /catalog_export_csv/)
  assert.match(instructions, /catalog_data_ops/)
  assert.match(todo, /catalog_export_csv.*✅|export.*✅/)
  assert.match(todo, /catalog_data_ops/)
})

test('escapeCsvCell and rowsToCsv quote commas and quotes', () => {
  assert.equal(escapeCsvCell('a,b'), '"a,b"')
  assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""')
  assert.equal(escapeCsvCell(null), '')
  const csv = rowsToCsv(['title', 'sku'], [{ title: 'A, B', sku: 'S1' }])
  assert.match(csv, /^title,sku\n/)
  assert.match(csv, /"A, B",S1/)
})

test('catalogExportCsv returns bounded csv and respects empty brand', async () => {
  const db = {
    from(table) {
      if (table === 'brands') {
        const api = {
          select() {
            return api
          },
          eq() {
            return api
          },
          ilike() {
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
      throw new Error(table)
    },
  }
  const empty = await catalogExportCsv(db, {
    workspace_id: 'ws-1',
    brand: 'NopeBrand',
    limit: 10,
  })
  assert.equal(empty.row_count, 0)
  assert.equal(empty.total_matching, 0)
  assert.match(empty.csv, /title,sku|id,title/)
  assert.ok(empty.agent_hint)
})

test('catalogExportCsv maps product rows to csv', async () => {
  const product = {
    id: 'p1',
    title: 'Lip, matte',
    sku: 'L1',
    ean: '123',
    upc: null,
    gtin: null,
    status: 'active',
    retail_price: null,
    cost_price: 1.3,
    currency: 'USD',
    product_data: { pos_enabled: false, import_source: 'redacted-product-list.csv' },
    brand: { name: 'MAFFICK' },
    category: { name: null },
  }
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
        order() {
          return api
        },
        range() {
          return api
        },
        or() {
          return api
        },
        then(r) {
          return Promise.resolve({ data: [product], count: 141, error: null }).then(r)
        },
      }
      return api
    },
  }
  const exp = await catalogExportCsv(db, {
    workspace_id: 'ws-1',
    q: 'lipstick',
    limit: 50,
  })
  assert.equal(exp.row_count, 1)
  assert.equal(exp.total_matching, 141)
  assert.equal(exp.truncated, true)
  assert.match(exp.csv, /"Lip, matte"/)
  assert.match(exp.csv, /L1/)
  assert.match(exp.csv, /MAFFICK/)
  assert.match(exp.csv, /false/)
  assert.ok(exp.limit <= 200)
})

function chainable(result) {
  const api = {
    select() {
      return api
    },
    eq() {
      return api
    },
    is() {
      return api
    },
    not() {
      return api
    },
    in() {
      return api
    },
    ilike() {
      return api
    },
    order() {
      return api
    },
    range() {
      return api
    },
    or() {
      return api
    },
    limit() {
      return api
    },
    then(r) {
      return Promise.resolve(result).then(r)
    },
  }
  return api
}

test('catalogDataOps returns intentional_read and seed suggestions', async () => {
  const productRow = {
    id: '1',
    title: 'Serum A',
    sku: 'S1',
    status: 'active',
    retail_price: null,
    cost_price: 10,
    currency: 'USD',
    stock_quantity: 0,
    product_data: { pos_enabled: false, import_source: 'x.csv' },
    brand: { id: 'b1', name: 'BrandX' },
    brand_id: 'b1',
    category: null,
    updated_at: '2026-07-01',
  }

  const db = {
    from(table) {
      if (table === 'marketplace_crawl_seeds') {
        return chainable({ data: [], error: null })
      }
      if (table === 'brands') {
        return chainable({ data: [{ id: 'b1', name: 'BrandX' }], error: null })
      }
      // products: head counts + row samples
      return {
        select(_cols, opts) {
          if (opts?.head || opts?.count === 'exact') {
            return chainable({ count: 100, data: null, error: null })
          }
          return chainable({ data: [productRow], count: 100, error: null })
        },
      }
    },
  }

  const ops = await catalogDataOps(db, { workspace_id: 'ws-1', seed_suggestions: 3 })
  assert.ok(ops.intentional_read)
  assert.ok(ops.recommended_actions?.length)
  assert.ok(ops.market_seeds)
  assert.equal(ops.market_seeds.existing_count, 0)
  assert.match(ops.market_seeds.write_policy, /read-only|pipeline_propose/i)
  assert.ok(ops.agent_hint)
})
