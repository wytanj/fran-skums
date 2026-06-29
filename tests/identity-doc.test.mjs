import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const doc = readFileSync(new URL('../docs/IDENTITY_SPINE.md', import.meta.url), 'utf8')

test('identity spine doc records SKU as contextual label', () => {
  assert.match(doc, /SKU is a context-scoped label, not canonical product identity/)
  assert.match(doc, /Do not assume one product equals one SKU/)
})

test('identity spine doc covers loose items and skincare retail examples', () => {
  assert.match(doc, /Keyboard Switches/)
  assert.match(doc, /Skincare Retail/)
  assert.match(doc, /skincare intelligence app/i)
})

test('identity spine doc lists compatibility API endpoints', () => {
  assert.match(doc, /GET \/api\/v1\/products\/:id\/identity/)
  assert.match(doc, /GET \/api\/v1\/products\/:id\/listings/)
  assert.match(doc, /GET \/api\/v1\/listings/)
})
