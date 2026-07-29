/**
 * Mode B — computer-style Mall harvest (Perplexity Computer–like).
 *
 * vs Mode A (pure script in mallHarvestWorker.openAndHarvestPage):
 * - Always headed Chrome with warm userDataDir
 * - Real mouse moves + wheel scroll (not only window.scrollBy)
 * - Slow human-ish pacing between actions
 * - Captcha: pause until you solve it and press Enter (machine stays on)
 *
 * Use when captcha is likely. Keep the terminal focused for Enter prompts.
 */

import readline from 'node:readline'
import { detectSessionHealth } from './shopee/parseSearch.mjs'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Jitter a base delay (ms). Default ±30%.
 * @param {number} baseMs
 * @param {number} [frac]
 */
export function jitterMs(baseMs, frac = 0.3) {
  const base = Math.max(0, Number(baseMs) || 0)
  const f = Math.min(Math.max(frac, 0), 0.9)
  const lo = Math.floor(base * (1 - f))
  const hi = Math.ceil(base * (1 + f))
  return rand(lo, Math.max(lo, hi))
}

/**
 * Random pause in [minMs, maxMs], logged once.
 * Default 5–15s — use before first nav of a brand / session to cool Shopee rate limits.
 * @param {{ minMs?: number, maxMs?: number, label?: string }} [opts]
 */
export async function humanPreNavPause(opts = {}) {
  const minMs = Math.max(0, opts.minMs ?? 5000)
  const maxMs = Math.max(minMs, opts.maxMs ?? 15000)
  const ms = rand(minMs, maxMs)
  const label = opts.label || 'pre-nav'
  console.error(`[humanize] ${label}: settling ${Math.round(ms / 1000)}s before next action…`)
  await sleep(ms)
  return ms
}

/**
 * Session-level first-nav tracking (per Node process).
 * Shopee often only hard-walls the first request after attach; after that a warm
 * cookie is enough. Long 5–15s + soft-clicks on *every* page slow 80-brand runs
 * and can interfere with captcha drag. Prefer long settle once, then lighter gaps.
 */
let _sessionNavCount = 0

/** @returns {number} navigations completed this process */
export function getSessionNavCount() {
  return _sessionNavCount
}

export function resetSessionNavCount() {
  _sessionNavCount = 0
}

/**
 * Soft click on non-link empty-ish viewport (rarely triggers navigation).
 * @param {import('puppeteer').Page} page
 */
export async function humanSoftClick(page) {
  const vp = page.viewport() || { width: 1365, height: 900 }
  // Prefer chrome chrome / header / side gutter — not product cards mid-grid
  const zones = [
    { x: rand(20, 80), y: rand(80, 200) },
    { x: rand(vp.width - 100, vp.width - 20), y: rand(100, 280) },
    { x: rand(Math.floor(vp.width * 0.35), Math.floor(vp.width * 0.65)), y: rand(60, 120) },
  ]
  const z = zones[rand(0, zones.length - 1)]
  await humanMouseMove(page, z.x, z.y)
  await sleep(rand(80, 220))
  try {
    await page.mouse.click(z.x, z.y, { delay: rand(40, 120) })
  } catch {
    /* ignore */
  }
  await sleep(rand(120, 400))
}

/**
 * Light wander: 1–3 mouse drifts + optional soft click + tiny scroll.
 * Cheaper than a full product-grid scroll storm (which can look botty after captcha).
 * @param {import('puppeteer').Page} page
 * @param {{ clicks?: boolean }} [opts]
 */
export async function humanLightBrowse(page, opts = {}) {
  const drifts = rand(1, 3)
  for (let i = 0; i < drifts; i++) {
    try {
      await humanIdleMouse(page)
    } catch {
      /* ignore */
    }
    await sleep(rand(200, 700))
  }
  if (opts.clicks !== false && Math.random() < 0.45) {
    try {
      await humanSoftClick(page)
    } catch {
      /* ignore */
    }
  }
  if (Math.random() < 0.55) {
    try {
      await page.mouse.wheel({ deltaY: rand(80, 220) })
    } catch {
      /* ignore */
    }
    await sleep(rand(250, 600))
  }
}

/**
 * Wait for Enter in the terminal (TTY). Non-TTY: sleep ms instead.
 * @param {string} message
 * @param {{ fallbackMs?: number }} [opts]
 */
