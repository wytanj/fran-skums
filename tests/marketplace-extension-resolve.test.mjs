import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../extensions/skums-shopee-shop-resolve/', import.meta.url)

test('chrome extension package present', () => {
  assert.ok(existsSync(new URL('manifest.json', root)))
  assert.ok(existsSync(new URL('popup.html', root)))
  assert.ok(existsSync(new URL('popup.js', root)))
  assert.ok(existsSync(new URL('content.js', root)))
  assert.ok(existsSync(new URL('README.md', root)))
})

test('manifest is MV3 with shopee + API host perms', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'))
  assert.equal(manifest.manifest_version, 3)
  assert.ok(manifest.host_permissions.some((h) => h.includes('shopee.sg')))
  assert.ok(manifest.content_scripts?.[0]?.js?.includes('content.js'))
})

test('content script scans for shop username', () => {
  const js = readFileSync(new URL('content.js', root), 'utf8')
  assert.match(js, /SKUMS_SCAN_PAGE/)
  assert.match(js, /parseShopUsername|shop_username/)
})

test('resolve-shop API route exists', () => {
  const route = readFileSync(
    new URL('../server/api/v1/marketplace/brand-universe/resolve-shop.post.ts', import.meta.url),
    'utf8',
  )
  assert.match(route, /intel:write/)
  assert.match(route, /resolveBrandShop/)
})

test('patchBrandUniverse accepts shop fields', () => {
  const util = readFileSync(
    new URL('../server/utils/marketplaceBrandUniverse.ts', import.meta.url),
    'utf8',
  )
  assert.match(util, /shop_username/)
  assert.match(util, /resolveBrandShop/)
})
