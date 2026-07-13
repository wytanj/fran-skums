import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseDelimitedText,
  proposeColumnMapping,
  normalizeProductFromRow,
  reverseColumnMap,
  LARGE_IMPORT_ROW_THRESHOLD,
  buildJobProgress,
} from '../core/import/index.mjs'

const sample = readFileSync(new URL('./fixtures/abw-sample.csv', import.meta.url), 'utf8')

describe('import pipeline parse', () => {
  test('detects ABW dirty header and product rows', () => {
    const result = parseDelimitedText(sample)
    assert.equal(result.providerHint, 'abw')
    assert.ok(result.rows.length >= 4)
    assert.equal(result.rows[0]['Catalog No.'], '1135354896')
    assert.equal(result.rows[0].Brand, '&ONE')
    assert.equal(result.rows[0]['Product Name'], 'Lamella Hair Essence')
    assert.equal(result.rows[0]['ABW Selling Price (USD)'], '11.43')
  })

  test('generic single-header CSV still works', () => {
    const csv = 'title,brand,sku\nFoo,Bar,SKU1\n'
    const result = parseDelimitedText(csv)
    assert.equal(result.providerHint, 'generic')
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0].title, 'Foo')
  })
})

describe('import pipeline map + normalize', () => {
  test('proposes mapping for ABW headers including cost and supplier item', () => {
    const { headers, providerHint } = parseDelimitedText(sample)
    const proposal = proposeColumnMapping(headers, { providerHint })
    assert.equal(proposal.has_title, true)
    assert.ok(Object.values(proposal.mapping).includes('title'))
    assert.ok(Object.values(proposal.mapping).includes('supplier_item'))
    assert.ok(Object.values(proposal.mapping).includes('_brand'))
    assert.ok(Object.values(proposal.mapping).includes('cost_price'))
  })

  test('normalize builds product with cost_price and supplier key', () => {
    const parsed = parseDelimitedText(sample)
    const proposal = proposeColumnMapping(parsed.headers, { providerHint: parsed.providerHint })
    const reverse = reverseColumnMap(proposal.mapping)
    const n = normalizeProductFromRow(parsed.rows[0], 0, reverse, {
      workspace_id: 'ws-1',
      file_name: 'abw-sample.csv',
      provider_hint: 'abw',
      default_pos_enabled: false,
      supplier_source: 'ABW',
    })
    assert.match(n.product.title, /Lamella Hair Essence/)
    assert.equal(n.product.cost_price, 11.43)
    assert.equal(n.product.status, 'draft')
    assert.equal(n.product.product_data.pos_enabled, false)
    assert.equal(n.product.product_data.supplier.item_id, '1135354896')
    assert.equal(n.match_key, 'supplier:ABW:1135354896')
    assert.ok(n.identifiers.some((i) => i.identifier_type === 'ean' || i.identifier_type === 'upc'))
  })

  test('M5: defaults are draft + POS-off when opts omit status/pos', () => {
    const parsed = parseDelimitedText(sample)
    const proposal = proposeColumnMapping(parsed.headers, { providerHint: parsed.providerHint })
    const reverse = reverseColumnMap(proposal.mapping)
    const n = normalizeProductFromRow(parsed.rows[0], 0, reverse, {
      workspace_id: 'ws-1',
      provider_hint: 'abw',
      supplier_source: 'ABW',
    })
    assert.equal(n.product.status, 'draft')
    assert.equal(n.product.product_data.pos_enabled, false)
    assert.equal(n.product.product_data.sellable_in_pos, false)
  })

  test('M5: default_pos_enabled only true when explicitly true', () => {
    const parsed = parseDelimitedText(sample)
    const proposal = proposeColumnMapping(parsed.headers, { providerHint: parsed.providerHint })
    const reverse = reverseColumnMap(proposal.mapping)
    const n = normalizeProductFromRow(parsed.rows[0], 0, reverse, {
      workspace_id: 'ws-1',
      default_pos_enabled: true,
      default_status: 'active',
    })
    assert.equal(n.product.status, 'active')
    assert.equal(n.product.product_data.pos_enabled, true)
  })

  test('box tiers captured when present', () => {
    const parsed = parseDelimitedText(sample)
    const proposal = proposeColumnMapping(parsed.headers, { providerHint: 'abw' })
    const reverse = reverseColumnMap(proposal.mapping)
    const row = parsed.rows.find((r) => r['Product Name']?.includes('Dual Cheek'))
    assert.ok(row)
    const n = normalizeProductFromRow(row, 0, reverse, {
      workspace_id: 'ws-1',
      provider_hint: 'abw',
      default_pos_enabled: false,
    })
    assert.ok(Array.isArray(n.product.product_data.wholesale?.tiers))
    assert.ok(n.product.product_data.wholesale.tiers.length >= 1)
  })
})

describe('import job helpers', () => {
  test('large threshold and progress payload', () => {
    assert.equal(LARGE_IMPORT_ROW_THRESHOLD, 2000)
    const p = buildJobProgress({ phase: 'Committing', current: 10, total: 100, success: 9 })
    assert.equal(p.phase, 'Committing')
    assert.ok(p.updated_at)
  })
})
