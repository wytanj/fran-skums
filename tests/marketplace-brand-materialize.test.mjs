import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseSampleBrandsCsv, PILOT_BRAND_KEYS } from '../marketplace/brandKey.mjs'
import {
  BRAND_PORTFOLIO_PREFERRED_HOUR_UTC,
  BRAND_PORTFOLIO_WEEKLY_DAY,
  buildBrandPortfolioSeedRow,
  filterUniverseForMaterialize,
  seedUpsertConflictColumns,
} from '../marketplace/materializeBrandSeeds.mjs'
import { computeNextRunAt } from '../marketplace/scheduler.mjs'

const materializeUtil = readFileSync(
  new URL('../server/utils/marketplaceBrandUniverse.ts', import.meta.url),
  'utf8',
)
const matRoute = readFileSync(
  new URL(
    '../server/api/v1/marketplace/brand-universe/materialize-seeds.post.ts',
    import.meta.url,
  ),
  'utf8',
)
const importRoute = readFileSync(
  new URL('../server/api/v1/marketplace/brand-universe/import.post.ts', import.meta.url),
  'utf8',
)
const listRoute = readFileSync(
  new URL('../server/api/v1/marketplace/brand-universe.get.ts', import.meta.url),
  'utf8',
)
const patchRoute = readFileSync(
  new URL('../server/api/v1/marketplace/brand-universe/[id].patch.ts', import.meta.url),
  'utf8',
)

test('PR-2 routes and util exist with intel scopes', () => {
  assert.match(listRoute, /intel:read/)
  assert.match(matRoute, /intel:write/)
  assert.match(importRoute, /intel:write/)
  assert.match(patchRoute, /intel:write/)
  assert.match(materializeUtil, /primary_seed_id/)
  assert.match(materializeUtil, /brand_portfolio/)
  assert.match(materializeUtil, /PILOT_BRAND_KEYS/)
})

test('buildBrandPortfolioSeedRow — weekly UTC hour, detail_top_n=0, metadata links', () => {
  const universe = {
    id: 'uuu-111',
    workspace_id: 'ws-1',
    brand_key: 'anua',
    display_name: 'Anua',
    categories: ['Skincare'],
    origin_country: 'Korea',
    official_interest: true,
    shopee_mall_interest: true,
    iherb_interest: true,
    pilot_tier: 'pilot',
    priority: 120,
    marketplace: 'shopee',
    country: 'sg',
    source: 'sample-brands.csv',
  }

  const seed = buildBrandPortfolioSeedRow(universe, {
    collector_id: 'mock',
    now: '2026-07-20T12:00:00.000Z',
  })

  assert.equal(seed.mode, 'brand_portfolio')
  assert.equal(seed.target, 'Anua')
  assert.equal(seed.schedule_kind, 'weekly')
  assert.equal(seed.preferred_hour, BRAND_PORTFOLIO_PREFERRED_HOUR_UTC)
  assert.equal(seed.preferred_hour, 10)
  assert.equal(seed.weekly_day, BRAND_PORTFOLIO_WEEKLY_DAY)
  assert.equal(seed.weekly_day, 0)
  assert.equal(seed.detail_top_n, 0)
  assert.equal(seed.max_pages, 2)
  assert.equal(seed.max_listings, 30) // pilot
  assert.equal(seed.collector_id, 'mock')
  assert.equal(seed.priority, 120)
  assert.equal(seed.metadata.brand_key, 'anua')
  assert.equal(seed.metadata.universe_id, 'uuu-111')
  assert.equal(seed.metadata.preferred_hour_note, 'UTC')
  assert.deepEqual(seed.metadata.query_variants, ['Anua'])
  assert.ok(seed.next_run_at)
  assert.equal(seedUpsertConflictColumns(), 'workspace_id,marketplace,country,mode,target')
})

test('preferred_hour 10 UTC produces Sunday next_run at hour 10', () => {
  // Monday 2026-07-20
  const now = new Date('2026-07-20T08:00:00.000Z')
  const next = computeNextRunAt(now, {
    schedule_kind: 'weekly',
    preferred_hour: 10,
    weekly_day: 0,
  })
  assert.ok(next)
  assert.equal(next.getUTCDay(), 0) // Sunday
  assert.equal(next.getUTCHours(), 10)
  assert.ok(next > now)
})

test('mid/full max_listings 40', () => {
  const seed = buildBrandPortfolioSeedRow({
    id: 'x',
    workspace_id: 'ws',
    brand_key: 'cosrx',
    display_name: 'COSRX',
    pilot_tier: 'full',
    official_interest: true,
    shopee_mall_interest: true,
  })
  assert.equal(seed.max_listings, 40)
})

test('filterUniverseForMaterialize by brand_keys and tier', () => {
  const rows = [
    { brand_key: 'anua', pilot_tier: 'pilot', enabled: true },
    { brand_key: 'cosrx', pilot_tier: 'paused', enabled: true },
    { brand_key: 'medicube', pilot_tier: 'pilot', enabled: false },
    { brand_key: 'celimax', pilot_tier: 'mid', enabled: true },
  ]

  const byKeys = filterUniverseForMaterialize(rows, { brand_keys: ['anua', 'cosrx'] })
  assert.deepEqual(
    byKeys.map((r) => r.brand_key).sort(),
    ['anua', 'cosrx'],
  )

  const byTier = filterUniverseForMaterialize(rows, { pilot_tier: 'pilot' })
  assert.deepEqual(
    byTier.map((r) => r.brand_key),
    ['anua'],
  ) // medicube disabled

  const empty = filterUniverseForMaterialize(rows, {})
  assert.equal(empty.length, 0)
})

test('pilot allowlist keys exist in sample CSV parse', () => {
  const csv = readFileSync(new URL('../sample-brands.csv', import.meta.url), 'utf8')
  const { rows } = parseSampleBrandsCsv(csv)
  const keys = new Set(rows.map((r) => r.brand_key))
  for (const k of PILOT_BRAND_KEYS) {
    assert.ok(keys.has(k), `missing pilot key ${k}`)
  }
  assert.equal(PILOT_BRAND_KEYS.length, 12)
})

test('d\'Alba seed target preserves display name', () => {
  const seed = buildBrandPortfolioSeedRow({
    id: 'id-dalba',
    workspace_id: 'ws',
    brand_key: 'dalba',
    display_name: "d'Alba",
    pilot_tier: 'pilot',
    official_interest: true,
    shopee_mall_interest: true,
  })
  assert.equal(seed.target, "d'Alba")
  assert.equal(seed.metadata.brand_key, 'dalba')
  assert.equal(seed.metadata.universe_id, 'id-dalba')
})