export async function waitForEnter(message, opts = {}) {
  const fallbackMs = opts.fallbackMs ?? 120000
  console.error(message)
  if (!process.stdin.isTTY) {
    console.error(`[computer] no TTY — waiting ${Math.round(fallbackMs / 1000)}s instead of Enter`)
    await sleep(fallbackMs)
    return
  }
  await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
    rl.question('', () => {
      rl.close()
      resolve()
    })
  })
}

/**
 * MH-9 — wait for the page to recover from a captcha / login wall by *polling*,
 * not by blocking on a keypress.
 *
 * This is what makes the cycle schedulable. `waitForEnter` needs a TTY, and on
 * cron there is no TTY, so the old path just slept blindly and called it done.
 * Here the loop re-probes until the page is genuinely usable again, an operator
 * hits Enter to hurry it along, or the deadline expires — and it reports which.
 *
 * Takes no `page` — the injected `probe` already closes over whatever it needs,
 * which also makes this testable without a browser.
 *
 * @param {{
 *   probe: () => Promise<{ health: string, productCount: number, harvest?: any }>
 *   deadlineMs?: number
 *   pollMs?: number
 *   label?: string
 *   requireProducts?: boolean
 *   sleepFn?: (ms: number) => Promise<void>
 *   onBlocked?: (info: { label: string, health: string }) => void | Promise<void>
 *   onResolved?: (info: { label: string, health: string, recovered: boolean, waitedMs: number, via: string }) => void | Promise<void>
 * }} opts
 * @returns {Promise<{ recovered: boolean, health: string, productCount: number, harvest: any, waitedMs: number, via: string, polls: number }>}
 */
export async function waitForRecovery(opts) {
  const label = opts.label || 'page'
  const deadlineMs = opts.deadlineMs ?? 900000 // 15 min
  const pollMs = Math.max(opts.pollMs ?? 5000, 1000)
  const requireProducts = opts.requireProducts !== false
  const napFn = typeof opts.sleepFn === 'function' ? opts.sleepFn : sleep
  const startedAt = Date.now()
  const deadline = startedAt + deadlineMs

  const isUsable = (health, productCount) => {
    if (health === 'blocked' || health === 'login_required') return false
    return requireProducts ? productCount > 0 : true
  }

  // "blocked" and "healthy but nothing rendered" need different words —
  // an operator reading the log should know whether there is a wall to solve.
  const describe = (health, productCount) =>
    health === 'blocked' || health === 'login_required'
      ? `health=${health}`
      : `health=${health}, no products rendered (${productCount})`

  // Terminal bell + a message a human can act on without reading the code.
  try {
    process.stderr.write('\x07')
  } catch {
    /* ignore */
  }
  const budget =
    deadlineMs >= 60000
      ? `${Math.round(deadlineMs / 60000)}min`
      : `${Math.round(deadlineMs / 1000)}s`
  console.error(
    `[recover] ${label}: blocked — solve it in Chrome. Polling every ${Math.round(
      pollMs / 1000,
    )}s for up to ${budget}. Press Enter to re-check now.`,
  )

  if (typeof opts.onBlocked === 'function') {
    try {
      await opts.onBlocked({ label, health: 'blocked' })
    } catch (e) {
      console.error(`[recover] onBlocked hook failed: ${e?.message || e}`)
    }
  }

  // Enter is an accelerator, never a requirement — set a flag, don't block.
  let enterPressed = false
  const canStdin = Boolean(process.stdin.isTTY)
  const onData = (buf) => {
    if (String(buf).includes('\n') || String(buf).includes('\r')) enterPressed = true
  }
  if (canStdin) {
    try {
      process.stdin.resume()
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', onData)
    } catch {
      /* ignore */
    }
  }

  let health = 'unknown'
  let productCount = 0
  let harvest = null
  let polls = 0
  let via = 'deadline'

  try {
    while (Date.now() < deadline) {
      const waited = Date.now() - startedAt
      let probed
      try {
        probed = await opts.probe()
      } catch (e) {
        console.error(`[recover] probe failed: ${e?.message || e}`)
        probed = null
      }
      polls++

      if (probed) {
        health = probed.health
        productCount = probed.productCount ?? 0
        harvest = probed.harvest ?? harvest

        if (isUsable(health, productCount)) {
          via = enterPressed ? 'enter' : 'poll'
          console.error(
            `[recover] ${label}: recovered after ${Math.round(waited / 1000)}s (${polls} poll(s), health=${health}, products=${productCount})`,
          )
          break
        }
      }

      if (enterPressed) {
        // Human says they fixed it but the probe disagrees — tell them, keep going.
        enterPressed = false
        console.error(
          `[recover] ${label}: not usable yet — ${describe(health, productCount)}; continuing to poll`,
        )
      }

      // Progress line roughly once a minute so a watched terminal isn't silent.
      if (polls % Math.max(1, Math.round(60000 / pollMs)) === 0) {
        console.error(
          `[recover] ${label}: waiting ${Math.round(waited / 1000)}s — ${describe(health, productCount)}`,
        )
      }

      await napFn(Math.min(pollMs, Math.max(0, deadline - Date.now())))
    }
  } finally {
    if (canStdin) {
      try {
        process.stdin.off('data', onData)
        process.stdin.pause()
      } catch {
        /* ignore */
      }
    }
  }

  const recovered = isUsable(health, productCount)
  const waitedMs = Date.now() - startedAt
  if (!recovered) {
    via = 'deadline'
    console.error(
      `[recover] ${label}: gave up after ${Math.round(waitedMs / 1000)}s — ${describe(health, productCount)} — moving on`,
    )
  }

  if (typeof opts.onResolved === 'function') {
    try {
      await opts.onResolved({ label, health, recovered, waitedMs, via })
    } catch (e) {
      console.error(`[recover] onResolved hook failed: ${e?.message || e}`)
    }
  }

  return { recovered, health, productCount, harvest, waitedMs, via, polls }
}

