/**
 * M6 — catalog Q&A + assistant/MCP context unify
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  clampLimit,
  significantTokens,
  compactProduct,
  catalogSearch,
  catalogStats,
  catalogGet,
} from '../core/catalog/index.mjs'

const toolsMjs = readFileSync(new URL('../mcp/src/tools.mjs', import.meta.url), 'utf8')
const assistantTools = readFileSync(new URL('../server/utils/assistantTools.ts', import.meta.url), 'utf8')
const assistantPrompt = readFileSync(new URL('../server/utils/assistantPrompt.ts', import.meta.url), 'utf8')
const chatRoute = readFileSync(new URL('../server/api/assistant/chat.post.ts', import.meta.url), 'utf8')
const drawer = readFileSync(new URL('../app/components/AssistantDrawer.vue', import.meta.url), 'utf8')
const mcpReadme = readFileSync(new URL('../mcp/README.md', import.meta.url), 'utf8')
const studyMcp = readFileSync(new URL('../mcp/src/lib/study.mjs', import.meta.url), 'utf8')
const studyServer = readFileSync(new URL('../server/utils/marketplaceStudy.ts', import.meta.url), 'utf8')

describe('core/catalog helpers', () => {
  test('clampLimit and tokens', () => {
    assert.equal(clampLimit(100, 15, 25), 25)
    assert.equal(clampLimit(undefined, 15, 25), 15)
    const tokens = significantTokens('Anua Heartleaf official toner SG shopee')
    assert.ok(tokens.includes('anua') || tokens.includes('heartleaf'))
    assert.ok(!tokens.includes('shopee'))
  })

  test('compactProduct strips bulk', () => {
    const row = compactProduct({
      id: '1',
      title: 'T',
      sku: 'S',
      status: 'draft',
      brand: { name: 'B' },
      product_data: { pos_enabled: false, import_source: 'x.csv' },
      description: 'long',
    })
    assert.equal(row.brand, 'B')
    assert.equal(row.pos_enabled, false)
    assert.equal(row.import_source, 'x.csv')
    assert.equal(row.description, undefined)
  })
})

describe('catalog query with mock client', () => {
  function mockClient(handlers) {
    return {
      from(table) {
        const h = handlers[table] || handlers['*']
        if (!h) throw new Error(`unexpected table ${table}`)
        return h()
      },
    }
  }

  function chainable(result) {
    const api = {
      select() { return api },
      eq() { return api },
      in() { return api },
      ilike() { return api },
      or() { return api },
      is() { return api },
      not() { return api },
      order() { return api },
      range() { return api },
      limit() { return api },
      single() { return Promise.resolve(result) },
      then(resolve, reject) {
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return api
  }

  test('catalogSearch returns total + products', async () => {
    const db = mockClient({
      products: () =>
        chainable({
          data: [
            {
              id: 'p1',
              title: 'Serum',
              sku: 'SKU1',
              status: 'draft',
              brand: { name: 'Anua' },
              product_data: { pos_enabled: false },
            },
          ],
          count: 10432,
          error: null,
        }),
    })
    const res = await catalogSearch(db, { workspace_id: 'ws', q: 'Serum', limit: 10 })
    assert.equal(res.total, 10432)
    assert.equal(res.products.length, 1)
    assert.equal(res.products[0].title, 'Serum')
    assert.equal(res.has_more, true)
  })

  test('catalogStats aggregates status counts', async () => {
    let call = 0
    const counts = [10432, 10000, 400, 32, 12, 8000]
    const db = {
      from(table) {
        if (table === 'products') {
          return chainable({
            count: counts[Math.min(call++, counts.length - 1)],
            error: null,
            data: call > 6 ? [{ brand_id: 'b1' }, { brand_id: 'b1' }, { brand_id: 'b2' }] : null,
          })
        }
        if (table === 'brands') {
          return chainable({
            data: [
              { id: 'b1', name: 'Anua' },
              { id: 'b2', name: '3CE' },
            ],
            error: null,
          })
        }
        throw new Error(table)
      },
    }
    // Re-implement simpler: each countWhere awaits thenable with count
    const statsDb = {
      from(table) {
        if (table !== 'products' && table !== 'brands') throw new Error(table)
        let mode = 'count'
        const api = {
          select(_s, opts) {
            if (opts?.head) mode = 'count'
            else if (table === 'brands') mode = 'brands'
            else mode = 'brand_ids'
            return api
          },
          eq() { return api },
          in() { return api },
          is() { return api },
          not() { return api },
          ilike() { return api },
          limit() { return api },
          then(resolve, reject) {
            if (table === 'brands') {
              return Promise.resolve({
                data: [
                  { id: 'b1', name: 'Anua' },
                  { id: 'b2', name: '3CE' },
                ],
                error: null,
              }).then(resolve, reject)
            }
            if (mode === 'brand_ids') {
              return Promise.resolve({
                data: [
                  { brand_id: 'b1' },
                  { brand_id: 'b1' },
                  { brand_id: 'b2' },
                ],
                error: null,
              }).then(resolve, reject)
            }
            const c = counts[Math.min(call, counts.length - 1)]
            call++
            return Promise.resolve({ count: c, error: null }).then(resolve, reject)
          },
        }
        return api
      },
    }

    const stats = await catalogStats(statsDb, { workspace_id: 'ws' })
    assert.equal(stats.total, 10432)
    assert.equal(stats.by_status.draft, 10000)
    assert.equal(stats.by_status.active, 400)
    assert.ok(Array.isArray(stats.top_brands))
  })

  test('catalogGet requires identifier', async () => {
    await assert.rejects(
      () => catalogGet(mockClient({}), { workspace_id: 'ws' }),
      /Provide id/,
    )
  })
})

describe('wiring: assistant + MCP share catalog surface', () => {
  test('MCP tools register catalog_*', () => {
    assert.match(toolsMjs, /name: 'catalog_stats'/)
    assert.match(toolsMjs, /name: 'catalog_search'/)
    assert.match(toolsMjs, /name: 'catalog_get'/)
    assert.match(toolsMjs, /case 'catalog_stats'/)
    assert.match(toolsMjs, /catalog\.statsCatalog/)
  })

  test('assistant tools use shared catalog module', () => {
    assert.match(assistantTools, /get_catalog_stats/)
    assert.match(assistantTools, /from '\.\.\/\.\.\/core\/catalog\/index\.mjs'/)
    assert.match(assistantTools, /catalogStats/)
    assert.match(assistantTools, /catalogSearch/)
    assert.match(assistantTools, /get_actions_queue/)
  })

  test('prompt distinguishes assistant vs MCP and forbids inventing counts', () => {
    assert.match(assistantPrompt, /Two AI surfaces/)
    assert.match(assistantPrompt, /MCP agents/)
    assert.match(assistantPrompt, /NEVER invent product counts/)
    assert.match(assistantPrompt, /CATALOG SNAPSHOT/)
    assert.match(chatRoute, /catalogStats/)
  })

  test('drawer UX labels catalog assistant', () => {
    assert.match(drawer, /Catalog Assistant/)
    assert.match(drawer, /How many products are in this catalog/)
    assert.match(drawer, /MCP/)
  })

  test('study match uses fetchCatalogMatchPool', () => {
    assert.match(studyMcp, /fetchCatalogMatchPool/)
    assert.match(studyServer, /fetchCatalogMatchPool/)
  })

  test('mcp README documents catalog tools and dual surfaces', () => {
    assert.match(mcpReadme, /catalog_stats/)
    assert.match(mcpReadme, /In-app Assistant vs MCP/)
  })
})
