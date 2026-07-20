import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { mockCollectAdapter } from '../marketplace/collectors/mock/adapter.mjs'
import { processMarketplaceJobs } from '../marketplace/processJobs.mjs'
import {
  interSeedSleepMs,
  isSessionStopHealth,
  resolveBrandIdentityFromSeed,
  stampBrandSignalsOnCards,
} from '../marketplace/stampBrandSignals.mjs'
import {
  mostRecentSundayUtc,
  runWeeklyPipeline,
} from '../scripts/windows-marketplace-weekly.mjs'

const collectUtil = readFileSync(
  new URL('../server/utils/marketplaceCollect.ts', import.meta.url),
  'utf8',
)
const processCore = readFileSync(
  new URL('../marketplace/processJobs.mjs', import.meta.url),
  'utf8',
)
const processRoute = readFileSync(
  new URL('../server/api/internal/marketplace/process-jobs.post.ts', import.meta.url),
  'utf8',
)
const weeklyDigestRoute = readFileSync(
  new URL('../server/api/internal/marketplace/weekly-digest.post.ts', import.meta.url),
  'utf8',
)
const weeklyScript = readFileSync(
  new URL('../scripts/windows-marketplace-weekly.mjs', import.meta.url),
  'utf8',
)
const weeklyPs1 = readFileSync(
  new URL('../scripts/windows-marketplace-weekly.ps1', import.meta.url),
  'utf8',
)
const readme = readFileSync(new URL('../marketplace/README.md', import.meta.url), 'utf8')
const puppeteer = readFileSync(
  new URL('../marketplace/collectors/shopee-puppeteer/adapter.mjs', import.meta.url),
  'utf8',
)

test('processMarketplaceJobs implements stop_batch + INTER_SEED + stamp', () => {
  assert.match(processCore, /stop_batch/)
  assert.match(processCore, /isSessionStopHealth/)
  assert.match(processCore, /stampBrandSignalsOnCards/)
  assert.match(processCore, /interSeedSleepMs/)
  assert.match(processCore, /batch_stopped/)
  assert.match(collectUtil, /processJobsCore|processJobs/)
  assert.match(processRoute, /processMarketplaceJobs/)
})

test('weekly-digest endpoint + weekly scripts exist', () => {
  assert.match(weeklyDigestRoute, /weekly_digest_write_deferred_to_pr6|week_key/)
  assert.match(weeklyScript, /stop_batch/)
  assert.match(weeklyScript, /metrics-tick/)
  assert.match(weeklyScript, /weekly-digest/)
  assert.match(weeklyScript, /exit_code/)
  assert.match(weeklyPs1, /windows-marketplace-weekly\.mjs/)
  assert.match(readme, /windows-marketplace-weekly|G1|stop_batch/)
})

test('puppeteer documents detail_top_n <= 0 SERP-only', () => {
  assert.match(puppeteer, /detail_top_n/)
  assert.match(puppeteer, /SERP/)
})

test('isSessionStopHealth', () => {
  assert.equal(isSessionStopHealth('login_required'), true)
  assert.equal(isSessionStopHealth('blocked'), true)
  assert.equal(isSessionStopHealth('ok'), false)
  assert.equal(isSessionStopHealth('unknown'), false)
})

test('interSeedSleepMs only for shopee_puppeteer', () => {
  assert.equal(interSeedSleepMs('mock', {}), 0)
  assert.equal(interSeedSleepMs('shopee_puppeteer', {}), 8000)
  assert.equal(interSeedSleepMs('shopee_puppeteer', { SHOPEE_INTER_SEED_MS: '100' }), 100)
  assert.equal(interSeedSleepMs('browserbase', { SHOPEE_INTER_SEED_MS: '100' }), 0)
})

test('stampBrandSignalsOnCards sets brand_key from metadata', () => {
  const seed = {
    target: 'Anua',
    mode: 'brand_portfolio',
    metadata: { brand_key: 'anua', universe_id: 'u-1' },
  }
  const cards = stampBrandSignalsOnCards(
    [{ shop_id: '1', item_id: '2', title: 'x', signals: { ships_from_overseas: true } }],
    seed,
  )
  assert.equal(cards[0].signals.brand_key, 'anua')
  assert.equal(cards[0].signals.universe_id, 'u-1')
  assert.equal(cards[0].signals.ships_from_overseas, true)
  assert.equal(cards[0].search_query, 'Anua')
  assert.equal(cards[0].raw.brand_key, 'anua')
})

test('stampBrandSignals falls back to brandKeyFromDisplayName', () => {
  const id = resolveBrandIdentityFromSeed({ target: "d'Alba", metadata: {} })
  assert.equal(id.brand_key, 'dalba')
  const cards = stampBrandSignalsOnCards([{ shop_id: '1', item_id: '2' }], {
    target: "d'Alba",
  })
  assert.equal(cards[0].signals.brand_key, 'dalba')
})