/**
 * Smooth mouse move to (x,y) with intermediate steps.
 * @param {import('puppeteer').Page} page
 * @param {number} x
 * @param {number} y
 */
export async function humanMouseMove(page, x, y) {
  const steps = rand(12, 28)
  try {
    await page.mouse.move(x, y, { steps })
  } catch {
    /* viewport edge */
  }
  await sleep(rand(40, 160))
}

/**
 * Random idle mouse wander in viewport.
 * @param {import('puppeteer').Page} page
 */
export async function humanIdleMouse(page) {
  const vp = page.viewport() || { width: 1365, height: 900 }
  const x = rand(80, Math.max(100, vp.width - 80))
  const y = rand(80, Math.max(100, vp.height - 80))
  await humanMouseMove(page, x, y)
}

/**
 * Human-like scroll down using mouse wheel + occasional pointer move.
 * @param {import('puppeteer').Page} page
 * @param {{ bursts?: number }} [opts]
 */
export async function humanScrollPage(page, opts = {}) {
  // Gentle default: fewer/faster bursts than old 3–6× big wheels (looked bot-like after walls)
  const bursts = opts.bursts ?? rand(2, 4)
  const vp = page.viewport() || { width: 1365, height: 900 }

  // Start near middle of product area
  await humanMouseMove(
    page,
    rand(Math.floor(vp.width * 0.3), Math.floor(vp.width * 0.7)),
    rand(280, 520),
  )

  for (let i = 0; i < bursts; i++) {
    // Occasional small reverse scroll (human re-check)
    const reverse = Math.random() < 0.18
    const deltaY = reverse ? -rand(60, 180) : rand(160, 420)
    try {
      await page.mouse.wheel({ deltaY })
    } catch {
      await page.evaluate((dy) => window.scrollBy(0, dy), deltaY)
    }
    await sleep(rand(450, 1200))
    // small mouse drift
    await humanMouseMove(
      page,
      rand(Math.floor(vp.width * 0.25), Math.floor(vp.width * 0.75)),
      rand(200, Math.floor(vp.height * 0.7)),
    )
    await sleep(rand(250, 700))
  }
}

function isDetachedError(e) {
  const msg = String(e?.message || e || '')
  return /detached Frame|Target closed|Session closed|Execution context was destroyed|frame was detached/i.test(
    msg,
  )
}

/**
 * page.evaluate that soft-fails on detached frames (Shopee captcha often remounts DOM).
 * @param {import('puppeteer').Page} page
 * @param {() => object} fn
 */
