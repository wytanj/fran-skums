import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  computerBrowserLaunchOptions,
  humanPreNavPause,
  jitterMs,
  waitForRecovery,
  withComputerDefaults,
} from '../marketplace/computerHarvest.mjs'
import { createHarvestNotifier, nullNotifier } from '../marketplace/harvestNotify.mjs'

/** Probe that reports `blocked` N times, then a healthy grid. */
function probeBlockedThenOk(blockedTimes, productCount = 30) {
  let calls = 0
  return async () => {
    calls++
    if (calls <= blockedTimes) return { health: 'blocked', productCount: 0 }
    return { health: 'ok', productCount, harvest: { product_count: productCount } }
  }
}

const noSleep = async () => {}

test('withComputerDefaults enables computer + slower pacing', () => {
  const d = withComputerDefaults({ workspace_id: 'x', max_pages: 2 })
  assert.equal(d.computer, true)
  assert.equal(d.interactive, true)
  assert.equal(d.delay_ms, 11000)
  assert.equal(d.shelf_delay_ms, 14000)
  assert.equal(d.preNavMinMs, 5000)
  assert.equal(d.preNavMaxMs, 15000)
  assert.equal(d.forcePreNavEveryPage, false) // long settle on first nav only
  assert.equal(d.step, false)
  assert.equal(d.pauseAfterLoad, false) // captcha-only default
  assert.ok(d.captchaWaitMs >= 600000)
})

