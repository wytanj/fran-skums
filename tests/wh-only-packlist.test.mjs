import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('franWarehouse constants lock WH-MAIN', () => {
  const src = readFileSync(resolve(root, 'server/utils/franWarehouse.ts'), 'utf8')
  assert.match(src, /FRAN_WH_CODE = 'WH-MAIN'/)
  assert.match(src, /LOFT_SEND_DISABLED_MESSAGE/)
})

test('sendOrderToLoft and sendInboundToLoft are gated', () => {
  const repl = readFileSync(resolve(root, 'server/utils/storeReplenishment.ts'), 'utf8')
  const inb = readFileSync(resolve(root, 'server/utils/inboundShipment.ts'), 'utf8')
  assert.match(repl, /throw loftSendDisabledError\(\)/)
  assert.match(inb, /throw loftSendDisabledError\(\)/)
})

test('allocation preview sources WH-MAIN not LOFT-SG', () => {
  const cal = readFileSync(resolve(root, 'server/utils/storeDeliveryCalendar.ts'), 'utf8')
  assert.match(cal, /\.eq\('code', 'WH-MAIN'\)/)
  assert.doesNotMatch(cal, /\.eq\('code', 'LOFT-SG'\)/)
})

test('store-ops default source prefers warehouse WH-MAIN', () => {
  const vue = readFileSync(resolve(root, 'app/pages/store-ops/index.vue'), 'utf8')
  assert.match(vue, /location\.code === 'WH-MAIN'/)
  assert.match(vue, /location_type === 'warehouse'/)
})