async function safeHarvestEvaluate(page, fn) {
  try {
    return await page.evaluate(fn)
  } catch (e) {
    if (isDetachedError(e)) {
      console.error(`[computer] evaluate lost frame: ${e?.message || e}`)
      return {
        shop_username: null,
        shop_id: null,
        page_url: '',
        page: 0,
        sort_by: 'pop',
        active_category: 'All Products',
        product_count: 0,
        products: [],
        session_probe: {
          title: '',
          bodySnippet: 'detached_frame',
        },
        harvested_at: new Date().toISOString(),
        _detached: true,
      }
    }
    throw e
  }
}

/**
 * Navigate like a person: open URL, scroll, extract.
 *
 * On captcha/login it never silent-fails and never blocks on a keypress —
 * it polls via `waitForRecovery` until the wall clears or the deadline passes,
 * so the same code path works attended and on a schedule (MH-9).
 *
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @param {{
 *   step?: boolean
 *   pauseAfterLoad?: boolean
 *   label?: string
 *   harvestEvaluate?: () => object
 *   recoveryDeadlineMs?: number
 *   recoveryPollMs?: number
 *   preNavMinMs?: number
 *   preNavMaxMs?: number
 *   skipPreNavPause?: boolean
 *   onBlocked?: (info: object) => void | Promise<void>
 *   onResolved?: (info: object) => void | Promise<void>
 *   bounceChromeOnCaptcha?: () => Promise<import('puppeteer').Page | null | void>
 *   pageBag?: { current: import('puppeteer').Page }
 * }} [opts]
 */
