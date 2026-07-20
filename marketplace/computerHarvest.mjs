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
  const bursts = opts.bursts ?? rand(3, 6)
  const vp = page.viewport() || { width: 1365, height: 900 }

  // Start near middle of product area
  await humanMouseMove(
    page,
    rand(Math.floor(vp.width * 0.3), Math.floor(vp.width * 0.7)),
    rand(280, 520),
  )

  for (let i = 0; i < bursts; i++) {
    const deltaY = rand(280, 620)
    try {
      await page.mouse.wheel({ deltaY })
    } catch {
      await page.evaluate((dy) => window.scrollBy(0, dy), deltaY)
    }
    await sleep(rand(350, 900))
    // small mouse drift
    await humanMouseMove(
      page,
      rand(Math.floor(vp.width * 0.25), Math.floor(vp.width * 0.75)),
      rand(200, Math.floor(vp.height * 0.7)),
    )
    await sleep(rand(200, 500))
  }
}

/**
 * Navigate like a person: open URL, move mouse, scroll, wait, extract.
 * On captcha/login: never silent-fail — wait for human Enter.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @param {{
 *   step?: boolean
 *   label?: string
 *   maxCaptchaRounds?: number
 *   harvestEvaluate?: () => object
 * }} [opts]
 */
export async function openAndHarvestPageComputer(page, url, opts = {}) {
  const label = opts.label || url
  // Injected by mallHarvestWorker to avoid circular import
  let harvestEvaluate = opts.harvestEvaluate
  if (typeof harvestEvaluate !== 'function') {
    const mod = await import('./mallHarvestWorker.mjs')
    harvestEvaluate = mod.browserHarvestEvaluate
  }

  console.error(`[computer] open ${label}`)
  console.error(`[computer]   ${url}`)

  // Pre-move so first frame isn't a pure programmatic goto + extract
  await humanIdleMouse(page)
  await sleep(rand(200, 600))

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
  } catch (e) {
    console.error(`[computer] goto soft-fail: ${e?.message || e}`)
  }

  await sleep(rand(1200, 2200))
  await humanIdleMouse(page)
  await sleep(rand(400, 900))
  await humanScrollPage(page)
  await sleep(rand(800, 1600))

  let harvest = await page.evaluate(harvestEvaluate)
  let health = detectSessionHealth({
    title: harvest.session_probe?.title,
    bodyText: harvest.session_probe?.bodySnippet,
    url: harvest.page_url || page.url(),
  })

  let rounds = 0
  const maxRounds = opts.maxCaptchaRounds ?? 20
  while (
    (health === 'blocked' ||
      health === 'login_required' ||
      (health === 'ok' && harvest.product_count === 0 && rounds === 0)) &&
    rounds < maxRounds
  ) {
    // Empty first load might be SPA — one more scroll before asking human
    if (health === 'ok' && harvest.product_count === 0 && rounds === 0) {
      console.error('[computer] 0 products after scroll — scrolling again…')
      await humanScrollPage(page, { bursts: 4 })
      await sleep(rand(1000, 2000))
      harvest = await page.evaluate(harvestEvaluate)
      health = detectSessionHealth({
        title: harvest.session_probe?.title,
        bodyText: harvest.session_probe?.bodySnippet,
        url: page.url(),
      })
      if (harvest.product_count > 0) break
    }

    if (health === 'blocked' || health === 'login_required') {
      console.error(`[computer] CAPTCHA / login wall (health=${health})`)
    } else {
      console.error('[computer] Still no products visible')
    }

    await waitForEnter(
      '[computer] Solve captcha / wait for products in the Chrome window, then press Enter here…',
      { fallbackMs: 180000 },
    )

    await humanScrollPage(page, { bursts: 3 })
    await sleep(rand(800, 1500))
    harvest = await page.evaluate(harvestEvaluate)
    health = detectSessionHealth({
      title: harvest.session_probe?.title,
      bodyText: harvest.session_probe?.bodySnippet,
      url: page.url(),
    })
    rounds++

    if (health === 'ok' && harvest.product_count > 0) break
  }

  if (opts.step) {
    await waitForEnter(
      `[computer] Extracted ${harvest.product_count} products. Press Enter for next page/shelf…`,
      { fallbackMs: 5000 },
    )
  } else {
    // Natural pause before next navigation
    await sleep(rand(2500, 5000))
  }

  return {
    harvest,
    session_health: health,
    computer: true,
    captcha_rounds: rounds,
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
    // Slower between pages/shelves
    delay_ms: opts.delay_ms ?? 8000,
    shelf_delay_ms: opts.shelf_delay_ms ?? 10000,
    captchaWaitMs: opts.captchaWaitMs ?? 600000,
    step: opts.step === true,
  }
}
