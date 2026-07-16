import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  SCOPE_PACKAGES,
  POS_FORBIDDEN_SCOPES,
  expandScopePackage,
  hasScope,
  permissionsMapToScopes,
  assertNoForbiddenScopes,
} from '../server/utils/scopes.ts'

describe('Loft / Phase P scopes', () => {
  test('pos_connector package has no HQ forbidden scopes', () => {
    const granted = expandScopePackage('pos_connector')
    assert.ok(granted.includes('pos:write'))
    assert.ok(granted.includes('store_ops:write'))
    assert.deepEqual(assertNoForbiddenScopes(granted), [])
    for (const bad of POS_FORBIDDEN_SCOPES) {
      assert.equal(hasScope(granted, bad, { emptyMeansFull: false }), false)
    }
  })

  test('worldsyntech_ofs package includes execute_3pl and inbound', () => {
    const granted = expandScopePackage('worldsyntech_ofs')
    assert.ok(granted.includes('store_ops:execute_3pl'))
    assert.ok(granted.includes('store_ops:inbound'))
    assert.ok(granted.includes('integrations:execute'))
  })

  test('empty scopes deny by default; emptyMeansFull true restores legacy', () => {
    assert.equal(hasScope([], 'pos:write'), false)
    assert.equal(hasScope([], 'pos:write', { emptyMeansFull: true }), true)
  })

  test('permissionsMapToScopes maps store_ops approve/verify', () => {
    const scopes = permissionsMapToScopes({
      store_ops: { read: true, write: true, approve: true, verify: true, execute_3pl: false },
      inventory: { read: true, write: true, override_expiry: true },
    })
    assert.ok(scopes.has('store_ops:approve'))
    assert.ok(scopes.has('store_ops:verify'))
    assert.equal(scopes.has('store_ops:execute_3pl'), false)
    assert.ok(scopes.has('inventory:override_expiry'))
  })

  test('inventory_ops package can approve but not execute_3pl', () => {
    const granted = SCOPE_PACKAGES.inventory_ops
    assert.ok(hasScope(granted, 'store_ops:approve', { emptyMeansFull: false }))
    assert.ok(hasScope(granted, 'store_ops:verify', { emptyMeansFull: false }))
    assert.equal(hasScope(granted, 'store_ops:execute_3pl', { emptyMeansFull: false }), false)
  })

  test('migration 055 and routes exist', () => {
    const mig = readFileSync(new URL('../core/db/055_loft_permissions_topology.sql', import.meta.url), 'utf8')
    assert.match(mig, /LOFT-SG/)
    assert.match(mig, /store_associate/)
    assert.match(mig, /inventory_ops/)
    assert.match(mig, /pos_connector/)
    assert.match(mig, /pull_products/)
    assert.match(mig, /granted_scopes/)

    const pull = readFileSync(
      new URL('../server/api/integrations/worldsyntech-ofs/pull-products.post.ts', import.meta.url),
      'utf8',
    )
    assert.match(pull, /pull_products/)
    assert.match(pull, /entity_type: 'product'/)

    const catalog = readFileSync(new URL('../server/api/v1/pos/catalog.get.ts', import.meta.url), 'utf8')
    assert.match(catalog, /pos_location_code/)
    assert.match(catalog, /inventory_levels/)

    const dict = readFileSync(new URL('../docs/LOFT_OPS_DICTIONARY.md', import.meta.url), 'utf8')
    assert.match(dict, /Monday/)
    assert.match(dict, /Thursday/)
  })
})