export async function openAndHarvestPageComputer(page, url, opts = {}) {
  const label = opts.label || url
  // Allow rebind after Chrome bounce (captcha recovery).
  let activePage = opts.pageBag?.current || page
  const bindPage = (p) => {
    if (!p) return
    activePage = p
    if (opts.pageBag) opts.pageBag.current = p
  }
  // Injected by mallHarvestWorker to avoid circular import
  let harvestEvaluate = opts.harvestEvaluate
  if (typeof harvestEvaluate !== 'function') {
    const mod = await import('./mallHarvestWorker.mjs')
    harvestEvaluate = mod.browserHarvestEvaluate
  }
  // Default false = captcha-only pause (Level 2). Use pauseAfterLoad: true for babysit mode.
  const pauseAfterLoad = opts.pauseAfterLoad === true

  console.error(`[computer] open ${label}`)
  console.error(`[computer]   ${url}`)

  // Session first nav: long settle (5–15s). Later navs: short jitter only (1–3s)
  // unless forcePreNavEveryPage — matches "initial captcha once, then ok".
  const isFirstNav = _sessionNavCount === 0
  const everyPage = opts.forcePreNavEveryPage === true
  if (opts.skipPreNavPause !== true) {
    if (isFirstNav || everyPage) {
      await humanPreNavPause({
        minMs: opts.preNavMinMs ?? 5000,
        maxMs: opts.preNavMaxMs ?? 15000,
        label: isFirstNav ? `${label} (session warm-up)` : label,
      })
    } else {
      const short = rand(opts.preNavShortMinMs ?? 800, opts.preNavShortMaxMs ?? 2800)
      console.error(`[humanize] ${label}: short gap ${Math.round(short / 1000)}s (session warm)`)
      await sleep(short)
    }
  }

  // Soft-clicks only on warm-up — during/after captcha they fight drag puzzles
  try {
    await humanLightBrowse(activePage, { clicks: isFirstNav && Math.random() < 0.4 })
  } catch {
    /* blank tab */
  }
  await sleep(rand(200, 600))

  try {
    await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
    _sessionNavCount += 1
  } catch (e) {
    console.error(`[computer] goto soft-fail: ${e?.message || e}`)
    _sessionNavCount += 1
  }

  // First page after session start: longer paint wait (anti-bot often settles then)
  if (isFirstNav) {
    await sleep(rand(2800, 5500))
  } else {
    await sleep(rand(1200, 2800))
  }

  // --pause-load is an explicit babysit flag. Without a TTY nobody can press
  // Enter, so honouring it would just blind-sleep 5 min per page.
  if (pauseAfterLoad && process.stdin.isTTY) {
    console.error(
      '[computer] Page navigated. If captcha / verify appears after paint, solve it in Chrome now.',
    )
    console.error(
      '[computer] Tip: use a real mouse on the captcha drag — automation clicks make it stiffer.',
    )
    await waitForEnter(
      '[computer] When the product grid is visible (captcha cleared), press Enter here…',
      { fallbackMs: 300000 },
    )
  } else if (pauseAfterLoad) {
    console.error('[computer] --pause-load ignored (no TTY) — relying on captcha polling instead')
  }

  // No soft-click after load — captcha drag / slider is human-only
  try {
    await humanIdleMouse(activePage)
  } catch {
    /* ignore */
  }
  await sleep(rand(300, 800))
  try {
    await humanScrollPage(activePage)
  } catch (e) {
    if (!isDetachedError(e)) console.error(`[computer] scroll: ${e?.message || e}`)
  }
  await sleep(rand(700, 1600))

  // page.url() is synchronous in Puppeteer — never call .catch() on it.
  const currentUrl = () => {
    try {
      return activePage.url() || url
    } catch {
      return url
    }
  }

  let harvest = await safeHarvestEvaluate(activePage, harvestEvaluate)
  let health = detectSessionHealth({
    title: harvest.session_probe?.title,
    bodyText: harvest.session_probe?.bodySnippet,
    url: harvest.page_url || currentUrl(),
    productCount: harvest.product_count,
  })
  if (harvest._detached) health = 'blocked'

  // 'unknown' is treated like 'ok' here: not a confirmed block, but an empty
  // grid still deserves one more scroll before we accept it.
  const readable = (h) => h === 'ok' || h === 'unknown'

  // One cheap retry for an empty-but-healthy grid — lazy render, not a wall.
  if (readable(health) && harvest.product_count === 0 && !harvest._detached) {
    console.error('[computer] 0 products after scroll — scrolling again…')
    try {
      await humanScrollPage(activePage, { bursts: 4 })
    } catch {
      /* ignore */
    }
    await sleep(rand(1000, 2000))
    harvest = await safeHarvestEvaluate(activePage, harvestEvaluate)
    health = detectSessionHealth({
      title: harvest.session_probe?.title,
      bodyText: harvest.session_probe?.bodySnippet,
      url: currentUrl(),
      productCount: harvest.product_count,
    })
    if (harvest._detached) health = 'blocked'
  }

  // MH-9: a real wall no longer blocks on a keypress — poll until the operator
  // clears it (or the deadline passes), so this can run unattended.
  let recovery = null
  if (health === 'blocked' || health === 'login_required' || harvest._detached) {
    // Operator preference: close Chrome → wait ~2s → new window → settle ~10s → resume poll.
    // Once per wall (bounceChromeOnCaptcha is provided by mall-brand-cycle --connect).
    if (typeof opts.bounceChromeOnCaptcha === 'function') {
      try {
        console.error(
          `[computer] ${label}: captcha/login wall — bouncing Chrome (close → relaunch → settle)…`,
        )
        const newPage = await opts.bounceChromeOnCaptcha({ label, url, health })
        if (newPage) bindPage(newPage)
        try {
          await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
          await sleep(rand(1500, 3000))
        } catch (e) {
          console.error(`[computer] post-bounce goto soft-fail: ${e?.message || e}`)
        }
      } catch (e) {
        console.error(`[computer] chrome bounce failed: ${e?.message || e}`)
      }
    }

    const probe = async () => {
      // Frame died during a captcha remount — reload before probing again.
      if (harvest?._detached) {
        try {
          await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
          await sleep(1500)
        } catch (e) {
          // Target closed — try one more bounce if hook available
          if (typeof opts.bounceChromeOnCaptcha === 'function' && /Target closed|Session closed|disconnected/i.test(String(e?.message || e))) {
            try {
              const np = await opts.bounceChromeOnCaptcha({ label, url, health: 'detached' })
              if (np) bindPage(np)
              await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
            } catch (e2) {
              console.error(`[computer] re-bounce soft-fail: ${e2?.message || e2}`)
            }
          } else {
            console.error(`[computer] reload soft-fail: ${e?.message || e}`)
          }
        }
      }
      try {
        await humanScrollPage(activePage, { bursts: 2 })
      } catch {
        /* ignore */
      }
      const h = await safeHarvestEvaluate(activePage, harvestEvaluate)
      let hh = detectSessionHealth({
        title: h.session_probe?.title,
        bodyText: h.session_probe?.bodySnippet,
        url: currentUrl(),
        productCount: h.product_count,
      })
      if (h._detached) hh = 'blocked'
      harvest = h
      return { health: hh, productCount: h.product_count || 0, harvest: h }
    }

    recovery = await waitForRecovery({
      probe,
      label,
      deadlineMs: opts.recoveryDeadlineMs ?? 900000,
      pollMs: opts.recoveryPollMs ?? 5000,
      onBlocked: opts.onBlocked,
      onResolved: opts.onResolved,
    })

    health = recovery.health
    if (recovery.harvest) harvest = recovery.harvest
  }

  const rounds = recovery ? recovery.polls : 0

  if (opts.step) {
    await waitForEnter(
      `[computer] Extracted ${harvest.product_count} products. Press Enter for next page/shelf…`,
      { fallbackMs: 5000 },
    )
  } else {
    // Between pages: longer + jittered so multi-page shelves don't machine-gun navs
    await sleep(rand(3500, 7500))
  }

  // After a wall, sit longer before the caller moves to the next URL
  if (health === 'blocked' || health === 'login_required' || (recovery && !recovery.recovered)) {
    const cool = rand(12000, 28000)
    console.error(
      `[humanize] ${label}: post-block cool-down ${Math.round(cool / 1000)}s before next page…`,
    )
    await sleep(cool)
  }

  return {
    harvest,
    session_health: health,
    computer: true,
    captcha_rounds: rounds,
    page: activePage,
  }
}

