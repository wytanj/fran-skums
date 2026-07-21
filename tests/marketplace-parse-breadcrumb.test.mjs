import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  parseBreadcrumbList,
  parsePdpHtml,
  parsePlatformCategoryIdsFromUrl,
  extractJsonLdBlocks,
} from '../marketplace/parseBreadcrumb.mjs'
import { buildPdpEnrichStamps } from '../marketplace/pdpEnrich.mjs'

test('parsePlatformCategoryIdsFromUrl', () => {
  const ids = parsePlatformCategoryIdsFromUrl(
    'https://shopee.sg/Eye-Care-cat.11012301.11012427.11012431',
  )
  assert.deepEqual(ids, ['11012301', '11012427', '11012431'])
})

test('parseBreadcrumbList from BOJ eye serum sample HTML', () => {
  const p = resolve('extensions/sample-serum-joseon.html')
  if (!existsSync(p)) {
    console.log('skip — sample missing')
    return
  }
  const html = readFileSync(p, 'utf8')
  const blocks = extractJsonLdBlocks(html)
  assert.ok(blocks.some((b) => b['@type'] === 'BreadcrumbList'))
  assert.ok(blocks.some((b) => b['@type'] === 'Product'))

  const parsed = parsePdpHtml(html)
  assert.equal(parsed.breadcrumb.ok, true)
  assert.ok(parsed.breadcrumb.platform_category_path.includes('Skincare'))
  assert.ok(parsed.breadcrumb.platform_category_path.includes('Eye Care'))
  assert.equal(parsed.breadcrumb.platform_category_leaf, 'Eye Care')
  assert.ok(parsed.breadcrumb.platform_category_ids.includes('11012431'))
  assert.match(parsed.breadcrumb.platform_category_path_text, /Skincare.*Eye Care/)

  // Product rich fields present in sample
  assert.equal(parsed.product.ok, true)
  assert.ok(parsed.product.rating == null || parsed.product.rating > 0)
})

test('buildPdpEnrichStamps merges signals', () => {
  const bc = parseBreadcrumbList({
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        item: { '@id': 'https://shopee.sg/', name: 'Shopee' },
      },
      {
        '@type': 'ListItem',
        position: 2,
        item: {
          '@id': 'https://shopee.sg/Beauty-Personal-Care-cat.11012301',
          name: 'Beauty & Personal Care',
        },
      },
      {
        '@type': 'ListItem',
        position: 3,
        item: {
          '@id': 'https://shopee.sg/Skincare-cat.11012301.11012427',
          name: 'Skincare',
        },
      },
    ],
  })
  const stamps = buildPdpEnrichStamps(bc, { ok: true, price: 12.9, currency: 'SGD', rating: 4.9 }, {
    brand_key: 'beauty-of-joseon',
  })
  assert.equal(stamps.signals.brand_key, 'beauty-of-joseon')
  assert.ok(stamps.signals.platform_category_path.includes('Skincare'))
  assert.equal(stamps.price, 12.9)
  assert.equal(stamps.rating, 4.9)
})
