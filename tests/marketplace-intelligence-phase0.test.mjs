import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseSoldLabel } from '../marketplace/soldLabel.mjs'
import {
  deriveDropshipSignals,
  isTrustedSellerTier,
  normalizeSellerType,
  sellerTypeFromBadges,
} from '../marketplace/sellerTaxonomy.mjs'
import {
  buildJobFromSeed,
  computeNextRunAt,
  isSeedDue,
  seedPatchAfterEnqueue,
} from '../marketplace/scheduler.mjs'
import { getCollectAdapter, listCollectAdapterIds } from '../marketplace/collectors/registry.mjs'

const core047 = readFileSync(new URL('../core/db/047_marketplace_intelligence.sql', import.meta.url), 'utf8')
const core048 = readFileSync(new URL('../core/db/048_study_pipeline.sql', import.meta.url), 'utf8')
const sb047 = readFileSync(
  new URL('../supabase/migrations/202607100047_marketplace_intelligence.sql', import.meta.url),
  'utf8',
)
const sb048 = readFileSync(
  new URL('../supabase/migrations/202607100048_study_pipeline.sql', import.meta.url),
  'utf8',
)
const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')
const supabaseReadme = readFileSync(new URL('../supabase/migrations/README.md', import.meta.url), 'utf8')
const typesMarketplace = readFileSync(
  new URL('../packages/@skums-types/marketplace-intelligence.ts', import.meta.url),
  'utf8',
)
const typesStudy = readFileSync(new URL('../packages/@skums-types/study-pipeline.ts', import.meta.url), 'utf8')
const typesIndex = readFileSync(new URL('../packages/@skums-types/index.ts', import.meta.url), 'utf8')
const majorUpdate = readFileSync(new URL('../Major Update.md', import.meta.url), 'utf8')
const schedulerUtil = readFileSync(new URL('../server/utils/marketplaceScheduler.ts', import.meta.url), 'utf8')
const tickRoute = readFileSync(
  new URL('../server/api/internal/marketplace/scheduler-tick.post.ts', import.meta.url),
  'utf8',
)
const seedsGet = readFileSync(new URL('../server/api/v1/marketplace/seeds.get.ts', import.meta.url), 'utf8')
const seedsPost = readFileSync(new URL('../server/api/v1/marketplace/seeds.post.ts', import.meta.url), 'utf8')
const seedsRun = readFileSync(
  new URL('../server/api/v1/marketplace/seeds/[id]/run.post.ts', import.meta.url),
  'utf8',
)
const jobsGet = readFileSync(new URL('../server/api/v1/marketplace/jobs.get.ts', import.meta.url), 'utf8')
const nuxtConfig = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')

test('marketplace migrations registered and mirrored', () => {
  assert.match(migrationsDoc, /047\s+\|\s+marketplace_intelligence\.sql/)
  assert.match(migrationsDoc, /048\s+\|\s+study_pipeline\.sql/)
  assert.match(supabaseReadme, /202607100047_marketplace_intelligence\.sql/)
  assert.match(supabaseReadme, /202607100048_study_pipeline\.sql/)
  assert.equal(core047, sb047)
  assert.equal(core048, sb048)
})

