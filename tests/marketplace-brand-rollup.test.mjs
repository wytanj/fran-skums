import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { queryBrandRollup } from '../marketplace/brandRollupQuery.mjs'
import {
  METRIC_DEFINITIONS,
  NAMED_METRICS,
  ROLLUP_DIMENSIONS,
  SOLD_FIELD_CAVEAT,
  caveatsFor,
  metricDefinitionsForAgents,
  resolveDimension,
} from '../marketplace/metrics/definitions.mjs'

/** Records the RPC calls so we can assert aggregation happens in SQL. */
function mockDb(rows, groupCount) {
  const calls = []
  return {
    calls,
    rpc(fn, args) {
      calls.push({ fn, args })
      if (fn === 'marketplace_brand_rollup_count') {
        return Promise.resolve({ data: groupCount, error: null })
      }
      return Promise.resolve({ data: rows, error: null })
    },
  }
}

const group = (over = {}) => ({
  group_key: over.group_key || 'biodance',
  sku_count: over.sku_count ?? 51,
  sold_sum: over.sold_sum ?? 194206,
  sold_max: over.sold_max ?? 90000,
  sold_avg: over.sold_avg ?? 3808,
  price_p50: over.price_p50 ?? 24.9,
  with_platform_path: over.with_platform_path ?? 20,
  top_title: over.top_title ?? 'Bio Collagen Mask',
  top_sold: over.top_sold ?? 90000,
})

// ——— RP-6: the semantic layer ———

test('RP-6: sold caveat states the field is cumulative, not a rate', () => {
  assert.match(SOLD_FIELD_CAVEAT, /CUMULATIVE LIFETIME/)
  assert.match(SOLD_FIELD_CAVEAT, /not a rate/i)
  // The specific misreading this exists to prevent
  assert.match(SOLD_FIELD_CAVEAT, /age/i)
})

test('RP-6: every metric has a description; sold metrics carry the caveat', () => {
  for (const [name, def] of Object.entries(METRIC_DEFINITIONS)) {
    assert.ok(def.description, `${name} needs a description`)
    assert.ok(def.sql, `${name} needs a SQL expression`)
    if (name.startsWith('sold_')) {
      assert.match(def.caveat || '', /CUMULATIVE LIFETIME/, `${name} must carry the sold caveat`)
    }
  }
})

test('RP-6: named metrics define the phrases people actually say', () => {
  assert.ok(NAMED_METRICS.top_seller.definition)
  assert.match(NAMED_METRICS.top_seller.caveat, /NOT "fastest selling"/)
  assert.ok(NAMED_METRICS.shelf_share.definition)
  assert.ok(NAMED_METRICS.sold_band.definition)
})

test('RP-6: shelf and platform_leaf are documented as different taxonomies', () => {
  assert.match(ROLLUP_DIMENSIONS.shelf.description, /never equate/i)
  assert.match(ROLLUP_DIMENSIONS.platform_leaf.description, /breadcrumb|MH-4/)
})

test('RP-6: resolveDimension rejects unknown group_by with the valid list', () => {
  assert.equal(resolveDimension('brand').ok, true)
  const bad = resolveDimension('category')
  assert.equal(bad.ok, false)
  assert.match(bad.error, /brand, shelf, platform_leaf, shop/)
})

test('RP-6: caveatsFor dedupes and only returns real caveats', () => {
  const c = caveatsFor(['sku_count', 'sold_sum', 'sold_max'])
  assert.ok(c.length >= 1)
  assert.ok(c.every((x) => typeof x === 'string' && x.length))
})

test('RP-6: agent block names the caveat and the dimensions', () => {
  const s = metricDefinitionsForAgents()
  assert.match(s, /CUMULATIVE LIFETIME/)
  assert.match(s, /platform_leaf/)
  assert.match(s, /top_seller/)
})

// ——— RP-4: aggregation in SQL ———

test('RP-4: aggregates via RPC, never by fetching rows', async () => {
  const db = mockDb([group()], 64)
  await queryBrandRollup(db, 'ws-1', { group_by: 'brand' })
  const fns = db.calls.map((c) => c.fn)
  assert.ok(fns.includes('marketplace_brand_rollup'))
  assert.ok(fns.includes('marketplace_brand_rollup_count'))
  // No row-fetch fallback: the whole point is that rows never cross the wire.
  assert.equal(typeof db.from, 'undefined')
})

test('RP-4: filters are passed to SQL, brand_key normalised to an array', async () => {
  const db = mockDb([group()], 1)
  await queryBrandRollup(db, 'ws-1', {
    group_by: 'shelf',
    brand_key: 'BioDance',
    min_sold: 1000,
    shop_username: 'Biodance.SG',
  })
  // RP-8 puts a data_version RPC ahead of the rollup, so locate by name.
  const args = db.calls.find((c) => c.fn === 'marketplace_brand_rollup').args
  assert.deepEqual(args.p_brand_keys, ['biodance'])
  assert.equal(args.p_shop_username, 'biodance.sg')
  assert.equal(args.p_min_sold, 1000)
  assert.equal(args.p_group_by, 'shelf')
})

