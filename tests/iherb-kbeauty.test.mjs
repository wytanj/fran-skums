/**
 * K-Beauty bids= helpers (no browser).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  decodeBidsParam,
  groupProductsByBrand,
  kBeautyBidsUrl,
  kBeautyPageUrl,
  parseKBeautyBrandFacet,
  parseResultCount,
  stampBrandKeysOnProducts,
} from '../marketplace/iherb/kBeauty.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('kBeautyBidsUrl encodes single and multi codes', () => {
  assert.equal(
    kBeautyBidsUrl('CRX'),
    'https://sg.iherb.com/c/k-beauty?bids=CRX',
  )
  const multi = kBeautyBidsUrl(['CRX', 'VCT'])
  assert.match(multi, /bids=CRX%2CVCT|bids=CRX%252CVCT/)
  // URLSearchParams single-encodes comma
  assert.ok(multi.includes('CRX') && multi.includes('VCT'))
  assert.equal(
    kBeautyBidsUrl('SIO', { page: 2 }),
    'https://sg.iherb.com/c/k-beauty?bids=SIO&p=2',
  )
})

test('kBeautyPageUrl re-applies bids when rel=next dropped them', () => {
  // Simulated broken next from iHerb
  const fixed = kBeautyPageUrl('https://sg.iherb.com/c/k-beauty?p=2', 2, 'CRX')
  assert.match(fixed, /bids=CRX/)
  assert.match(fixed, /p=2/)

  // Preserve from current URL
  const fromCur = kBeautyPageUrl('https://sg.iherb.com/c/k-beauty?bids=AUU&p=1', 2)
  assert.match(fromCur, /bids=AUU/)
  assert.match(fromCur, /p=2/)
})

test('decodeBidsParam handles double encoding like the user URL', () => {
  // CRX%252CVCT → after one decode CRX%2CVCT → CRX,VCT
  assert.deepEqual(decodeBidsParam('CRX%252CVCT'), ['CRX', 'VCT'])
  assert.deepEqual(decodeBidsParam('CRX%2CVCT'), ['CRX', 'VCT'])
  assert.deepEqual(decodeBidsParam('CRX,VCT'), ['CRX', 'VCT'])
  assert.deepEqual(decodeBidsParam('SIO'), ['SIO'])
})

test('parseResultCount', () => {
  assert.equal(parseResultCount('of 2,935 results'), 2935)
  assert.equal(parseResultCount('1 - 48 of 74 results'), 74)
  assert.equal(parseResultCount('nothing'), null)
})

test('parseKBeautyBrandFacet reads filter-item and lazy stubs', () => {
  const html = `
    <ul class="filter-list" data-filter-type="brands" data-filter-list-count="182">
      <li class="filter-item top-brand" data-keyword="CosRx" data-id="CRX">
        <div class="filter-name" data-count="74">
          <input type="checkbox" class="checkbox-filter" value="CRX" aria-label="CosRx">
          <label data-url="/c/k-beauty?bids=CRX" title="CosRx">CosRx</label>
        </div>
      </li>
      <li class="filter-item" data-keyword="Anua" data-id="AUU">
        <div class="filter-name" data-count="49">
          <input value="AUU" aria-label="Anua">
          <label data-url="/c/k-beauty?bids=AUU">Anua</label>
        </div>
      </li>
      <li class="lazy-load-filter-item" data-id="BOJ" data-selected="False"
          data-url="/c/k-beauty?bids=BOJ"></li>
      <li id="exclusive-brands-checkbox" class="filter-item">
        <input id="FilterExclusive7" value="7" aria-label="iHerb Brands">
      </li>
    </ul>
  `
  const brands = parseKBeautyBrandFacet(html)
  const by = Object.fromEntries(brands.map((b) => [b.code, b]))
  assert.equal(by.CRX.name, 'CosRx')
  assert.equal(by.CRX.count, 74)
  assert.match(by.CRX.url, /bids=CRX/)
  assert.equal(by.AUU.count, 49)
  assert.equal(by.BOJ.code, 'BOJ')
  assert.ok(by.BOJ.url.includes('BOJ'))
  assert.equal(by['7'], undefined)
  assert.equal(brands.length, 3)
})

test('stampBrandKeysOnProducts + groupProductsByBrand', () => {
  const products = stampBrandKeysOnProducts([
    { part_number: 'A', brand_id: 'CRX', brand_name: 'CosRx', price: 1 },
    { part_number: 'B', brand_id: 'CRX', brand_name: 'CosRx', price: 2 },
    { part_number: 'C', brand_id: 'VCT', brand_name: 'VT Cosmetics', price: 3 },
  ])
  assert.equal(products[0].brand_key, 'cosrx')
  assert.equal(products[2].brand_key, 'vt-cosmetics')
  const g = groupProductsByBrand(products)
  assert.equal(g.size, 2)
  assert.equal(g.get('CRX').products.length, 2)
  assert.equal(g.get('VCT').brand_key, 'vt-cosmetics')
})

test('CLI and worker surface k-beauty harvest', () => {
  const cli = readFileSync(join(root, 'scripts/iherb-kbeauty-cycle.mjs'), 'utf8')
  assert.match(cli, /discoverKBeautyBrands/)
  assert.match(cli, /harvestKBeautyByBids/)
  assert.match(cli, /--bids/)

  const worker = readFileSync(join(root, 'marketplace/iherb/harvestWorker.mjs'), 'utf8')
  assert.match(worker, /export async function discoverKBeautyBrands/)
  assert.match(worker, /export async function harvestKBeautyByBids/)
  assert.match(worker, /kBeautyPageUrl/)
})
