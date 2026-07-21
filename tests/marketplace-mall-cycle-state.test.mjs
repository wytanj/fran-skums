import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  loadCycleState,
  patchBrandState,
  saveCycleState,
} from '../marketplace/mallCycleState.mjs'
import { readFileSync as read } from 'node:fs'

test('cycle state round-trip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mall-cycle-'))
  const path = join(dir, 'state.json')
  try {
    let state = loadCycleState(path)
    assert.equal(Object.keys(state.brands).length, 0)
    state.workspace_id = 'ws-1'
    patchBrandState(state, 'biodance', { list_ok: true, list_products: 51 })
    saveCycleState(path, state)
    const again = loadCycleState(path)
    assert.equal(again.workspace_id, 'ws-1')
    assert.equal(again.brands.biodance.list_ok, true)
    assert.equal(again.brands.biodance.list_products, 51)
    assert.ok(again.updated_at)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI mall-brand-cycle exists and documents connect', () => {
  const script = read(new URL('../scripts/mall-brand-cycle.mjs', import.meta.url), 'utf8')
  assert.match(script, /mall-brand-cycle/)
  assert.match(script, /--connect/)
  assert.match(script, /--skip-done/)
  assert.match(script, /loadPdpEnrichCandidates/)
  assert.match(script, /harvestBrand/)
})
