import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { mockCollectAdapter } from '../marketplace/collectors/mock/adapter.mjs'
import { upsertObservationCards } from '../marketplace/writers/upsertObservations.mjs'
import { computeSellerMixMetrics, buildExportTable } from '../marketplace/normalize/metrics.mjs'

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

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const dbUrl = process.env.SUPABASE_DB_URL
if (!url || !key) {
  console.error('missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let workspace_id = null

const { data: ws, error: wsErr } = await db.from('workspaces').select('id').limit(1)
console.log('workspaces via supabase', { count: ws?.length, wsErr: wsErr?.message })

if (ws?.length) {
  workspace_id = ws[0].id
} else if (dbUrl) {
  const sql = postgres(dbUrl, { ssl: 'require', max: 1 })
  const rows = await sql`select id from public.workspaces limit 1`
  if (rows[0]) workspace_id = rows[0].id
  await sql.end({ timeout: 1 })
}

if (!workspace_id) {
  console.error('no workspace found — create a workspace in the app first')
  process.exit(1)
}
console.log('workspace', workspace_id)

const seedRow = {
  workspace_id,
  marketplace: 'shopee',
  country: 'sg',
  mode: 'keyword',
  target: 'anua official',
  enabled: true,
  schedule_kind: 'daily',
  preferred_hour: 2,
  max_pages: 1,
  max_listings: 10,
  detail_top_n: 5,
  priority: 200,
  collector_id: 'mock',
  next_run_at: new Date().toISOString(),
  metadata: { phase2_smoke: true },
}

const { data: seed, error: seedErr } = await db
  .from('marketplace_crawl_seeds')
  .upsert(seedRow, { onConflict: 'workspace_id,marketplace,country,mode,target' })
  .select('*')
  .single()

if (seedErr) {
  console.error('seed', seedErr)
  process.exit(1)
}
console.log('seed', seed.id)

const { data: job, error: jobErr } = await db
  .from('marketplace_crawl_jobs')
  .insert({
    workspace_id,
    seed_id: seed.id,
    marketplace: 'shopee',
    country: 'sg',
    crawl_type: 'keyword',
    target: 'anua official',
    status: 'running',
    priority: 200,
    collector_id: 'mock',
    started_at: new Date().toISOString(),
    claimed_by: 'phase2-smoke',
  })
  .select('*')
  .single()

if (jobErr) {
  console.error('job', jobErr)
  process.exit(1)
}
console.log('job', job.id)

const collect = await mockCollectAdapter.scrapeSeed(
  {
    id: seed.id,
    workspace_id,
    marketplace: 'shopee',
    country: 'sg',
    mode: 'keyword',
    target: 'anua official',
    max_pages: 1,
    max_listings: 10,
    detail_top_n: 5,
  },
  job.id,
)

const write = await upsertObservationCards(db, {
  workspace_id,
  marketplace: 'shopee',
  country: 'sg',
  crawl_job_id: job.id,
  cards: collect.cards,
})
console.log('write', write)

if (write.errors?.length) {
  console.error('WRITE_ERRORS', write.errors)
  process.exit(1)
}

const metrics = computeSellerMixMetrics(
  collect.cards.map((c) => ({
    shop_id: c.shop_id,
    item_id: c.item_id,
    title: c.title,
    seller_type: c.seller_type,
    price: c.price,
    sold_count_lower_bound: c.sold_count_lower_bound,
    rank_position: c.rank_position,
    signals: c.signals || {},
  })),
  { query: 'anua official', country: 'sg' },
)

const metric_date = new Date().toISOString().slice(0, 10)
const { error: metErr } = await db.from('marketplace_metrics_daily').upsert(
  {
    workspace_id,
    metric_date,
    marketplace: 'shopee',
    country: 'sg',
    dimension_type: 'query',
    dimension_key: 'anua official',
    metrics,
  },
  {
    onConflict: 'workspace_id,metric_date,marketplace,country,dimension_type,dimension_key',
  },
)
if (metErr) {
  console.error('metrics', metErr)
  process.exit(1)
}

const exportRows = buildExportTable(
  collect.cards.map((c, i) => ({
    ...c,
    id: `local-${i}`,
    listing_id: null,
    crawled_at: new Date().toISOString(),
  })),
  { query: 'anua official' },
)

await db
  .from('marketplace_crawl_jobs')
  .update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    total_targets: collect.cards.length,
    processed_targets: write.snapshots_inserted,
    summary: {
      write,
      metrics_sample: {
        official_store_share_pct: metrics.seller_mix.official_store_share_pct,
        undercut_count: metrics.reseller_pressure.undercut_count,
      },
      export_row_count: exportRows.length,
      phase2_smoke: true,
    },
  })
  .eq('id', job.id)

const { count } = await db
  .from('marketplace_listing_snapshots')
  .select('*', { count: 'exact', head: true })
  .eq('crawl_job_id', job.id)

console.log({
  snapshots_for_job: count,
  official_store_share_pct: metrics.seller_mix.official_store_share_pct,
  undercut_count: metrics.reseller_pressure.undercut_count,
  export_rows: exportRows.length,
})

if (!count || count < 1) {
  console.error('expected snapshots')
  process.exit(1)
}

console.log('SMOKE_OK')
process.exit(0)
