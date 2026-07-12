/**
 * Live Shopee collect via Browserbase (cloud browser + optional residential proxy).
 *
 * Usage (repo root):
 *   node scripts/_smoke_shopee_browserbase.mjs
 *
 * Requires:
 *   BROWSERBASE_API_KEY
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FRAN_MCP_WORKSPACE_ID
 *
 * Optional:
 *   BROWSERBASE_PROXIES=1|0          (default 1, SG geolocation)
 *   BROWSERBASE_REGION=ap-southeast-1
 *   BROWSERBASE_SOLVE_CAPTCHAS=1
 *   BROWSERBASE_ADVANCED_STEALTH=1   (if your plan supports it)
 *   SHOPEE_SMOKE_QUERY=anua
 *   SHOPEE_SKIP_HOME=1               (default 1 — open search SERP first)
 *
 * Does NOT use local Chrome or sample-cookie.json.
 * Watch the session live: https://browserbase.com/sessions/<id>
 */
import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { scrapeShopeeWithBrowserbase } from '../marketplace/collectors/browserbase/adapter.mjs'
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

// Cloud path: no local cookie inject by default (can re-enable via env if desired).
if (process.env.SHOPEE_USE_COOKIE_FILE === '1' && existsSync('sample-cookie.json')) {
  process.env.SHOPEE_SG_SESSION_JSON = readFileSync('sample-cookie.json', 'utf8')
  console.log('loaded sample-cookie.json into SHOPEE_SG_SESSION_JSON')
} else {
  delete process.env.SHOPEE_SG_SESSION_JSON
}

if (!process.env.BROWSERBASE_API_KEY) {
  console.error('missing BROWSERBASE_API_KEY in .env')
  process.exit(1)
}

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const workspace_id = process.env.FRAN_MCP_WORKSPACE_ID
if (!url || !key || !workspace_id) {
  console.error('need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FRAN_MCP_WORKSPACE_ID')
  process.exit(1)
}

const query = (process.env.SHOPEE_SMOKE_QUERY || 'anua').trim()
if (process.env.SHOPEE_SKIP_HOME === undefined) process.env.SHOPEE_SKIP_HOME = '1'

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const seedPatch = {
  collector_id: 'browserbase',
  max_pages: 1,
  max_listings: 20,
  detail_top_n: 5,
  enabled: true,
  schedule_kind: 'daily',
  preferred_hour: 2,
  next_run_at: new Date().toISOString(),
  metadata: {
    live_smoke: true,
    source: 'browserbase',
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
    collector_id: 'browserbase',
    started_at: new Date().toISOString(),
    claimed_by: 'live-smoke-browserbase',
  })
  .select('*')
  .single()
if (jobErr) {
  console.error('job', jobErr)
  process.exit(1)
}
console.log('job', job.id)
console.log('---')
console.log('BROWSERBASE SMOKE')
console.log('  proxies:', process.env.BROWSERBASE_PROXIES !== '0')
console.log('  region:', process.env.BROWSERBASE_REGION || 'ap-southeast-1')
console.log('  solve_captchas:', process.env.BROWSERBASE_SOLVE_CAPTCHAS !== '0')
console.log('  query:', query)
console.log('  skip_home:', process.env.SHOPEE_SKIP_HOME)
console.log('---')

let collect
try {
  collect = await scrapeShopeeWithBrowserbase(
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
  )
} catch (err) {
  const message = err?.message?.slice(0, 800) || String(err)
  console.error('SCRAPE_FAIL', message)
  await db
    .from('marketplace_crawl_jobs')
    .update({
      status: 'failed',
      error: message,
      completed_at: new Date().toISOString(),
    })
    .eq('id', job.id)
  process.exit(1)
}

console.log('session_health', collect.session_health)
console.log('cards', collect.cards?.length ?? 0)
if (collect.browserbase_session_id) {
  console.log(
    'session_replay',
    `https://browserbase.com/sessions/${collect.browserbase_session_id}`,
  )
}

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
        browserbase_session_id: collect.browserbase_session_id,
        source: 'browserbase',
      },
    })
    .eq('id', job.id)
  await db
    .from('marketplace_crawl_seeds')
    .update({
      last_error: `session_health=${collect.session_health}`,
      consecutive_failures: (seed.consecutive_failures || 0) + 1,
      collector_id: 'browserbase',
    })
    .eq('id', seed.id)
  console.log('LIVE_SESSION_BAD')
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
      source: 'browserbase',
      browserbase_session_id: collect.browserbase_session_id,
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
    collector_id: 'browserbase',
  })
  .eq('id', seed.id)

if (!write.snapshots_inserted) {
  console.log('LIVE_SMOKE_EMPTY')
  process.exit(3)
}
console.log('LIVE_SMOKE_OK')
process.exit(0)