test('withComputerDefaults can enable pauseAfterLoad babysit', () => {
  const d = withComputerDefaults({ pauseAfterLoad: true })
  assert.equal(d.pauseAfterLoad, true)
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

// ——— MH-9: recovery polling (this is what makes the cycle schedulable) ———

test('MH-9: waitForRecovery returns when the page recovers, without any keypress', async () => {
  const r = await waitForRecovery({
    probe: probeBlockedThenOk(2),
    deadlineMs: 60000,
    pollMs: 1,
    sleepFn: noSleep,
    label: 'test',
  })

  assert.equal(r.recovered, true)
  assert.equal(r.health, 'ok')
  assert.equal(r.productCount, 30)
  assert.equal(r.via, 'poll')
  assert.ok(r.polls >= 3, 'should have polled until healthy')
})

test('MH-9: waitForRecovery gives up at the deadline instead of sleeping forever', async () => {
  const r = await waitForRecovery({
    probe: async () => ({ health: 'blocked', productCount: 0 }),
    // Deadline in the past-ish: loop must exit promptly, not hang.
    deadlineMs: 5,
    pollMs: 1,
    sleepFn: noSleep,
    label: 'test',
  })

  assert.equal(r.recovered, false)
  assert.equal(r.health, 'blocked')
  assert.equal(r.via, 'deadline')
})

test('MH-9: a healthy page with an empty grid is not "recovered" unless products render', async () => {
  const emptyButHealthy = async () => ({ health: 'ok', productCount: 0 })

  const strict = await waitForRecovery({
    probe: emptyButHealthy,
    deadlineMs: 5,
    pollMs: 1,
    sleepFn: noSleep,
  })
  assert.equal(strict.recovered, false, 'list harvest needs a rendered grid')

  // PDPs have no grid to count — health alone must be enough there.
  const lenient = await waitForRecovery({
    probe: emptyButHealthy,
    deadlineMs: 60000,
    pollMs: 1,
    sleepFn: noSleep,
    requireProducts: false,
  })
  assert.equal(lenient.recovered, true, 'PDP path decides on health alone')
})

test('MH-9: onBlocked fires once up front, onResolved reports the outcome', async () => {
  const blocked = []
  const resolved = []

  await waitForRecovery({
    probe: probeBlockedThenOk(1),
    deadlineMs: 60000,
    pollMs: 1,
    sleepFn: noSleep,
    label: 'biodance / Serums p2',
    onBlocked: (i) => blocked.push(i),
    onResolved: (i) => resolved.push(i),
  })

  assert.equal(blocked.length, 1, 'exactly one blocked ping per wall')
  assert.equal(blocked[0].label, 'biodance / Serums p2')
  assert.equal(resolved.length, 1)
  assert.equal(resolved[0].recovered, true)
  assert.ok(typeof resolved[0].waitedMs === 'number')
})

test('MH-9: a failing notify hook never breaks the harvest', async () => {
  const r = await waitForRecovery({
    probe: probeBlockedThenOk(1),
    deadlineMs: 60000,
    pollMs: 1,
    sleepFn: noSleep,
    onBlocked: async () => {
      throw new Error('slack down')
    },
    onResolved: async () => {
      throw new Error('slack still down')
    },
  })

  assert.equal(r.recovered, true, 'harvest continues even when pings fail')
})

test('MH-9: a throwing probe is survived, not propagated', async () => {
  let calls = 0
  const r = await waitForRecovery({
    probe: async () => {
      calls++
      if (calls === 1) throw new Error('detached Frame')
      return { health: 'ok', productCount: 12 }
    },
    deadlineMs: 60000,
    pollMs: 1,
    sleepFn: noSleep,
  })

  assert.equal(r.recovered, true)
  assert.equal(r.productCount, 12)
})

test('MH-9: notifier is inert when unconfigured and never throws', async () => {
  const n = createHarvestNotifier({ workspaceId: 'ws-1', baseUrl: '', secret: '' })
  assert.equal(n.enabled, false)
  const res = await n.blocked({ brand_key: 'biodance' })
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'not_configured')

  const nul = nullNotifier()
  assert.equal(nul.enabled, false)
  assert.equal((await nul.recovered({})).skipped, true)
})

test('MH-9: harvest paths no longer block on a keypress for captcha', () => {
  const computer = readFileSync(
    new URL('../marketplace/computerHarvest.mjs', import.meta.url),
    'utf8',
  )
  const pdp = readFileSync(new URL('../marketplace/pdpEnrich.mjs', import.meta.url), 'utf8')

  // Both captcha paths go through the poller.
  assert.match(computer, /waitForRecovery\(\{/)
  assert.match(pdp, /waitForRecovery\(\{/)

  // waitForEnter survives only for --step / --pause-load babysit modes,
  // and those are TTY-guarded so cron cannot blind-sleep on them.
  assert.match(computer, /pauseAfterLoad && process\.stdin\.isTTY/)
  assert.match(pdp, /pauseAfterLoad === true && process\.stdin\.isTTY/)
})

test('MH-9: cycle CLI exposes recovery + notification controls', () => {
  const script = readFileSync(new URL('../scripts/mall-brand-cycle.mjs', import.meta.url), 'utf8')
  assert.match(script, /--recovery-minutes/)
  assert.match(script, /--no-notify/)
  assert.match(script, /createHarvestNotifier/)
  assert.match(script, /onBlocked/)
  assert.match(script, /onResolved/)
})

test('jitterMs stays near base', () => {
  for (let i = 0; i < 20; i++) {
    const j = jitterMs(10000, 0.3)
    assert.ok(j >= 7000 && j <= 13000, `j=${j}`)
  }
})

test('humanPreNavPause respects min/max and is finite', async () => {
  const t0 = Date.now()
  const ms = await humanPreNavPause({ minMs: 50, maxMs: 80, label: 'test' })
  const elapsed = Date.now() - t0
  assert.ok(ms >= 50 && ms <= 80)
  assert.ok(elapsed >= 40 && elapsed < 500)
})

test('cycle CLI exposes humanize pre-nav and brand gap flags', () => {
  const script = readFileSync(new URL('../scripts/mall-brand-cycle.mjs', import.meta.url), 'utf8')
  assert.match(script, /--pre-nav-min-sec/)
  assert.match(script, /--brand-gap-min-sec/)
  assert.match(script, /humanPreNavPause/)
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
