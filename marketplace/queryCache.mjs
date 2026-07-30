/**
 * RP-8 — data-version cache for Shopee Mall aggregate reads.
 *
 * Invalidation is by data version, not TTL. The harvest changes weekly at most,
 * so a TTL would either serve stale numbers right after a harvest or expire for
 * no reason during a quiet week. A fingerprint of the workspace's snapshot
 * state (latest crawl + row count) means a new harvest write invalidates every
 * affected entry implicitly, and nothing else does.
 *
 * Best-effort throughout: a cache miss, a cache write failure, or a missing
 * table must never fail the underlying query. Correctness lives in the query;
 * this only makes it cheaper.
 */

import { createHash } from 'node:crypto'

const TABLE = 'marketplace_query_cache'

/**
 * Stable key for (tool, filters). Key order is normalised so callers that build
 * the same filter set in a different order still hit.
 *
 * @param {string} tool
 * @param {Record<string, any>} filters
 * @returns {string}
 */
export function cacheKeyFor(tool, filters = {}) {
  const norm = {}
  for (const k of Object.keys(filters).sort()) {
    const v = filters[k]
    if (v == null || v === '') continue
    norm[k] = Array.isArray(v) ? [...v].map(String).sort() : v
  }
  const hash = createHash('sha256')
    .update(JSON.stringify({ tool, filters: norm }))
    .digest('hex')
    .slice(0, 32)
  return `${tool}:${hash}`
}

/**
 * Current snapshot fingerprint for a workspace.
 * Returns null if it cannot be determined — callers then skip the cache
 * rather than risk serving a result that outlives its data.
 *
 * @param {any} db
 * @param {string} workspaceId
 */
export async function dataVersion(db, workspaceId) {
  try {
    const { data, error } = await db.rpc('marketplace_data_version', {
      p_workspace_id: workspaceId,
    })
    if (error) return null
    return typeof data === 'string' ? data : null
  } catch {
    return null
  }
}

/**
 * Run `compute`, memoised against the current data version.
 *
 * @param {any} db
 * @param {string} workspaceId
 * @param {string} tool
 * @param {Record<string, any>} filters
 * @param {() => Promise<any>} compute
 * @param {{ enabled?: boolean }} [opts]
 * @returns {Promise<any>} the payload, annotated with a `cache` block
 */
export async function withQueryCache(db, workspaceId, tool, filters, compute, opts = {}) {
  if (opts.enabled === false) {
    const value = await compute()
    return { ...value, cache: { status: 'disabled' } }
  }

  const version = await dataVersion(db, workspaceId)
  const key = cacheKeyFor(tool, filters)

  if (version) {
    try {
      const { data } = await db
        .from(TABLE)
        .select('id, payload, hits, created_at')
        .eq('workspace_id', workspaceId)
        .eq('cache_key', key)
        .eq('data_version', version)
        .maybeSingle()

      if (data?.payload) {
        // Fire-and-forget: hit accounting must not add latency to a cache hit.
        db.from(TABLE)
          .update({ hits: (data.hits || 0) + 1, last_hit_at: new Date().toISOString() })
          .eq('id', data.id)
          .then(() => {}, () => {})

        return {
          ...data.payload,
          cache: { status: 'hit', data_version: version, computed_at: data.created_at },
        }
      }
    } catch {
      // Table missing or unreadable — fall through and compute.
    }
  }

  const started = Date.now()
  const value = await compute()
  const computedMs = Date.now() - started

  if (version) {
    try {
      await db.from(TABLE).upsert(
        {
          workspace_id: workspaceId,
          cache_key: key,
          data_version: version,
          payload: value,
          computed_ms: computedMs,
          hits: 0,
          created_at: new Date().toISOString(),
          last_hit_at: null,
        },
        { onConflict: 'workspace_id,cache_key' },
      )
    } catch {
      // Never fail a good result because we could not memoise it.
    }
  }

  return {
    ...value,
    cache: { status: version ? 'miss' : 'bypass', data_version: version, computed_ms: computedMs },
  }
}
