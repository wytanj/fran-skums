/**
 * iHerb harvest worker unit tests (no browser).
 * @see marketplace/iherb/harvestWorker.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseIherbCatalogue } from '../marketplace/iherb/parseCatalogue.mjs'
import {
  assertRunCurrency,
  coverageFromProducts,
  detectIherbHealth,
  iherbCatalogueUrl,
  mergeIherbProducts,
} from '../marketplace/iherb/harvestWorker.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = join(root, 'extensions/sample-iherb-anua.html')
const hasFixture = existsSync(FIXTURE)

test('iherbCatalogueUrl builds sg host path', () => {
  assert.equal(iherbCatalogueUrl('anua'), 'https://sg.iherb.com/c/anua')
  assert.equal(iherbCatalogueUrl('/Skin1004/'), 'https://sg.iherb.com/c/skin1004')
  assert.throws(() => iherbCatalogueUrl(''), /slug/)
})

test('detectIherbHealth: products ⇒ ok', () => {
  assert.equal(detectIherbHealth({ productCount: 12, url: 'https://sg.iherb.com/c/anua' }), 'ok')
})

test('detectIherbHealth: 403 / access denied ⇒ blocked', () => {
  assert.equal(detectIherbHealth({ status: 403, productCount: 0 }), 'blocked')
  assert.equal(detectIherbHealth({ status: 429, productCount: 0 }), 'blocked')
  assert.equal(
    detectIherbHealth({ title: 'Access Denied', bodyText: 'Request blocked', productCount: 0 }),
    'blocked',
  )
  assert.equal(
    detectIherbHealth({ bodyText: 'recaptcha enterprise verify you are human', productCount: 0 }),
    'blocked',
  )
})

test('detectIherbHealth: empty / unknown never returns ok', () => {
  assert.equal(detectIherbHealth({ productCount: 0, url: 'https://sg.iherb.com/c/anua' }), 'unknown')
  assert.equal(detectIherbHealth({ productCount: 0, title: 'Something weird' }), 'unknown')
  assert.equal(detectIherbHealth({}), 'unknown')
  // Critical: never invent ok without products
  assert.notEqual(detectIherbHealth({ url: 'https://example.com', productCount: 0 }), 'ok')
})

test('mergeIherbProducts dedupes by part_number', () => {
  const merged = mergeIherbProducts([
    [{ part_number: 'A-1', price: 1 }, { part_number: 'A-2', price: 2 }],
    [{ part_number: 'A-1', price: 1.5 }, { part_number: 'A-3', price: 3 }],
  ])
  assert.equal(merged.length, 3)
  assert.equal(merged.find((p) => p.part_number === 'A-1').price, 1.5)
})

test('coverageFromProducts reports sold partial + currency', () => {
  const c = coverageFromProducts([
    { currency: 'SGD', price: 1, sold_lower_bound: 10, sold_period: 'month' },
    { currency: 'SGD', price: 2 },
    { currency: 'SGD', price: 3, sold_lower_bound: 5, sold_period: 'month' },
  ])
  assert.equal(c.products, 3)
  assert.equal(c.with_sold, 2)
  assert.equal(c.with_price, 3)
  assert.deepEqual(c.currencies, ['SGD'])
  assert.equal(c.currency_consistent, true)
  assert.equal(c.sold_period, 'month')
})

test('assertRunCurrency refuses mixed or wrong currency', () => {
  assert.throws(
    () => assertRunCurrency({ currency_consistent: false, currencies: ['SGD', 'USD'] }),
    (e) => e.code === 'IHERB_CURRENCY_INCONSISTENT',
  )
  assert.throws(
    () => assertRunCurrency({ currency_consistent: true, currencies: ['USD'] }, { expectCurrency: 'SGD' }),
    (e) => e.code === 'IHERB_CURRENCY_MISMATCH',
  )
  assert.doesNotThrow(() =>
    assertRunCurrency({ currency_consistent: true, currencies: ['SGD'] }, { expectCurrency: 'SGD' }),
  )
})

test('fixture parse + merge shape is harvest-ready', { skip: !hasFixture }, () => {
  const html = readFileSync(FIXTURE, 'utf8')
  const page1 = parseIherbCatalogue(html, { url: 'https://sg.iherb.com/c/anua' })
  assert.equal(page1.coverage.products, 48)
  assertRunCurrency(page1.coverage, { expectCurrency: 'SGD' })

  // Simulate single-page brand (is_last would be false for Anua but we only have p1 fixture)
  const products = mergeIherbProducts([page1.products])
  const coverage = coverageFromProducts(products)
  assert.equal(coverage.products, 48)
  assert.ok(coverage.with_sold >= 30)
  assert.equal(coverage.currency_consistent, true)
  assert.equal(detectIherbHealth({ productCount: coverage.products, url: page1.url }), 'ok')
})

test('CLI script and worker export surface', () => {
  const cli = readFileSync(join(root, 'scripts/iherb-brand-cycle.mjs'), 'utf8')
  assert.match(cli, /harvestIherbBrand/)
  assert.match(cli, /connectComputerBrowser/)
  assert.match(cli, /createHarvestNotifier/)
  // Exit code 2 on consecutive sustained blocks (mall-brand-cycle pattern)
  assert.match(cli, /process\.exit\(2\)/)

  const worker = readFileSync(join(root, 'marketplace/iherb/harvestWorker.mjs'), 'utf8')
  assert.match(worker, /detectIherbHealth/)
  assert.match(worker, /upsertIherbCatalogue/)
  assert.match(worker, /waitForRecovery/)
  assert.match(worker, /sg\.iherb\.com/)
})
