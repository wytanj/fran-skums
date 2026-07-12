/**
 * Shopee keyword SERP collector via Browserbase cloud browsers + Puppeteer.
 * collector_id: browserbase
 *
 * Env:
 *   BROWSERBASE_API_KEY          (required)
 *   BROWSERBASE_PROJECT_ID       (optional — inferred from key if omitted)
 *   BROWSERBASE_PROXIES          default "1" (managed residential proxies)
 *   BROWSERBASE_REGION           default "ap-southeast-1" (near Shopee SG)
 *   BROWSERBASE_SOLVE_CAPTCHAS   default "1"
 *   BROWSERBASE_ADVANCED_STEALTH default "0" (plan-dependent)
 *   BROWSERBASE_OS               default "linux" (Developer plan).
 *                                "windows" / "mac" need Verified / Enterprise.
 *   BROWSERBASE_CONTEXT_ID       optional persistent context id
 *   BROWSERBASE_TIMEOUT_SEC      default 300
 *
 * Optional session cookies still work via SHOPEE_SG_SESSION_JSON
 * (loaded by scrapeShopeeWithPuppeteer). Prefer pure Browserbase first.
 */

import puppeteer from 'puppeteer'
import { scrapeShopeeWithPuppeteer } from '../shopee-puppeteer/adapter.mjs'

const BB_API = 'https://api.browserbase.com/v1'

/**
 * @param {Record<string, unknown>} [overrides]
 * @returns {Promise<{ id: string, connectUrl: string, projectId?: string }>}
 */
export async function createBrowserbaseSession(overrides = {}) {
  const apiKey = process.env.BROWSERBASE_API_KEY || ''
  if (!apiKey.trim()) {
    throw new Error('browserbase requires BROWSERBASE_API_KEY')
  }

  const proxiesOn = process.env.BROWSERBASE_PROXIES !== '0'
  const solveCaptchas = process.env.BROWSERBASE_SOLVE_CAPTCHAS !== '0'
  const advancedStealth = process.env.BROWSERBASE_ADVANCED_STEALTH === '1'
  const region = process.env.BROWSERBASE_REGION || 'ap-southeast-1'
  const timeout = Math.min(
    Math.max(Number(process.env.BROWSERBASE_TIMEOUT_SEC || 300), 60),
    21600,
  )
  const projectId = process.env.BROWSERBASE_PROJECT_ID || undefined
  const contextId = process.env.BROWSERBASE_CONTEXT_ID || undefined
  // Developer plan: Linux only. Windows/mac require Verified/Enterprise.
  // https://docs.browserbase.com/platform/identity/verified-customization#verified
  const osRaw = (process.env.BROWSERBASE_OS || 'linux').toLowerCase().trim()
  const os = ['linux', 'windows', 'mac', 'mobile', 'tablet'].includes(osRaw)
    ? osRaw
    : 'linux'

  /** @type {Record<string, unknown>} */
  const body = {
    region,
    timeout,
    browserSettings: {
      solveCaptchas,
      ...(advancedStealth ? { advancedStealth: true } : {}),
      viewport: { width: 1920, height: 1080 },
      os,
      ...(contextId
        ? { context: { id: contextId, persist: true } }
        : {}),
    },
    ...(projectId ? { projectId } : {}),
    ...(proxiesOn
      ? {
          proxies: [
            {
              type: 'browserbase',
              geolocation: { country: 'SG' },
            },
          ],
        }
      : {}),
    userMetadata: {
      purpose: 'fran-skums-marketplace',
      marketplace: 'shopee',
    },
    ...overrides,
  }

  const res = await fetch(`${BB_API}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BB-API-Key': apiKey,
    },
    body: JSON.stringify(body),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      json?.message ||
      json?.error ||
      (Array.isArray(json?.errors) && json.errors[0]?.message) ||
      `Browserbase session create HTTP ${res.status}`
    throw new Error(String(msg))
  }

  const id = json.id
  const connectUrl = json.connectUrl
  if (!id || !connectUrl) {
    throw new Error('Browserbase session response missing id/connectUrl')
  }

  return {
    id: String(id),
    connectUrl: String(connectUrl),
    projectId: json.projectId ? String(json.projectId) : undefined,
  }
}

/**
 * Best-effort session debug URL for humans.
 * @param {string} sessionId
 */
export async function getBrowserbaseDebugUrl(sessionId) {
  const apiKey = process.env.BROWSERBASE_API_KEY || ''
  if (!apiKey || !sessionId) return null
  try {
    const res = await fetch(`${BB_API}/sessions/${sessionId}/debug`, {
      headers: { 'X-BB-API-Key': apiKey },
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return null
    return json.debuggerUrl || json.debuggerFullscreenUrl || null
  } catch {
    return null
  }
}

/**
 * @param {import('../types.mjs').CollectSeedInput} seed
 * @param {string} jobId
 * @returns {Promise<import('../types.mjs').CollectResult & { browserbase_session_id?: string }>}
 */
export async function scrapeShopeeWithBrowserbase(seed, jobId) {
  // Unattended cloud path — do not force local Enter waits.
  const prevForce = process.env.SHOPEE_FORCE_MANUAL_WAIT
  const prevInteractive = process.env.SHOPEE_INTERACTIVE
  const prevCaptchaWait = process.env.SHOPEE_CAPTCHA_WAIT_MS
  process.env.SHOPEE_FORCE_MANUAL_WAIT = '0'
  process.env.SHOPEE_INTERACTIVE = '0'
  process.env.SHOPEE_CAPTCHA_WAIT_MS = '0'

  const session = await createBrowserbaseSession()
  console.error(`[browserbase] session ${session.id}`)
  console.error(`[browserbase] recording https://browserbase.com/sessions/${session.id}`)
  const debugUrl = await getBrowserbaseDebugUrl(session.id)
  if (debugUrl) console.error(`[browserbase] live debug ${debugUrl}`)

  let browser = null
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: session.connectUrl,
      defaultViewport: null,
    })

    const browserApi = {
      async getBrowser() {
        return browser
      },
      async createStealthPage(b) {
        const page = await b.newPage()
        page.setDefaultNavigationTimeout(90000)
        page.setDefaultTimeout(45000)
        // Light stealth only — Browserbase handles most fingerprinting.
        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false })
        })
        return page
      },
    }

    const result = await scrapeShopeeWithPuppeteer(seed, jobId, browserApi)
    return {
      ...result,
      browserbase_session_id: session.id,
    }
  } finally {
    if (prevForce === undefined) delete process.env.SHOPEE_FORCE_MANUAL_WAIT
    else process.env.SHOPEE_FORCE_MANUAL_WAIT = prevForce
    if (prevInteractive === undefined) delete process.env.SHOPEE_INTERACTIVE
    else process.env.SHOPEE_INTERACTIVE = prevInteractive
    if (prevCaptchaWait === undefined) delete process.env.SHOPEE_CAPTCHA_WAIT_MS
    else process.env.SHOPEE_CAPTCHA_WAIT_MS = prevCaptchaWait

    try {
      if (browser) await browser.close()
    } catch {
      /* ignore disconnect errors */
    }
  }
}

/** @type {import('../types.mjs').CollectAdapter} */
export const browserbaseAdapter = {
  id: 'browserbase',

  async scrapeSeed(seed, jobId) {
    return scrapeShopeeWithBrowserbase(seed, jobId)
  },
}

export default browserbaseAdapter
