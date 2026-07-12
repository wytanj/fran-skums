/**
 * Local live Shopee collect smoke.
 * Loads cookies from ./sample-cookie.json (not committed).
 *
 * Usage: node scripts/_smoke_shopee_live.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
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

if (!existsSync('sample-cookie.json')) {
  console.error('missing sample-cookie.json in repo root')
  process.exit(1)
}
process.env.SHOPEE_SG_SESSION_JSON = readFileSync('sample-cookie.json', 'utf8')

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const workspace_id = process.env.FRAN_MCP_WORKSPACE_ID
if (!url || !key || !workspace_id) {
  console.error('need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FRAN_MCP_WORKSPACE_ID')
  process.exit(1)
}

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
  metadata: { live_smoke: true, source: 'sample-cookie.json' },
}

let seed
{
  const { data: seeds, error } = await db
    .from('marketplace_crawl_seeds')
    .update(seedPatch)
    .eq('workspace_id', workspace_id)
    .eq('target', 'anua official')
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
        target: 'anua official',
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
    claimed_by: 'live-smoke-local',
  })
  .select('*')
  .single()
if (jobErr) {
  console.error('job', jobErr)
  process.exit(1)
}
console.log('job', job.id)

// Default interactive so you can solve Shopee captcha in the opened Chrome window.
// Run this in YOUR terminal (not headless CI) so you can click captcha + press Enter.
// SHOPEE_INTERACTIVE=0 for fully unattended (will fail on traffic/captcha walls).
if (process.env.SHOPEE_INTERACTIVE === undefined) process.env.SHOPEE_INTERACTIVE = '1'
if (process.env.SHOPEE_CAPTCHA_WAIT_MS === undefined) process.env.SHOPEE_CAPTCHA_WAIT_MS = '300000'
const interactive = process.env.SHOPEE_INTERACTIVE !== '0'
console.log('interactive', interactive, 'captcha_wait_ms', process.env.SHOPEE_CAPTCHA_WAIT_MS)
console.log(
  'If Chrome shows captcha/traffic wall: solve it until you can see the homepage or search results, then press Enter in this terminal.',
)
let browser = null
const browserApi = {
  async getBrowser() {
    if (browser) return browser
    const opts = {
      headless: interactive ? false : true,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080',
        '--no-first-run',
        '--no-default-browser-check',
      ],
      defaultViewport: interactive ? null : { width: 1920, height: 1080 },
      channel: 'chrome',
    }
    try {
      browser = await puppeteer.launch(opts)
    } catch {
      delete opts.channel
      browser = await puppeteer.launch(opts)
    }
    return browser
  },
  async createStealthPage(b) {
    const page = await b.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    )
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

console.log('scraping shopee.sg for', seed.target, '...')
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
process.exit(0)