test('mock brand_portfolio sets search_query; detail_top_n 0 → empty details', async () => {
  const result = await mockCollectAdapter.scrapeSeed(
    {
      id: 's1',
      target: 'COSRX',
      mode: 'brand_portfolio',
      max_listings: 2,
      detail_top_n: 0,
      country: 'sg',
      metadata: { brand_key: 'cosrx' },
    },
    'job-1',
  )
  assert.equal(result.session_health, 'ok')
  assert.equal(result.details.length, 0)
  assert.ok(result.cards.length >= 1)
  assert.equal(result.cards[0].search_query, 'COSRX')
})

test('mock forced session_health blocked', async () => {
  const result = await mockCollectAdapter.scrapeSeed(
    {
      target: 'Anua',
      mode: 'brand_portfolio',
      metadata: { mock_session_health: 'blocked' },
    },
    'j2',
  )
  assert.equal(result.session_health, 'blocked')
  assert.equal(result.cards.length, 0)
})

test('processMarketplaceJobs stop_batch halts batch and cancels pending', async () => {
  const jobs = [
    {
      id: 'j1',
      workspace_id: 'ws',
      seed_id: 'seed1',
      status: 'pending',
      collector_id: 'mock',
      marketplace: 'shopee',
      country: 'sg',
      target: 'Anua',
      crawl_type: 'brand_portfolio',
      priority: 100,
      scheduled_for: '2026-07-20T00:00:00Z',
    },
    {
      id: 'j2',
      workspace_id: 'ws',
      seed_id: 'seed2',
      status: 'pending',
      collector_id: 'mock',
      marketplace: 'shopee',
      country: 'sg',
      target: 'COSRX',
      crawl_type: 'brand_portfolio',
      priority: 90,
      scheduled_for: '2026-07-20T00:00:00Z',
    },
  ]

  const state = {
    jobs: jobs.map((j) => ({ ...j })),
    seeds: {
      seed1: {
        id: 'seed1',
        workspace_id: 'ws',
        target: 'Anua',
        mode: 'brand_portfolio',
        max_pages: 2,
        max_listings: 30,
        detail_top_n: 0,
        metadata: { brand_key: 'anua', universe_id: 'u1' },
        consecutive_failures: 0,
      },
      seed2: {
        id: 'seed2',
        workspace_id: 'ws',
        target: 'COSRX',
        mode: 'brand_portfolio',
        detail_top_n: 0,
        metadata: { brand_key: 'cosrx' },
        consecutive_failures: 0,
      },
    },
    snapshots: [],
  }

  let collectCalls = 0
  const result = await processMarketplaceJobs(
    { limit: 5, workspace_id: 'ws' },
    {
      getServiceClient: () => makeFakeDb(state),
      sleep: async () => {},
      runCollector: async (_collectorId, seed) => {
        collectCalls++
        if (collectCalls === 1) {
          return { cards: [], session_health: 'blocked', details: [] }
        }
        return mockCollectAdapter.scrapeSeed(seed, 'job')
      },
    },
  )

  assert.equal(result.stop_batch, true)
  assert.match(result.stop_reason || '', /blocked/)
  assert.equal(result.failed, 1)
  assert.equal(collectCalls, 1)
  assert.ok((result.cancelled || 0) >= 1)
  assert.equal(result.completed, 0)
  assert.equal(state.jobs.find((j) => j.id === 'j2')?.status, 'cancelled')
})

test('inter-seed sleep between puppeteer jobs when limit>=2', async () => {
  const jobs = [1, 2].map((n) => ({
    id: `j${n}`,
    workspace_id: 'ws',
    seed_id: `s${n}`,
    status: 'pending',
    collector_id: 'shopee_puppeteer',
    marketplace: 'shopee',
    country: 'sg',
    target: `Brand${n}`,
    crawl_type: 'brand_portfolio',
    priority: 100,
    scheduled_for: '2026-07-20T00:00:00Z',
  }))

  const state = {
    jobs: jobs.map((j) => ({ ...j })),
    seeds: Object.fromEntries(
      jobs.map((j) => [
        j.seed_id,
        {
          id: j.seed_id,
          workspace_id: 'ws',
          target: j.target,
          mode: 'brand_portfolio',
          detail_top_n: 0,
          max_listings: 3,
          metadata: { brand_key: j.target.toLowerCase() },
          consecutive_failures: 0,
        },
      ]),
    ),
    snapshots: [],
  }

  const sleeps = []
  const prev = process.env.SHOPEE_INTER_SEED_MS
  process.env.SHOPEE_INTER_SEED_MS = '42'

  try {
    const result = await processMarketplaceJobs(
      { limit: 5, workspace_id: 'ws' },
      {
        getServiceClient: () => makeFakeDb(state),
        sleep: async (ms) => {
          sleeps.push(ms)
        },
        runCollector: async (_id, seed) => mockCollectAdapter.scrapeSeed(seed, 'job'),
      },
    )
    assert.equal(result.completed, 2)
    assert.ok(sleeps.includes(42), `expected sleep 42, got ${JSON.stringify(sleeps)}`)
    // brand_key stamped into snapshot signals
    assert.ok(state.snapshots.length >= 1)
    assert.ok(state.snapshots[0].signals?.brand_key)
  } finally {
    if (prev === undefined) delete process.env.SHOPEE_INTER_SEED_MS
    else process.env.SHOPEE_INTER_SEED_MS = prev
  }
})

