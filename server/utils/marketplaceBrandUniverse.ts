/**
 * Brand universe import + materialize weekly brand_portfolio seeds (PR-2).
 */
import {
  parseSampleBrandsCsv,
  brandUniversePriority,
  PILOT_BRAND_KEYS,
} from '../../marketplace/brandKey.mjs'
import {
  buildSeedsForUniverse,
  filterUniverseForMaterialize,
  seedUpsertConflictColumns,
} from '../../marketplace/materializeBrandSeeds.mjs'
import {
  resolveShopFromManualUrl,
  universeShopPatchFromResolve,
} from '../../marketplace/resolveShopUsername.mjs'
import { getServiceClient } from './supabase'

export { PILOT_BRAND_KEYS }

export async function listBrandUniverse(
  workspaceId: string,
  query: Record<string, unknown> = {},
) {
  const db = getServiceClient()
  let q = db
    .from('marketplace_brand_universe')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('priority', { ascending: false })
    .order('display_name', { ascending: true })

  if (query.enabled === 'true') q = q.eq('enabled', true)
  if (query.enabled === 'false') q = q.eq('enabled', false)
  if (typeof query.pilot_tier === 'string') q = q.eq('pilot_tier', query.pilot_tier)
  if (typeof query.marketplace === 'string') q = q.eq('marketplace', query.marketplace)
  if (typeof query.country === 'string') q = q.eq('country', String(query.country).toLowerCase())
  if (typeof query.q === 'string' && query.q.trim()) {
    q = q.or(
      `display_name.ilike.%${query.q.trim()}%,brand_key.ilike.%${query.q.trim()}%`,
    )
  }

  const limit = Math.min(Number(query.limit) || 300, 500)
  const { data, error } = await q.limit(limit)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function patchBrandUniverse(
  workspaceId: string,
  id: string,
  body: Record<string, unknown>,
) {
  const db = getServiceClient()
  const { data: existing, error: loadErr } = await db
    .from('marketplace_brand_universe')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single()

  if (loadErr || !existing) {
    const err = new Error('Brand universe row not found')
    ;(err as any).statusCode = 404
    throw err
  }

  const patch: Record<string, unknown> = {}
  const fields = [
    'display_name',
    'categories',
    'origin_country',
    'official_interest',
    'shopee_mall_interest',
    'iherb_interest',
    'followers_note',
    'pilot_tier',
    'enabled',
    'priority',
    'metadata',
    'shop_username',
    'shop_url',
    'shop_id',
    'shop_resolve_status',
    'shop_resolve_source',
    'shop_resolve_evidence',
  ] as const

  for (const f of fields) {
    if (body[f] !== undefined) patch[f] = body[f]
  }

  // Recompute priority when interest flags change and priority not explicit
  if (
    body.priority === undefined &&
    (body.official_interest !== undefined || body.shopee_mall_interest !== undefined)
  ) {
    const official =
      body.official_interest !== undefined
        ? body.official_interest
        : existing.official_interest
    const mall =
      body.shopee_mall_interest !== undefined
        ? body.shopee_mall_interest
        : existing.shopee_mall_interest
    patch.priority = brandUniversePriority(official as boolean | null, mall as boolean)
  }

  if (Object.keys(patch).length === 0) return existing

  const { data, error } = await db
    .from('marketplace_brand_universe')
    .update(patch)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data
}

/**
 * Resolve / confirm Mall shop_username for a brand (extension + scripts).
 * Looks up by brand_key or id; parses shop URL; sets confirmed by default.
 */
export async function resolveBrandShop(
  workspaceId: string,
  opts: {
    brand_key?: string
    id?: string
    shop_url?: string
    shop_username?: string
    shop_id?: string | null
    status?: 'confirmed' | 'candidate'
    source?: 'manual' | 'serp' | 'heuristic' | 'import'
    evidence?: Record<string, unknown>
  },
) {
  const db = getServiceClient()
  let row: any = null

  if (opts.id) {
    const { data } = await db
      .from('marketplace_brand_universe')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', opts.id)
      .maybeSingle()
    row = data
  } else if (opts.brand_key) {
    const key = String(opts.brand_key).toLowerCase().trim()
    const { data } = await db
      .from('marketplace_brand_universe')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('brand_key', key)
      .maybeSingle()
    row = data
  }

  if (!row) {
    const err = new Error('Brand universe row not found')
    ;(err as any).statusCode = 404
    throw err
  }

  const input = opts.shop_url || opts.shop_username
  if (!input) {
    const err = new Error('shop_url or shop_username required')
    ;(err as any).statusCode = 400
    throw err
  }

  const resolved = resolveShopFromManualUrl(input, {
    country: row.country || 'sg',
    brand_key: row.brand_key,
  })
  if (!resolved.ok) {
    const err = new Error(resolved.error || 'unparseable shop')
    ;(err as any).statusCode = 400
    throw err
  }

  const status = opts.status || 'confirmed'
  const source = opts.source || 'manual'
  const patch = {
    ...universeShopPatchFromResolve({
      ...resolved,
      status,
      source,
      shop_id: opts.shop_id || resolved.shop_id,
      evidence: {
        ...(resolved.evidence || {}),
        ...(opts.evidence || {}),
        via: 'api_resolve_shop',
      },
    }),
    shop_resolve_status: status,
    shop_resolve_source: source,
  }

  const { data, error } = await db
    .from('marketplace_brand_universe')
    .update(patch)
    .eq('id', row.id)
    .eq('workspace_id', workspaceId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data
}

/**
 * Import CSV text or pre-parsed rows. Does not materialize seeds.
 */
export async function importBrandUniverse(
  workspaceId: string,
  opts: {
    csv_text?: string
    rows?: Array<Record<string, unknown>>
    dry_run?: boolean
    marketplace?: string
    country?: string
    source?: string
  },
) {
  const marketplace = opts.marketplace || 'shopee'
  const country = String(opts.country || 'sg').toLowerCase()
  const source = opts.source || 'sample-brands.csv'

  let parsedRows: Array<Record<string, any>>
  let stats: Record<string, number> = {}
  let skipped: unknown[] = []

  if (opts.csv_text) {
    const parsed = parseSampleBrandsCsv(opts.csv_text, { source })
    parsedRows = parsed.rows
    stats = parsed.stats
    skipped = parsed.skipped
  } else if (Array.isArray(opts.rows) && opts.rows.length) {
    parsedRows = opts.rows as Array<Record<string, any>>
    stats = { input_data_rows: parsedRows.length, unique_brands: parsedRows.length }
  } else {
    const err = new Error('csv_text or rows[] required')
    ;(err as any).statusCode = 400
    throw err
  }

  if (opts.dry_run) {
    return {
      dry_run: true,
      stats,
      skipped,
      brand_keys: parsedRows.map((r) => r.brand_key),
      count: parsedRows.length,
    }
  }

  const db = getServiceClient()
  const now = new Date().toISOString()
  const payload = parsedRows.map((r) => ({
    workspace_id: workspaceId,
    brand_key: r.brand_key,
    display_name: r.display_name,
    categories: r.categories || [],
    origin_country: r.origin_country ?? null,
    official_interest: r.official_interest ?? null,
    shopee_mall_interest: Boolean(r.shopee_mall_interest),
    iherb_interest: Boolean(r.iherb_interest),
    followers_note: r.followers_note ?? null,
    marketplace,
    country,
    pilot_tier: 'paused',
    enabled: true,
    priority:
      r.priority != null
        ? Number(r.priority)
        : brandUniversePriority(r.official_interest, r.shopee_mall_interest),
    source,
    imported_at: now,
    metadata: {
      csv_nos: r.csv_nos || [],
      import_api: true,
    },
  }))

  const { data, error } = await db
    .from('marketplace_brand_universe')
    .upsert(payload, { onConflict: 'workspace_id,marketplace,country,brand_key' })
    .select('id, brand_key, display_name, pilot_tier, priority')

  if (error) throw new Error(error.message)

  return {
    dry_run: false,
    stats,
    skipped,
    upserted: data?.length ?? payload.length,
    brands: data ?? [],
  }
}

/**
 * Materialize weekly brand_portfolio seeds from universe rows.
 * Links seed.metadata.universe_id ↔ universe.primary_seed_id.
 */
export async function materializeBrandSeeds(
  workspaceId: string,
  opts: {
    brand_keys?: string[]
    pilot_tier?: string
    /** When set with brand_keys, update those universe rows to this tier first */
    set_pilot_tier?: string
    collector_id?: string
    enabled?: boolean
    /** Use Appendix A pilot keys when true */
    pilot_allowlist?: boolean
  } = {},
) {
  const db = getServiceClient()
  let brandKeys = opts.brand_keys
  if (opts.pilot_allowlist) {
    brandKeys = [...PILOT_BRAND_KEYS]
  }

  if ((!brandKeys || !brandKeys.length) && !opts.pilot_tier) {
    const err = new Error('brand_keys[], pilot_tier, or pilot_allowlist=true required')
    ;(err as any).statusCode = 400
    throw err
  }

  // Optional: activate tier on selected keys before materialize
  if (opts.set_pilot_tier && brandKeys?.length) {
    const { error: tierErr } = await db
      .from('marketplace_brand_universe')
      .update({ pilot_tier: opts.set_pilot_tier })
      .eq('workspace_id', workspaceId)
      .in('brand_key', brandKeys)
    if (tierErr) throw new Error(tierErr.message)
  }

  const { data: allRows, error: listErr } = await db
    .from('marketplace_brand_universe')
    .select('*')
    .eq('workspace_id', workspaceId)

  if (listErr) throw new Error(listErr.message)

  const selected = filterUniverseForMaterialize(allRows || [], {
    brand_keys: brandKeys,
    pilot_tier: brandKeys?.length ? null : opts.pilot_tier,
    require_enabled: true,
  })

  if (!selected.length) {
    return { materialized: 0, seeds: [], brands: [], message: 'no matching universe rows' }
  }

  const collector_id = opts.collector_id || 'shopee_puppeteer'
  const seedEnabled = opts.enabled !== false
  const results: Array<{
    brand_key: string
    seed_id: string
    universe_id: string
    mode: string
    target: string
    strategy: string
    secondary_seed_id?: string | null
  }> = []
  const errors: Array<{ brand_key: string; error: string }> = []

  for (const universe of selected) {
    try {
      const plan = buildSeedsForUniverse(universe, {
        collector_id,
        enabled: seedEnabled,
        include_serp_secondary: true,
      })
      const seedRow = { ...plan.primary, workspace_id: workspaceId }

      const { data: seed, error: seedErr } = await db
        .from('marketplace_crawl_seeds')
        .upsert(seedRow, { onConflict: seedUpsertConflictColumns() })
        .select('*')
        .single()

      if (seedErr || !seed) {
        errors.push({ brand_key: universe.brand_key, error: seedErr?.message || 'upsert failed' })
        continue
      }

      let secondaryId: string | null = null
      if (plan.secondary) {
        const sec = { ...plan.secondary, workspace_id: workspaceId }
        const { data: secSeed, error: secErr } = await db
          .from('marketplace_crawl_seeds')
          .upsert(sec, { onConflict: seedUpsertConflictColumns() })
          .select('id')
          .single()
        if (!secErr && secSeed) secondaryId = secSeed.id
      }

      const { error: linkErr } = await db
        .from('marketplace_brand_universe')
        .update({ primary_seed_id: seed.id })
        .eq('id', universe.id)
        .eq('workspace_id', workspaceId)

      if (linkErr) {
        errors.push({ brand_key: universe.brand_key, error: `link: ${linkErr.message}` })
        continue
      }

      results.push({
        brand_key: universe.brand_key,
        seed_id: seed.id,
        universe_id: universe.id,
        mode: seed.mode,
        target: seed.target,
        strategy: plan.strategy,
        secondary_seed_id: secondaryId,
      })
    } catch (e: any) {
      errors.push({ brand_key: universe.brand_key, error: e?.message || String(e) })
    }
  }

  return {
    materialized: results.length,
    seeds: results,
    errors,
    preferred_hour_note: 'UTC (preferred_hour=10 ≈ 18:00 SGT)',
    detail_top_n: 0,
    note: 'shop_primary when shop_username confirmed; else serp_only',
  }
}
