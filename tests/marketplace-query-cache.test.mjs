import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { cacheKeyFor, dataVersion, withQueryCache } from '../marketplace/queryCache.mjs'

/**
 * Mock supabase covering the cache table + the data-version RPC.
 * `version` null simulates a workspace whose fingerprint cannot be read.
 */
function mockDb({ version = 'v1', stored = null, failWrites = false } = {}) {
  const state = { stored, writes: 0, reads: 0, computes: 0, updates: 0 }
  const db = {
    state,
    rpc(fn) {
      if (fn === 'marketplace_data_version') {
        return Promise.resolve({ data: version, error: version ? null : { message: 'nope' } })
      }
      return Promise.resolve({ data: null, error: null })
    },
    from() {
      const q = {
        _eq: {},
        select() { return q },
        eq(col, val) { q._eq[col] = val; return q },
        maybeSingle() {
          state.reads++
          const s = state.stored
          const match = s && s.cache_key === q._eq.cache_key && s.data_version === q._eq.data_version
          return Promise.resolve({ data: match ? s : null, error: null })
        },
        update() {
          state.updates++
          return { eq: () => Promise.resolve({ error: null }) }
        },
        upsert(row) {
          if (failWrites) return Promise.reject(new Error('write blocked'))
          state.writes++
          state.stored = { ...row, id: 'c1' }
          return Promise.resolve({ error: null })
        },
        delete() { return { eq: () => Promise.resolve({ error: null }) } },
      }
      return q
    },
  }
  return db
}

test('RP-8: cache key is stable across filter key order', () => {
  const a = cacheKeyFor('rollup', { group_by: 'brand', limit: 20, min_sold: 1000 })
  const b = cacheKeyFor('rollup', { min_sold: 1000, group_by: 'brand', limit: 20 })
  assert.equal(a, b)
})

test('RP-8: cache key ignores empty values but distinguishes real ones', () => {
  assert.equal(
    cacheKeyFor('rollup', { group_by: 'brand', shop_username: null, q: '' }),
    cacheKeyFor('rollup', { group_by: 'brand' }),
  )
  assert.notEqual(cacheKeyFor('rollup', { group_by: 'brand' }), cacheKeyFor('rollup', { group_by: 'shelf' }))
  assert.notEqual(cacheKeyFor('rollup', { group_by: 'brand' }), cacheKeyFor('listings', { group_by: 'brand' }))
})

test('RP-8: array filters are order-insensitive', () => {
  assert.equal(
    cacheKeyFor('rollup', { brand_keys: ['anua', 'biodance'] }),
    cacheKeyFor('rollup', { brand_keys: ['biodance', 'anua'] }),
  )
})

test('RP-8: miss computes and stores; hit skips compute', async () => {
  const db = mockDb({})
  let computes = 0
  const compute = async () => { computes++; return { groups: [1, 2] } }

  const first = await withQueryCache(db, 'ws-1', 'rollup', { group_by: 'brand' }, compute)
  assert.equal(first.cache.status, 'miss')
  assert.equal(computes, 1)
  assert.equal(db.state.writes, 1)

  const second = await withQueryCache(db, 'ws-1', 'rollup', { group_by: 'brand' }, compute)
  assert.equal(second.cache.status, 'hit')
  assert.equal(computes, 1, 'a hit must not recompute')
  assert.deepEqual(second.groups, [1, 2])
})

test('RP-8: a changed data version invalidates without an explicit purge', async () => {
  const db = mockDb({ version: 'v1' })
  let computes = 0
  const compute = async () => { computes++; return { n: computes } }

  await withQueryCache(db, 'ws-1', 'rollup', { group_by: 'brand' }, compute)
  assert.equal(computes, 1)

  // A harvest write moves the fingerprint; the stored row is now stale.
  const db2 = mockDb({ version: 'v2', stored: db.state.stored })
  const after = await withQueryCache(db2, 'ws-1', 'rollup', { group_by: 'brand' }, compute)
  assert.equal(after.cache.status, 'miss')
  assert.equal(computes, 2, 'stale entry must not be served')
})

test('RP-8: unknown data version bypasses the cache rather than risking staleness', async () => {
  const db = mockDb({ version: null })
  let computes = 0
  const res = await withQueryCache(db, 'ws-1', 'rollup', {}, async () => { computes++; return { ok: true } })
  assert.equal(res.cache.status, 'bypass')
  assert.equal(computes, 1)
  assert.equal(db.state.writes, 0, 'must not store against an unknown version')
})

test('RP-8: a cache write failure never fails the query', async () => {
  const db = mockDb({ failWrites: true })
  const res = await withQueryCache(db, 'ws-1', 'rollup', {}, async () => ({ ok: true }))
  assert.equal(res.ok, true, 'caller still gets the real answer')
})

test('RP-8: enabled:false short-circuits entirely', async () => {
  const db = mockDb({})
  let computes = 0
  const res = await withQueryCache(db, 'ws-1', 'rollup', {}, async () => { computes++; return { ok: true } }, { enabled: false })
  assert.equal(res.cache.status, 'disabled')
  assert.equal(computes, 1)
  assert.equal(db.state.reads, 0)
})

test('RP-8: dataVersion returns null instead of throwing when the RPC fails', async () => {
  assert.equal(await dataVersion(mockDb({ version: null }), 'ws-1'), null)
  assert.equal(await dataVersion({ rpc: () => Promise.reject(new Error('boom')) }, 'ws-1'), null)
})

test('RP-8: migration 078 invalidates by data version, not TTL', () => {
  const sql = readFileSync(
    new URL('../core/db/078_marketplace_query_cache.sql', import.meta.url),
    'utf8',
  )
  assert.match(sql, /create table if not exists public\.marketplace_query_cache/)
  assert.match(sql, /data_version/)
  assert.match(sql, /create or replace function public\.marketplace_data_version/)
  assert.match(sql, /unique \(workspace_id, cache_key\)/)
  assert.match(sql, /enable row level security/)
  // A TTL column would mean time-based expiry, which is the design we rejected.
  assert.ok(!/expires_at|ttl_seconds/i.test(sql), 'invalidation must be version-based, not TTL')
})

test('RP-8: migration 079 invalidates cache versions after in-place snapshot updates', () => {
  const sql = readFileSync(
    new URL('../core/db/079_marketplace_read_path_correctness.sql', import.meta.url),
    'utf8',
  )
  assert.match(sql, /add column if not exists cache_changed_at/)
  assert.match(sql, /before update on public\.marketplace_listing_snapshots/)
  assert.match(sql, /new\.cache_changed_at := clock_timestamp\(\)/)
  assert.match(sql, /max\(greatest\(crawled_at, cache_changed_at\)\)/)
  assert.match(sql, /YYYYMMDDHH24MISS\.US/)
})

test('RP-8: rollup is memoised and exposes an uncached path', () => {
  const src = readFileSync(
    new URL('../marketplace/brandRollupQuery.mjs', import.meta.url),
    'utf8',
  )
  assert.match(src, /withQueryCache/)
  assert.match(src, /export async function computeBrandRollup/)
  // group_by must be validated BEFORE the cache, so bad input is never stored.
  const validateAt = src.indexOf('resolveDimension')
  const cacheAt = src.indexOf('withQueryCache(')
  assert.ok(validateAt > -1 && cacheAt > -1)
  assert.ok(validateAt < cacheAt, 'validation must precede the cache lookup')
})
