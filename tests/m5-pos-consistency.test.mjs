/**
 * M5 — import / catalog / POS consistency
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  normalizeProductFromRow,
  reverseColumnMap,
  parseDelimitedText,
  proposeColumnMapping,
} from '../core/import/index.mjs'
import { buildCatalogProductPayload } from '../intelligence/pipeline/execute.mjs'

const sample = readFileSync(new URL('./fixtures/abw-sample.csv', import.meta.url), 'utf8')
const catalogRoute = readFileSync(new URL('../server/api/v1/pos/catalog.get.ts', import.meta.url), 'utf8')
const useProducts = readFileSync(new URL('../app/composables/useProducts.ts', import.meta.url), 'utf8')
const productPage = readFileSync(new URL('../app/pages/products/[id].vue', import.meta.url), 'utf8')
const importComposable = readFileSync(new URL('../app/composables/useCatalogImport.ts', import.meta.url), 'utf8')
const mcpPipeline = readFileSync(new URL('../mcp/src/lib/pipeline.mjs', import.meta.url), 'utf8')
const serverPipeline = readFileSync(new URL('../server/utils/marketplacePipeline.ts', import.meta.url), 'utf8')

describe('M5 import defaults', () => {
  test('normalize defaults draft + pos off', () => {
    const parsed = parseDelimitedText(sample)
    const proposal = proposeColumnMapping(parsed.headers, { providerHint: parsed.providerHint })
    const reverse = reverseColumnMap(proposal.mapping)
    const n = normalizeProductFromRow(parsed.rows[0], 0, reverse, {
      workspace_id: 'ws-1',
      file_name: 'dump.csv',
    })
    assert.equal(n.product.status, 'draft')
    assert.equal(n.product.product_data.pos_enabled, false)
  })

  test('useCatalogImport commits draft defaults', () => {
    assert.match(importComposable, /defaultStatus = 'draft'/)
    assert.match(importComposable, /defaultPos = options\?\.defaultPosEnabled === true/)
    assert.match(importComposable, /default_status: defaultStatus/)
  })
})

describe('M5 pipeline catalog_product', () => {
  test('payload builder ignores active/POS-on in candidate payload', () => {
    const row = buildCatalogProductPayload({
      id: 'x',
      title: 'Test',
      payload: {
        status: 'active',
        product_data: { pos_enabled: true, sellable_in_pos: true, note: 'keep' },
      },
    })
    assert.equal(row.status, 'draft')
    assert.equal(row.product_data.pos_enabled, false)
    assert.equal(row.product_data.sellable_in_pos, false)
    assert.equal(row.product_data.note, 'keep')
  })

  test('MCP and server execute force draft insert', () => {
    assert.match(mcpPipeline, /status: 'draft'/)
    assert.match(mcpPipeline, /pos_enabled: false/)
    assert.match(serverPipeline, /status: 'draft'/)
    assert.match(serverPipeline, /pos_enabled: false/)
  })
})

describe('M5 POS catalog + activate UI', () => {
  test('catalog filters drafts and non-pos_enabled', () => {
    assert.match(catalogRoute, /\.eq\('status',\s*'active'\)/)
    assert.match(catalogRoute, /item\.status === 'draft'/)
    assert.match(catalogRoute, /includeDisabled \|\| item\.pos_enabled/)
  })

  test('product page exposes Activate for POS', () => {
    assert.match(useProducts, /async function activateForPos/)
    assert.match(useProducts, /pos_enabled: true/)
    assert.match(useProducts, /sellable_in_pos: true/)
    assert.match(productPage, /Activate for POS/)
    assert.match(productPage, /handleActivateForPos/)
    assert.match(productPage, /needsPosActivation/)
  })
})