/**
 * Launch options for computer mode (always headed, warm profile, slower).
 * @param {{ profileDir: string }} opts
 */
export function computerBrowserLaunchOptions(opts) {
  return {
    headless: false,
    userDataDir: opts.profileDir,
    defaultViewport: null, // real window chrome
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--start-maximized',
      '--disable-infobars',
    ],
  }
}

/**
 * Apply computer-mode pacing defaults onto harvest opts.
 * @param {object} opts
 */
export function withComputerDefaults(opts = {}) {
  return {
    ...opts,
    computer: true,
    interactive: true,
    // Slower between pages/shelves (worker still sleeps delay_ms; we bias higher)
    delay_ms: opts.delay_ms ?? 11000,
    shelf_delay_ms: opts.shelf_delay_ms ?? 14000,
    captchaWaitMs: opts.captchaWaitMs ?? 600000,
    step: opts.step === true,
    // Captcha-only by default; set pauseAfterLoad: true to Enter after every nav
    pauseAfterLoad: opts.pauseAfterLoad === true,
    // MH-9 recovery polling — how long to wait for a human to clear a wall
    // before giving up on this page and letting the caller move on.
    recoveryDeadlineMs: opts.recoveryDeadlineMs ?? 900000,
    recoveryPollMs: opts.recoveryPollMs ?? 5000,
    // Long settle once per session (first goto); later pages use short gaps
    preNavMinMs: opts.preNavMinMs ?? 5000,
    preNavMaxMs: opts.preNavMaxMs ?? 15000,
    preNavShortMinMs: opts.preNavShortMinMs ?? 800,
    preNavShortMaxMs: opts.preNavShortMaxMs ?? 2800,
    skipPreNavPause: opts.skipPreNavPause === true,
    // true = old behaviour (5–15s before every page — slow for 80 brands)
    forcePreNavEveryPage: opts.forcePreNavEveryPage === true,
  }
}

/**
 * Attach to a Chrome you already started with remote debugging
 * (real session cookies — far less captcha than puppeteer.launch).
 *
 *   chrome.exe --remote-debugging-port=9222 --user-data-dir="...\.shopee-chrome-profile"
 *
 * @param {string} [browserURL]
 */
export async function connectComputerBrowser(browserURL) {
  const url = browserURL || process.env.SHOPEE_CDP_URL || 'http://127.0.0.1:9222'
  const browser = await puppeteerConnect(url)
  return { browser, browserURL: url, connected: true }
}

/** Lazy import so unit tests don't need puppeteer when only testing defaults. */
async function puppeteerConnect(browserURL) {
  const puppeteer = (await import('puppeteer')).default
  return puppeteer.connect({
    browserURL,
    defaultViewport: null,
  })
}
