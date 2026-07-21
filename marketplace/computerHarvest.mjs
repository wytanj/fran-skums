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
 * Navigate like a person: open URL, pause for captcha after first paint, scroll, extract.
 * On captcha/login: never silent-fail — wait for human Enter.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @param {{
 *   step?: boolean
 *   pauseAfterLoad?: boolean
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
  // Default false = captcha-only pause (Level 2). Use pauseAfterLoad: true for babysit mode.
  const pauseAfterLoad = opts.pauseAfterLoad === true

  console.error(`[computer] open ${label}`)
  console.error(`[computer]   ${url}`)

  try {
    await humanIdleMouse(page)
  } catch {
    /* blank tab */
  }
  await sleep(rand(200, 600))

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
  } catch (e) {
    console.error(`[computer] goto soft-fail: ${e?.message || e}`)
  }

  // Let SPA paint (user often sees products briefly before captcha)
  await sleep(rand(1500, 2500))

  if (pauseAfterLoad) {
    console.error(
      '[computer] Page navigated. If captcha / verify appears after paint, solve it in Chrome now.',
    )
    await waitForEnter(
      '[computer] When the product grid is visible (captcha cleared), press Enter here…',
      { fallbackMs: 300000 },
    )
  }

  try {
    await humanIdleMouse(page)
  } catch {
    /* ignore */
  }
  await sleep(rand(300, 700))
  try {
    await humanScrollPage(page)
  } catch (e) {
    if (!isDetachedError(e)) console.error(`[computer] scroll: ${e?.message || e}`)
  }
  await sleep(rand(800, 1600))

  let harvest = await safeHarvestEvaluate(page, harvestEvaluate)
  let health = detectSessionHealth({
    title: harvest.session_probe?.title,
    bodyText: harvest.session_probe?.bodySnippet,
    url: harvest.page_url || (await page.url().catch(() => url)),
  })
  if (harvest._detached) health = 'blocked'

  let rounds = 0
  const maxRounds = opts.maxCaptchaRounds ?? 20
  while (
    (health === 'blocked' ||
      health === 'login_required' ||
      (health === 'ok' && harvest.product_count === 0 && rounds === 0) ||
      harvest._detached) &&
    rounds < maxRounds
  ) {
    if (health === 'ok' && harvest.product_count === 0 && rounds === 0 && !harvest._detached) {
      console.error('[computer] 0 products after scroll — scrolling again…')
      try {
        await humanScrollPage(page, { bursts: 4 })
      } catch {
        /* ignore */
      }
      await sleep(rand(1000, 2000))
      harvest = await safeHarvestEvaluate(page, harvestEvaluate)
      health = detectSessionHealth({
        title: harvest.session_probe?.title,
        bodyText: harvest.session_probe?.bodySnippet,
        url: await page.url().catch(() => url),
      })
      if (harvest.product_count > 0) break
    }

    if (health === 'blocked' || health === 'login_required' || harvest._detached) {
      console.error(`[computer] CAPTCHA / login / frame lost (health=${health})`)
      try {
        process.stderr.write('\x07') // terminal bell — look at Chrome
      } catch {
        /* ignore */
      }
    } else {
      console.error('[computer] Still no products visible')
    }

    await waitForEnter(
      '[computer] Solve captcha in Chrome (or reload the shop URL if blank), then press Enter…',
      { fallbackMs: 300000 },
    )

    // Soft reload if frame died during captcha remount
    if (harvest._detached) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
        await sleep(1500)
      } catch (e) {
        console.error(`[computer] reload soft-fail: ${e?.message || e}`)
      }
    }

    try {
      await humanScrollPage(page, { bursts: 3 })
    } catch {
      /* ignore */
    }
    await sleep(rand(800, 1500))
    harvest = await safeHarvestEvaluate(page, harvestEvaluate)
    health = detectSessionHealth({
      title: harvest.session_probe?.title,
      bodyText: harvest.session_probe?.bodySnippet,
      url: await page.url().catch(() => url),
    })
    if (harvest._detached) health = 'blocked'
    rounds++

    if (health === 'ok' && harvest.product_count > 0 && !harvest._detached) break
  }

  if (opts.step) {
    await waitForEnter(
      `[computer] Extracted ${harvest.product_count} products. Press Enter for next page/shelf…`,
      { fallbackMs: 5000 },
    )
  } else {
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
    // Captcha-only by default; set pauseAfterLoad: true to Enter after every nav
    pauseAfterLoad: opts.pauseAfterLoad === true,
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
