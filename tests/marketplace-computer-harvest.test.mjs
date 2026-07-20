import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  computerBrowserLaunchOptions,
  withComputerDefaults,
} from '../marketplace/computerHarvest.mjs'

test('withComputerDefaults enables computer + slower pacing', () => {
  const d = withComputerDefaults({ workspace_id: 'x', max_pages: 2 })
  assert.equal(d.computer, true)
  assert.equal(d.interactive, true)
  assert.equal(d.delay_ms, 8000)
  assert.equal(d.shelf_delay_ms, 10000)
  assert.equal(d.step, false)
  assert.ok(d.captchaWaitMs >= 600000)
})

test('withComputerDefaults preserves explicit delays and step', () => {
  const d = withComputerDefaults({
    delay_ms: 3000,
    shelf_delay_ms: 4000,
    step: true,
  })
  assert.equal(d.delay_ms, 3000)
  assert.equal(d.shelf_delay_ms, 4000)
  assert.equal(d.step, true)
  assert.equal(d.computer, true)
})

test('computerBrowserLaunchOptions is always headed + warm profile', () => {
  const launch = computerBrowserLaunchOptions({ profileDir: 'C:\\tmp\\profile' })
  assert.equal(launch.headless, false)
  assert.equal(launch.userDataDir, 'C:\\tmp\\profile')
  assert.equal(launch.defaultViewport, null)
  assert.ok(launch.args.some((a) => a.includes('AutomationControlled')))
  assert.ok(launch.args.includes('--start-maximized'))
})

test('CLI wires --computer and --step', () => {
  const script = readFileSync(
    new URL('../scripts/mall-all-products-harvest.mjs', import.meta.url),
    'utf8',
  )
  assert.match(script, /--computer/)
  assert.match(script, /--step/)
  assert.match(script, /computerBrowserLaunchOptions/)
  assert.match(script, /withComputerDefaults/)
  assert.match(script, /runtime: opts\.computer \? 'computer' : 'script'/)
})

test('mallHarvestWorker routes computer to openAndHarvestPageComputer', () => {
  const worker = readFileSync(
    new URL('../marketplace/mallHarvestWorker.mjs', import.meta.url),
    'utf8',
  )
  assert.match(worker, /openAndHarvestPageComputer/)
  assert.match(worker, /opts\.computer/)
  assert.match(worker, /harvestEvaluate:\s*browserHarvestEvaluate/)
})

test('computerHarvest module is self-contained (no top-level mallHarvestWorker import)', () => {
  const src = readFileSync(
    new URL('../marketplace/computerHarvest.mjs', import.meta.url),
    'utf8',
  )
  // Avoid static circular import; dynamic import inside function is OK
  assert.ok(!/^import .+ from '\.\/mallHarvestWorker\.mjs'/m.test(src))
  assert.match(src, /humanMouseMove|page\.mouse/)
  assert.match(src, /page\.mouse\.wheel|mouse\.wheel/)
  assert.match(src, /waitForEnter/)
})
