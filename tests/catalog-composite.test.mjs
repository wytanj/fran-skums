/**
 * Catalog composite tools (MCP speed / sample-mcp-responses.md item 1)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  catalogHealth,
  catalogSample,
  catalogSearchSummary,
  compactProduct,
} from '../core/catalog/index.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tools = readFileSync(join(root, 'mcp/src/tools.mjs'), 'utf8')
const assistantTools = readFileSync(join(root, 'server/utils/assistantTools.ts'), 'utf8')
const todo = readFileSync(join(root, 'TODO.md'), 'utf8')

function mockDb(handlers) {
  return {
    from(table) {
      const h = handlers[table] || handlers['*']
      if (!h) throw new Error(`unexpected table ${table}`)
      return h()
    },
  }
}

function chain(result) {
  const api = {
    select() { return api },
    eq() { return api },
    is() { return api },
    not() { return api },
    in() { return api },
    ilike() { return api },
    or() { return api },
    order() { return api },
    range() { return api },
    limit() { return api },
    then(resolve) { return Promise.resolve(result).then(resolve) },
  }
  // Make thenable for await query
  api[Symbol.toStringTag] = 'Promise'
  return Object.assign(Promise.resolve(result), api)
}

test('TODO lists MCP composite build order starting with catalog_health', () => {
  assert.match(todo, /catalog_health/)
  assert.match(todo, /catalog_sample/)
  assert.match(todo, /catalog_search_summary/)
  assert.match(todo, /inventory_ats/)
  assert.match(todo, /sample-mcp-responses/)
})

test('MCP and assistant register composite catalog tools', () => {
  assert.match(tools, /name: 'catalog_health'/)
  assert.match(tools, /name: 'catalog_sample'/)
  assert.match(tools, /name: 'catalog_search_summary'/)
  assert.match(tools, /case 'catalog_health'/)
  assert.match(assistantTools, /get_catalog_health/)
  assert.match(assistantTools, /sample_products/)
  assert.match(assistantTools, /search_products_summary/)
})

test('compactProduct exposes pos_enabled and import_source', () => {
  const c = compactProduct({
    id: '1',
    title: 'T',
    status: 'active',
    product_data: { pos_enabled: false, import_source: 'redacted-product-list.csv' },
  })
  assert.equal(c.pos_enabled, false)
  assert.equal(c.import_source, 'redacted-product-list.csv')
})

test('catalogHealth returns mode guess and agent_hint on empty catalog', async () => {
  let headCalls = 0
  const db = {
    from(table) {
      if (table === 'products') {
        return {
          select(_cols, opts) {
            if (opts?.head) {
              headCalls += 1
              return {
                eq() { return this },
                is() { return this },
                not() { return this },
                in() { return this },
                then(r) { return Promise.resolve({ count: 0, error: null }).then(r) },
              }
            }
            // brand facet + sample
            const api = {
              eq() { return api },
              not() { return api },
              in() { return api },
              order() { return api },
              limit() { return api },
              then(r) { return Promise.resolve({ data: [], error: null }).then(r) },
            }
            return api
          },
        }
      }
      throw new Error(table)
    },
  }
  const health = await catalogHealth(db, { workspace_id: 'ws-1' })
  assert.equal(health.total, 0)
  assert.equal(health.catalog_mode_guess, 'empty')
  assert.ok(health.agent_hint)
  assert.ok(headCalls >= 1)
})

test('catalogSample returns empty note when no matches', async () => {
  const db = {
    from(table) {
      if (table !== 'products') throw new Error(table)
      const api = {
        select() { return api },
        eq() { return api },
        order() { return api },
        range() { return api },
        ilike() { return api },
        or() { return api },
        in() { return api },
        then(r) {
          return Promise.resolve({ data: [], count: 0, error: null }).then(r)
        },
      }
      return api
    },
  }
  const sample = await catalogSample(db, { workspace_id: 'ws-1', n: 5, q: 'zzz-nope' })
  assert.equal(sample.total, 0)
  assert.equal(sample.products.length, 0)
  assert.match(sample.note || '', /No products/)
})

test('catalogSearchSummary shape for empty query match', async () => {
  const db = {
    from(table) {
      if (table !== 'products') throw new Error(table)
      const api = {
        select() { return api },
        eq() { return api },
        order() { return api },
        range() { return api },
        or() { return api },
        ilike() { return api },
        in() { return api },
        then(r) {
          return Promise.resolve({ data: [], count: 0, error: null }).then(r)
        },
      }
      return api
    },
  }
  const summary = await catalogSearchSummary(db, { workspace_id: 'ws-1', q: 'lipstick' })
  assert.equal(summary.total_matching, 0)
  assert.ok(summary.facets)
  assert.ok(summary.agent_hint)
})
