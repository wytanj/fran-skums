/**
 * Captcha recovery helper: kill the CDP Chrome window, relaunch warm profile, settle.
 *
 * Intended flow when a Shopee wall appears (single harvest Chrome only):
 *   1. Close Chrome
 *   2. Wait ~2s
 *   3. Start Chrome with --remote-debugging-port + same user-data-dir
 *   4. Wait for CDP, then ~10s settle before harvest re-attaches
 *
 * Windows-focused (taskkill / chrome.exe). Safe to call from queue or cycle.
 */

import { execSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PORT = 9222

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function findChromeExe() {
  const candidates = [
    join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    join(
      process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
      'Google\\Chrome\\Application\\chrome.exe',
    ),
    join(
      process.env.LOCALAPPDATA || '',
      'Google\\Chrome\\Application\\chrome.exe',
    ),
  ]
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  return null
}

/**
 * Force-stop all chrome.exe (user said this is the only window).
 */
export function killAllChrome() {
  try {
    execSync('taskkill /IM chrome.exe /F', {
      windowsHide: true,
      stdio: 'ignore',
    })
  } catch {
    /* no chrome or already gone */
  }
}

/**
 * Clear profile locks so a fresh Chrome can take the same user-data-dir.
 * @param {string} profileDir
 */
export function clearProfileLocks(profileDir) {
  if (!profileDir) return
  mkdirSync(profileDir, { recursive: true })
  for (const name of [
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
    'DevToolsActivePort',
  ]) {
    try {
      unlinkSync(join(profileDir, name))
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {number} port
 * @param {number} timeoutMs
 */
export async function waitForCdp(port = DEFAULT_PORT, timeoutMs = 25000) {
  const url = `http://127.0.0.1:${port}/json/version`
  const deadline = Date.now() + timeoutMs
  let lastErr = null
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (res.ok) return true
    } catch (e) {
      lastErr = e
    }
    await sleep(800)
  }
  throw new Error(
    `CDP not up on :${port} within ${timeoutMs}ms${lastErr ? `: ${lastErr.message || lastErr}` : ''}`,
  )
}

/**
 * Launch Chrome with remote debugging on the harvest profile.
 * @param {{
 *   profileDir: string
 *   port?: number
 *   startUrl?: string
 * }} opts
 */
export function launchChromeCdp(opts) {
  const port = opts.port || DEFAULT_PORT
  const profileDir = opts.profileDir
  const startUrl = opts.startUrl || 'https://shopee.sg/'
  const chrome = findChromeExe()
  if (!chrome) throw new Error('chrome.exe not found')
  mkdirSync(profileDir, { recursive: true })
  clearProfileLocks(profileDir)

  // Quote user-data-dir for paths with spaces (e.g. Jeremy Tan).
  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    startUrl,
  ]

  const child = spawn(chrome, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()
  return { chrome, args, pid: child.pid }
}

/**
 * Full bounce: kill → short wait → launch → CDP ready → settle.
 *
 * @param {{
 *   profileDir: string
 *   port?: number
 *   killWaitMs?: number
 *   settleMs?: number
 *   startUrl?: string
 *   log?: (msg: string) => void
 * }} opts
 */
export async function bounceChromeCdp(opts) {
  const port = opts.port || DEFAULT_PORT
  const killWaitMs = opts.killWaitMs ?? 2500
  const settleMs = opts.settleMs ?? 10000
  const log = opts.log || ((m) => console.error(m))

  log(`[chrome-bounce] closing Chrome (captcha recovery)…`)
  killAllChrome()
  await sleep(killWaitMs)

  log(`[chrome-bounce] starting Chrome CDP :${port} profile=${opts.profileDir}`)
  launchChromeCdp({
    profileDir: opts.profileDir,
    port,
    startUrl: opts.startUrl,
  })

  await waitForCdp(port, 30000)
  log(`[chrome-bounce] CDP up — settling ${Math.round(settleMs / 1000)}s before resume…`)
  await sleep(settleMs)
  log(`[chrome-bounce] ready`)
  return { port, browserURL: `http://127.0.0.1:${port}` }
}

/**
 * Default profile path under repo root (same as mall-brand-cycle / start script).
 * @param {string} [root]
 */
export function defaultShopeeProfileDir(root) {
  const base =
    root ||
    resolve(fileURLToPath(new URL('..', import.meta.url)))
  return resolve(base, '.shopee-chrome-profile')
}
