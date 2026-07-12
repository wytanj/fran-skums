import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { filterPoLinesForClone } from '../intelligence/po/service.mjs'

describe('PO clone filters (M2)', () => {
  const lines = [
    { title: 'Anua Heartleaf Toner', sku: 'ANUA-1', quantity: 2, unit_cost: 10 },
    { title: '3CE Blur Cover', sku: '3CE-1', quantity: 1, unit_cost: 20 },
    { title: 'COSRX Snail Mucin', sku: 'COS-1', quantity: 3, unit_cost: 15 },
    { title: 'Generic Cleanser', sku: 'GEN-1', quantity: 1, unit_cost: 5, metadata: { brand: 'Anua' } },
  ]

  test('exclude brands removes matching titles and metadata', () => {
    const r = filterPoLinesForClone(lines, { exclude_brands: ['anua', '3ce'] })
    assert.equal(r.dropped_count, 3)
    assert.equal(r.kept_count, 1)
    assert.equal(r.kept_lines[0].sku, 'COS-1')
    assert.ok(r.dropped_lines.some((l) => l.drop_reason?.startsWith('brand:')))
  })

  test('exclude skus', () => {
    const r = filterPoLinesForClone(lines, { exclude_skus: ['cos-1'] })
    assert.equal(r.dropped_count, 1)
    assert.equal(r.kept_count, 3)
  })

  test('exclude title tokens', () => {
    const r = filterPoLinesForClone(lines, { exclude_title_contains: ['toner'] })
    assert.equal(r.dropped_count, 1)
    assert.equal(r.dropped_lines[0].sku, 'ANUA-1')
  })
})