test('weekly pipeline always runs metrics + digest after stop_batch', async () => {
  const calls = []
  const result = await runWeeklyPipeline(
    async (path) => {
      calls.push(path)
      if (path.includes('scheduler-tick')) return { ok: true, enqueued: 2 }
      if (path.includes('process-jobs')) {
        return {
          ok: true,
          claimed: 1,
          failed: 1,
          completed: 0,
          stop_batch: true,
          stop_reason: 'session_health=login_required',
        }
      }
      if (path.includes('metrics-tick')) return { ok: true, upserted: 1 }
      if (path.includes('weekly-digest')) return { ok: true, skipped: true }
      return { ok: true }
    },
    { workspace: 'ws', limit: 3, metricDate: '2026-07-19' },
  )

  assert.equal(result.stop_batch, true)
  assert.equal(result.exit_code, 2)
  assert.ok(calls.includes('/api/internal/marketplace/metrics-tick'))
  assert.ok(calls.includes('/api/internal/marketplace/weekly-digest'))
  assert.equal(calls.filter((c) => c.includes('process-jobs')).length, 1)
})

test('mostRecentSundayUtc', () => {
  assert.equal(mostRecentSundayUtc(new Date('2026-07-20T12:00:00Z')), '2026-07-19')
  assert.equal(mostRecentSundayUtc(new Date('2026-07-19T01:00:00Z')), '2026-07-19')
})

/** Minimal chainable fake Supabase client for processMarketplaceJobs tests */
function makeFakeDb(state) {
  return {
    from(table) {
      return createQuery(table, state)
    },
  }
}

function createQuery(table, state) {
  const filters = []
  let updatePatch = null
  let doSelect = false
  let maybeSingle = false
  let orderings = []
  let limitN = null

  const api = {
    select() {
      doSelect = true
      return api
    },
    eq(col, val) {
      filters.push({ col, val })
      return api
    },
    order(col, opts) {
      orderings.push({ col, asc: opts?.ascending !== false })
      return api
    },
    limit(n) {
      limitN = n
      return api
    },
    update(patch) {
      updatePatch = patch
      return api
    },
    insert(row) {
      return {
        then: (resolve, reject) => {
          if (table === 'marketplace_listing_snapshots') {
            state.snapshots.push(row)
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject)
        },
      }
    },
    upsert() {
      return {
        select() {
          return {
            single() {
              return Promise.resolve({
                data: { id: `id-${Math.random().toString(36).slice(2, 8)}` },
                error: null,
              })
            },
          }
        },
      }
    },
    single() {
      return execute()
    },
    maybeSingle() {
      maybeSingle = true
      return execute()
    },
    then(resolve, reject) {
      return execute().then(resolve, reject)
    },
  }

  function execute() {
    return Promise.resolve().then(() => {
      if (table === 'marketplace_crawl_jobs') {
        if (updatePatch) {
          const rows = state.jobs.filter((j) => matchFilters(j, filters))
          for (const j of rows) Object.assign(j, updatePatch)
          if (maybeSingle) {
            return { data: rows[0] || null, error: null }
          }
          if (doSelect) {
            return { data: rows.map((j) => ({ id: j.id })), error: null }
          }
          return { data: null, error: null }
        }
        if (doSelect) {
          let rows = state.jobs.filter((j) => matchFilters(j, filters))
          for (const o of orderings) {
            rows = [...rows].sort((a, b) => {
              const av = a[o.col]
              const bv = b[o.col]
              if (av === bv) return 0
              if (o.asc) return av > bv ? 1 : -1
              return av < bv ? 1 : -1
            })
          }
          if (limitN != null) rows = rows.slice(0, limitN)
          return { data: rows, error: null }
        }
      }

      if (table === 'marketplace_crawl_seeds') {
        if (updatePatch) {
          const idFilter = filters.find((f) => f.col === 'id')
          if (idFilter && state.seeds[idFilter.val]) {
            Object.assign(state.seeds[idFilter.val], updatePatch)
          }
          return { data: null, error: null }
        }
        if (doSelect) {
          const idFilter = filters.find((f) => f.col === 'id')
          return { data: idFilter ? state.seeds[idFilter.val] : null, error: null }
        }
      }

      return { data: null, error: null }
    })
  }

  return api
}

function matchFilters(row, filters) {
  return filters.every((f) => row[f.col] === f.val)
}