test('047 creates BI warehouse tables with RLS', () => {
  for (const table of [
    'marketplace_crawl_seeds',
    'marketplace_crawl_jobs',
    'marketplace_shops',
    'marketplace_listings',
    'marketplace_listing_snapshots',
    'marketplace_metrics_daily',
    'bi_digests',
    'bi_alerts',
  ]) {
    assert.match(core047, new RegExp(`create table if not exists public\\.${table}`))
    assert.match(core047, new RegExp(`alter table public\\.${table} enable row level security`))
    assert.match(core047, new RegExp(`grant select, insert, update, delete on table public\\.${table}`))
  }
  assert.match(core047, /schedule_kind in \('daily', 'weekly', 'cron', 'manual_only'\)/)
  assert.match(core047, /seller_type in \(/)
  assert.match(core047, /'mall'/)
  assert.match(core047, /'preferred_plus'/)
  assert.match(core047, /sold_count_lower_bound/)
})

test('048 creates study and pipeline tables with RLS', () => {
  for (const table of ['study_sessions', 'study_artifacts', 'pipeline_candidates']) {
    assert.match(core048, new RegExp(`create table if not exists public\\.${table}`))
    assert.match(core048, new RegExp(`alter table public\\.${table} enable row level security`))
  }
  assert.match(core048, /watchlist_seed/)
  assert.match(core048, /purchase_interest/)
  assert.match(core048, /catalog_product/)
})

test('shared types export marketplace and study contracts', () => {
  assert.match(typesIndex, /marketplace-intelligence/)
  assert.match(typesIndex, /study-pipeline/)
  assert.match(typesMarketplace, /export type SellerType/)
  assert.match(typesMarketplace, /export interface CollectAdapter/)
  assert.match(typesMarketplace, /export interface MarketplaceCrawlSeed/)
  assert.match(typesStudy, /export type PipelineCandidateKind/)
  assert.match(typesStudy, /export interface GroundedGrokResult/)
  assert.match(typesStudy, /numbers_from_model_only: false/)
})

test('parseSoldLabel handles buckets and exact counts', () => {
  assert.deepEqual(parseSoldLabel('5.2k sold'), {
    label: '5.2k sold',
    lower_bound: 5200,
    is_bucket: true,
  })
  assert.equal(parseSoldLabel('1.1k+ sold').lower_bound, 1100)
  assert.equal(parseSoldLabel('1.2M sold').lower_bound, 1_200_000)
  assert.equal(parseSoldLabel('456 sold').lower_bound, 456)
  assert.equal(parseSoldLabel(null).lower_bound, null)
  assert.equal(parseSoldLabel('').lower_bound, null)
})

test('seller taxonomy normalizes badges and dropship signals', () => {
  assert.equal(normalizeSellerType('Shopee Mall'), 'mall')
  assert.equal(normalizeSellerType('Preferred+'), 'preferred_plus')
  assert.equal(normalizeSellerType('preferred'), 'preferred')
  assert.equal(normalizeSellerType('official store'), 'official_brand')
  assert.equal(sellerTypeFromBadges(['Preferred Seller']), 'preferred')
  assert.equal(sellerTypeFromBadges(['Shopee Mall']), 'mall')
  assert.equal(sellerTypeFromBadges([], { is_official_shop: true }), 'official_brand')
  assert.equal(isTrustedSellerTier('mall'), true)
  assert.equal(isTrustedSellerTier('normal'), false)

  const signals = deriveDropshipSignals({
    location: 'Mainland China',
    preorder_days: 7,
    title_clone_of_official: true,
  })
  assert.equal(signals.ships_from_overseas, true)
  assert.equal(signals.preorder, true)
  assert.equal(signals.title_clone_of_official, true)
})

test('scheduler computes daily/weekly next runs and builds jobs', () => {
  const now = new Date('2026-07-10T04:00:00.000Z')

  const dailyNext = computeNextRunAt(now, { schedule_kind: 'daily', preferred_hour: 2 })
  assert.ok(dailyNext instanceof Date)
  assert.ok(dailyNext > now)
  assert.equal(dailyNext.getUTCHours(), 2)

  const weeklyNext = computeNextRunAt(now, {
    schedule_kind: 'weekly',
    preferred_hour: 3,
    weekly_day: 1,
  })
  assert.equal(weeklyNext.getUTCDay(), 1)
  assert.equal(weeklyNext.getUTCHours(), 3)

  assert.equal(computeNextRunAt(now, { schedule_kind: 'manual_only' }), null)

  const seed = {
    id: 'seed-1',
    workspace_id: 'ws-1',
    marketplace: 'shopee',
    country: 'sg',
    mode: 'keyword',
    target: 'anua official',
    enabled: true,
    schedule_kind: 'daily',
    preferred_hour: 2,
    priority: 10,
    collector_id: 'mock',
    next_run_at: '2026-07-09T02:00:00.000Z',
  }

  assert.equal(isSeedDue(seed, now), true)
  assert.equal(isSeedDue({ ...seed, next_run_at: '2026-07-11T02:00:00.000Z' }, now), false)
  assert.equal(isSeedDue({ ...seed, enabled: false }, now), false)

  const job = buildJobFromSeed(seed, now)
  assert.equal(job.status, 'pending')
  assert.equal(job.target, 'anua official')
  assert.equal(job.seed_id, 'seed-1')
  assert.equal(job.collector_id, 'mock')

  const patch = seedPatchAfterEnqueue(seed, now)
  assert.ok(patch.last_enqueued_at)
  assert.ok(patch.next_run_at)
  assert.ok(new Date(patch.next_run_at) > now)
})

test('mock collect adapter returns Mall / Preferred / normal fixtures', async () => {
  assert.ok(listCollectAdapterIds().includes('mock'))
  const adapter = getCollectAdapter('mock')
  assert.ok(adapter)

  const result = await adapter.scrapeSeed(
    {
      id: 'seed-demo',
      workspace_id: 'ws',
      marketplace: 'shopee',
      country: 'sg',
      mode: 'keyword',
      target: 'anua official',
      max_pages: 1,
      max_listings: 10,
      detail_top_n: 5,
    },
    'job-1',
  )

  assert.equal(result.session_health, 'ok')
  assert.equal(result.cards.length, 3)
  assert.equal(result.cards[0].seller_type, 'mall')
  assert.equal(result.cards[1].seller_type, 'preferred')
  assert.equal(result.cards[2].seller_type, 'normal')
  assert.ok(result.cards[0].sold_count_lower_bound >= 5000)
  assert.equal(result.cards[2].signals?.ships_from_overseas, true)
})

test('scheduler tick route and seed APIs are wired', () => {
  assert.match(schedulerUtil, /enqueueDueMarketplaceSeeds/)
  assert.match(schedulerUtil, /marketplace_crawl_seeds/)
  assert.match(schedulerUtil, /marketplace_crawl_jobs/)
  assert.match(tickRoute, /marketplaceCronSecret|queueProcessorKey/)
  assert.match(tickRoute, /enqueueDueMarketplaceSeeds/)
  assert.match(seedsGet, /intel:read/)
  assert.match(seedsPost, /intel:write/)
  assert.match(seedsPost, /computeNextRunAt/)
  assert.match(seedsRun, /run_now|buildJobFromSeed/)
  assert.match(jobsGet, /marketplace_crawl_jobs/)
  assert.match(nuxtConfig, /marketplaceCronSecret/)
})

test('Major Update documents phase 0 start', () => {
  assert.match(majorUpdate, /Phase 0/)
  assert.match(majorUpdate, /marketplace_crawl_seeds/)
  assert.match(majorUpdate, /Fran MCP/)
  assert.match(majorUpdate, /internal purchase orders/i)
})
