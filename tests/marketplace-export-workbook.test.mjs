import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allocateSheetNames,
  sheetNameForBrand,
} from '../marketplace/exportBrandWorkbook.mjs'

test('sheetNameForBrand sanitizes Excel-illegal characters and length', () => {
  assert.equal(sheetNameForBrand('beauty-of-joseon'), 'beauty-of-joseon')
  assert.ok(!sheetNameForBrand('a/b\\c?d*e[f]g:h').match(/[\\/?*[\]:]/))
  assert.ok(sheetNameForBrand('x'.repeat(50)).length <= 31)
})

test('allocateSheetNames avoids collisions after truncation', () => {
  const keys = ['brand-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'brand-aaaaaaaaaaaaaaaaaaaaaaaaaaab']
  const map = allocateSheetNames(keys)
  const names = [...map.values()]
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length)
  assert.ok(names.every((n) => n.length <= 31))
  assert.ok(!names.includes('_index'))
})