test('RP-8: rollup still works when the cache table is unreachable', async () => {
  // The rollup mock has no .from(), so every cache access throws. The query
  // must degrade to computing, not fail.
  const db = mockDb([group()], 1)
  const res = await queryBrandRollup(db, 'ws-1', { group_by: 'brand' })
  assert.equal(res.groups.length, 1)
  assert.ok(['miss', 'bypass'].includes(res.cache.status))
})

test('RP-4: declares truncation when limit cuts the grouping', async () => {
  const db = mockDb([group(), group({ group_key: 'anua' })], 64)
  const res = await queryBrandRollup(db, 'ws-1', { group_by: 'brand', limit: 2 })
  assert.equal(res.group_count, 2)
  assert.equal(res.total_groups, 64)
  assert.equal(res.complete, false)
  assert.match(res.note, /top 2 of 64/)
})

test('RP-4: complete=true when all groups are returned', async () => {
  const db = mockDb([group()], 1)
  const res = await queryBrandRollup(db, 'ws-1', { group_by: 'brand' })
  assert.equal(res.complete, true)
  assert.equal(res.note, undefined)
})

test('RP-4: only requested metrics are projected (every column is tokens)', async () => {
  const db = mockDb([group()], 1)
  const res = await queryBrandRollup(db, 'ws-1', {
    group_by: 'brand',
    metrics: ['sku_count'],
  })
  const g = res.groups[0]
  assert.equal(g.sku_count, 51)
  assert.equal(g.sold_sum, undefined)
  assert.equal(g.price_p50, undefined)
})

test('RP-4: unknown metrics fall back to defaults rather than erroring', async () => {
  const db = mockDb([group()], 1)
  const res = await queryBrandRollup(db, 'ws-1', { group_by: 'brand', metrics: ['bogus'] })
  assert.ok(res.metrics.includes('sku_count'))
  assert.ok(res.metrics.includes('sold_sum'))
})

test('RP-4: bad group_by throws with the valid options', async () => {
  const db = mockDb([], 0)
  await assert.rejects(
    () => queryBrandRollup(db, 'ws-1', { group_by: 'nonsense' }),
    /Unknown group_by/,
  )
})

test('RP-4/6: definitions travel with the numbers', async () => {
  const db = mockDb([group()], 1)
  const res = await queryBrandRollup(db, 'ws-1', { group_by: 'brand', metrics: ['sold_sum'] })
  assert.match(res.definitions.sold_field, /CUMULATIVE LIFETIME/)
  assert.ok(res.definitions.metrics.sold_sum)
  assert.ok(res.definitions.caveats.length >= 1)
})

test('RP-4: migration 077 aggregates over the latest-per-listing view', () => {
  const sql = readFileSync(
    new URL('../core/db/077_marketplace_brand_rollup.sql', import.meta.url),
    'utf8',
  )
  assert.match(sql, /create or replace function public\.marketplace_brand_rollup/)
  assert.match(sql, /from public\.v_marketplace_listing_latest/)
  assert.match(sql, /group by s\.grp/)
  // Allowlisted CASE mapping, not dynamic SQL — no injection surface.
  assert.match(sql, /case p_group_by/)
  assert.ok(!/execute\s+format/i.test(sql), 'must not use dynamic SQL')
  assert.match(sql, /security invoker/)
})

test('RP-4: group count includes the unattributed NULL bucket', () => {
  const sql = readFileSync(
    new URL('../core/db/079_marketplace_read_path_correctness.sql', import.meta.url),
    'utf8',
  )
  assert.match(sql, /create or replace function public\.marketplace_brand_rollup_count/)
  assert.match(sql, /bool_or\(grp is null\)/)
  assert.match(sql, /count\(distinct grp\)/)
})

test('RP-4: tool + scope + route registered and routed as the entry point', () => {
  const tools = readFileSync(new URL('../mcp/src/tools.mjs', import.meta.url), 'utf8')
  assert.match(tools, /name: 'market_brand_rollup'/)
  assert.match(tools, /case 'market_brand_rollup'/)
  assert.match(tools, /START HERE for any aggregate question/)

  const scopes = readFileSync(new URL('../mcp/src/toolScopes.mjs', import.meta.url), 'utf8')
  assert.match(scopes, /market_brand_rollup/)

  const instr = readFileSync(new URL('../mcp/src/agentInstructions.mjs', import.meta.url), 'utf8')
  assert.match(instr, /market_brand_rollup/)
  // The sold caveat and the completeness rule must both reach the agent.
  assert.match(instr, /cumulative lifetime, bucketed/i)
  assert.match(instr, /check \*\*complete\*\*/i)

  const route = readFileSync(
    new URL('../server/api/v1/marketplace/brand-rollup.get.ts', import.meta.url),
    'utf8',
  )
  assert.match(route, /queryBrandRollup/)
  assert.match(route, /intel:read/)
})
