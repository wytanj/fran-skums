/**
 * Local live Shopee collect via persistent Chrome profile (no cookie export).
 *
 * Why: setCookie-from-export still hits /verify/traffic even when is_logged_in=true.
 * A real userDataDir session (login once by hand in *this* Chrome) has better odds.
 *
 * Usage (from repo root, real terminal — Chrome + stdin must work):
 *
 *   node scripts/_smoke_shopee_profile.mjs
 *
 * Default flow (direct SERP — captcha usually shows on search, not home):
 *   1. Chrome opens with profile ./.shopee-chrome-profile (gitignored)
 *   2. Opens https://shopee.sg/search?keyword=… and STAYS OPEN
 *   3. You log in / solve captcha until listings show
 *   4. Press Enter in this terminal (required — does not auto-continue)
 *   5. Collects cards + writes snapshots
 *
 * On failure the window also stays open until you press Enter (so you can look).
 *
 * Env:
 *   SHOPEE_PROFILE_DIR       default: .shopee-chrome-profile
 *   SHOPEE_INTERACTIVE       default: 1
 *   SHOPEE_FORCE_MANUAL_WAIT default: 1 (always wait for Enter)
 *   SHOPEE_SKIP_HOME         default: 1 (go straight to search URL)
 *   SHOPEE_CAPTCHA_WAIT_MS   default: 600000
 *   SHOPEE_SMOKE_QUERY       default: anua
 *   SHOPEE_HOLD_ON_FAIL      default: 1 (keep Chrome open until Enter after fail)
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FRAN_MCP_WORKSPACE_ID
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer'
import { scrapeShopeeWithPuppeteer } from '../marketplace/collectors/shopee-puppeteer/adapter.mjs'
import { upsertObservationCards } from '../marketplace/writers/upsertObservations.mjs'

function loadEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m || process.env[m[1]] !== undefined) continue
    let v = m[2].trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    process.env[m[1]] = v
  }
}

loadEnv()

// Critical: do NOT inject exported cookies into a warm profile — they can
// fight real profile session storage and still look like automation.
delete process.env.SHOPEE_SG_SESSION_JSON
delete process.env.SHOPEE_PH_SESSION_JSON
delete process.env.SHOPEE_MY_SESSION_JSON

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const workspace_id = process.env.FRAN_MCP_WORKSPACE_ID
if (!url || !key || !workspace_id) {
  console.error('need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FRAN_MCP_WORKSPACE_ID')
  process.exit(1)
}

const profileDir = resolve(
  process.cwd(),
  process.env.SHOPEE_PROFILE_DIR || '.shopee-chrome-profile',
)
mkdirSync(profileDir, { recursive: true })

// Shorter default keyword — same SERP surface as "anua official", fewer weird tokens.
const query = (process.env.SHOPEE_SMOKE_QUERY || 'anua').trim()

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const seedPatch = {
  collector_id: 'shopee_puppeteer',
  max_pages: 1,
  max_listings: 20,
  detail_top_n: 5,
  enabled: true,
  schedule_kind: 'daily',
  preferred_hour: 2,
  next_run_at: new Date().toISOString(),
  metadata: {
    live_smoke: true,
    source: 'userDataDir',
    profile_dir: profileDir,
  },
}

let seed
{
  const { data: seeds, error } = await db
    .from('marketplace_crawl_seeds')
    .update(seedPatch)
    .eq('workspace_id', workspace_id)
    .eq('target', query)
    .select('*')
  if (error) {
    console.error('seed update', error)
    process.exit(1)
  }
  seed = seeds?.[0]
  if (!seed) {
    const { data: created, error: insErr } = await db
      .from('marketplace_crawl_seeds')
      .insert({
        workspace_id,
        marketplace: 'shopee',
        country: 'sg',
        mode: 'keyword',
        target: query,
        priority: 200,
        ...seedPatch,
      })
      .select('*')
      .single()
    if (insErr) {
      console.error('seed insert', insErr)
      process.exit(1)
    }
    seed = created
  }
}
console.log('seed', {
  id: seed.id,
  target: seed.target,
  collector: seed.collector_id,
  max_pages: seed.max_pages,
  max_listings: seed.max_listings,
})

const { data: job, error: jobErr } = await db
  .from('marketplace_crawl_jobs')
  .insert({
    workspace_id,
    seed_id: seed.id,
    marketplace: 'shopee',
    country: 'sg',
    crawl_type: 'keyword',
    target: seed.target,
    status: 'running',
    priority: 200,
    collector_id: 'shopee_puppeteer',
    started_at: new Date().toISOString(),
    claimed_by: 'live-smoke-profile',
  })
  .select('*')
  .single()
if (jobErr) {
  console.error('job', jobErr)
  process.exit(1)
}
console.log('job', job.id)

// Always interactive for profile path — login is the whole point.
if (process.env.SHOPEE_INTERACTIVE === undefined) process.env.SHOPEE_INTERACTIVE = '1'
if (process.env.SHOPEE_CAPTCHA_WAIT_MS === undefined) process.env.SHOPEE_CAPTCHA_WAIT_MS = '600000'
// Do not auto-skip the pause when the page looks "ok" (that closed the window last time).
if (process.env.SHOPEE_FORCE_MANUAL_WAIT === undefined) process.env.SHOPEE_FORCE_MANUAL_WAIT = '1'
// Captcha / traffic wall usually fires on search, not the marketing homepage.
if (process.env.SHOPEE_SKIP_HOME === undefined) process.env.SHOPEE_SKIP_HOME = '1'
if (process.env.SHOPEE_HOLD_ON_FAIL === undefined) process.env.SHOPEE_HOLD_ON_FAIL = '1'
const interactive = process.env.SHOPEE_INTERACTIVE !== '0'
const holdOnFail = process.env.SHOPEE_HOLD_ON_FAIL !== '0'

async function waitForEnter(label) {
  if (!process.stdin.isTTY) {
    console.error(`[hold] ${label}: no TTY — waiting 60s`)
    await new Promise((r) => setTimeout(r, 60_000))
    return
  }
  console.error(`[hold] ${label}: press Enter to continue / close…`)
  await new Promise((resolve) => {
    const onData = (buf) => {
      if (String(buf).includes('\n') || String(buf).includes('\r')) {
        process.stdin.off('data', onData)
        process.stdin.pause()
        resolve()
      }
    }
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', onData)
  })
}

console.log('---')
console.log('PROFILE SMOKE (no cookie file inject)')
console.log('  profile:', profileDir)
console.log('  interactive:', interactive)
console.log('  force_manual_wait:', process.env.SHOPEE_FORCE_MANUAL_WAIT)
console.log('  skip_home (direct SERP):', process.env.SHOPEE_SKIP_HOME)
console.log('  captcha_wait_ms:', process.env.SHOPEE_CAPTCHA_WAIT_MS)
console.log('  query:', query)
console.log('  search URL: https://shopee.sg/search?keyword=' + encodeURIComponent(query))
console.log('---')
console.log('Chrome will open and go straight to search.')
console.log('1) Log in / solve captcha until product cards are visible')
console.log('2) Press Enter in THIS terminal (required — window will not auto-close early)')
console.log('3) On failure, Chrome stays open so you can inspect; Enter closes')
console.log('Tip: close other Chrome using this profile if launch fails.')
console.log('---')

let browser = null
const browserApi = {
  async getBrowser() {
    if (browser) return browser
    const opts = {
      headless: interactive ? false : true,
      userDataDir: profileDir,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080',
        '--no-first-run',
        '--no-default-browser-check',
        // Avoid "profile in use" fights with a parallel normal Chrome slightly
        '--disable-features=Translate,OptimizationHints',
      ],
      defaultViewport: interactive ? null : { width: 1920, height: 1080 },
      channel: 'chrome',
    }
    try {
      browser = await puppeteer.launch(opts)
    } catch (err) {
      const msg = err?.message || String(err)
      if (/user data|profile|already|lock/i.test(msg)) {
        console.error(
          'Chrome profile locked. Close any Chrome using this profile, then retry:\n ',
          profileDir,
        )
      }
      // Fallback without channel (bundled Chromium — worse fingerprint, last resort)
      try {
        delete opts.channel
        console.error('retry launch without channel:chrome …', msg.slice(0, 200))
        browser = await puppeteer.launch(opts)
      } catch (err2) {
        console.error('launch failed', err2?.message || err2)
        process.exit(1)
      }
    }
    return browser
  },
  async createStealthPage(b) {
    const page = await b.newPage()
    // Let the real Chrome profile own UA / language — do not override UA
    // (mismatched UA + profile cookies is a bot signal).
    if (!interactive) {
      await page.setViewport({ width: 1920, height: 1080 })
    }
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })
    page.setDefaultNavigationTimeout(90000)
    page.setDefaultTimeout(45000)
    return page
  },
}

console.log('scraping shopee.sg for', seed.target, '…')
let collect
try {
  collect = await scrapeShopeeWithPuppeteer(
    {
      id: seed.id,
      workspace_id,
      marketplace: 'shopee',
      country: 'sg',
      mode: 'keyword',
      target: seed.target,
      max_pages: seed.max_pages,
      max_listings: seed.max_listings,
      detail_top_n: seed.detail_top_n,
      metadata: seed.metadata || {},
    },
    job.id,
    browserApi,
  )
} catch (err) {
  const message = err?.message?.slice(0, 500) || String(err)
  console.error('SCRAPE_FAIL', message)
  await db
    .from('marketplace_crawl_jobs')
    .update({
      status: 'failed',
      error: message,
      completed_at: new Date().toISOString(),
    })
    .eq('id', job.id)
  if (holdOnFail && browser) await waitForEnter('after SCRAPE_FAIL')
  if (browser) await browser.close().catch(() => {})
  process.exit(1)
}

console.log('session_health', collect.session_health)
console.log('cards', collect.cards?.length ?? 0)

if (collect.cards?.length) {
  const mix = {}
  for (const c of collect.cards) {
    const k = c.seller_type || 'unknown'
    mix[k] = (mix[k] || 0) + 1
  }
  console.log('seller_mix', mix)
  console.log(
    'sample',
    collect.cards.slice(0, 8).map((c) => ({
      rank: c.rank_position,
      seller: c.seller_type,
      price: c.price,
      sold_lb: c.sold_count_lower_bound,
      title: (c.title || '').slice(0, 55),
      shop_id: c.shop_id,
      item_id: c.item_id,
    })),
  )
}

if (collect.session_health && collect.session_health !== 'ok') {
  await db
    .from('marketplace_crawl_jobs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: `session_health=${collect.session_health}`,
      summary: {
        session_health: collect.session_health,
        cards: collect.cards?.length ?? 0,
        source: 'userDataDir',
      },
    })
    .eq('id', job.id)
  await db
    .from('marketplace_crawl_seeds')
    .update({
      last_error: `session_health=${collect.session_health}`,
      consecutive_failures: (seed.consecutive_failures || 0) + 1,
    })
    .eq('id', seed.id)
  console.log('LIVE_SESSION_BAD')
  console.log(
    'Profile kept at',
    profileDir,
    '— inspect the open Chrome window (traffic wall vs blank vs login).',
  )
  if (holdOnFail && browser) await waitForEnter('after LIVE_SESSION_BAD')
  if (browser) await browser.close().catch(() => {})
  process.exit(2)
}

const write = await upsertObservationCards(db, {
  workspace_id,
  marketplace: 'shopee',
  country: 'sg',
  crawl_job_id: job.id,
  cards: collect.cards || [],
})
console.log('write', write)

await db
  .from('marketplace_crawl_jobs')
  .update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    total_targets: collect.cards?.length ?? 0,
    processed_targets: write.snapshots_inserted,
    failed_targets: write.errors?.length || 0,
    summary: {
      session_health: collect.session_health,
      cards: collect.cards?.length ?? 0,
      write,
      live_smoke: true,
      source: 'userDataDir',
    },
    error: write.errors?.length ? write.errors.slice(0, 3).join('; ') : null,
  })
  .eq('id', job.id)

await db
  .from('marketplace_crawl_seeds')
  .update({
    last_success_at: new Date().toISOString(),
    last_error: null,
    consecutive_failures: 0,
    collector_id: 'shopee_puppeteer',
  })
  .eq('id', seed.id)

if (browser) await browser.close().catch(() => {})

if (!write.snapshots_inserted) {
  console.log('LIVE_SMOKE_EMPTY')
  process.exit(3)
}
console.log('LIVE_SMOKE_OK')
console.log('profile reused next time:', profileDir)
process.exit(0)
