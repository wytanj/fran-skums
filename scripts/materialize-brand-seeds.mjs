#!/usr/bin/env node
/**
 * Materialize weekly brand_portfolio crawl seeds from marketplace_brand_universe.
 *
 * Usage:
 *   node scripts/materialize-brand-seeds.mjs --workspace <uuid>
 *   node scripts/materialize-brand-seeds.mjs --workspace <uuid> --pilot-allowlist --set-tier pilot
 *   node scripts/materialize-brand-seeds.mjs --workspace <uuid> --collector mock
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PILOT_BRAND_KEYS } from '../marketplace/brandKey.mjs'
import {
  buildSeedsForUniverse,
  filterUniverseForMaterialize,
  seedUpsertConflictColumns,
} from '../marketplace/materializeBrandSeeds.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return
  const text = readFileSync(filePath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key] !== undefined) continue
    let value = rawValue.trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function parseArgs(argv) {
  const opts = {
    workspace: null,
    pilotAllowlist: true,
    setTier: 'pilot',
    pilotTier: null,
    brandKeys: null,
    collector: 'shopee_puppeteer',
    enabled: true,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workspace' || a === '-w') opts.workspace = argv[++i]
    else if (a === '--pilot-allowlist') opts.pilotAllowlist = true
    else if (a === '--no-pilot-allowlist') opts.pilotAllowlist = false
    else if (a === '--set-tier') opts.setTier = argv[++i]
    else if (a === '--pilot-tier') opts.pilotTier = argv[++i]
    else if (a === '--brand-keys') opts.brandKeys = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--collector') opts.collector = argv[++i]
    else if (a === '--enabled=false') opts.enabled = false
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--help' || a === '-h') {
      console.log(`materialize-brand-seeds.mjs --workspace <uuid> [--pilot-allowlist] [--set-tier pilot] [--collector shopee_puppeteer|mock]`)
      process.exit(0)
    }
  }
  return opts
}

async function main() {
  loadDotEnv(resolve(ROOT, '.env'))
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.workspace) {
    console.error('Missing --workspace')
    process.exit(1)
  }

  let brandKeys = opts.brandKeys
  if (opts.pilotAllowlist && !brandKeys?.length) {
    brandKeys = [...PILOT_BRAND_KEYS]
  }

  console.log(
    JSON.stringify(
      {
        workspace_id: opts.workspace,
        brand_keys: brandKeys,
        set_tier: opts.setTier,
        collector_id: opts.collector,
        dry_run: opts.dryRun,
      },
      null,
      2,
    ),
  )

  if (opts.dryRun) {
    console.log('Dry-run: no DB writes')
    process.exit(0)
  }

  const url = process.env.SUPABASE_URL || process.env.NUXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY
  if (!url || !key) {
    console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const db = createClient(url, key, { auth: { persistSession: false } })

  if (opts.setTier && brandKeys?.length) {
    const { error: tierErr } = await db
      .from('marketplace_brand_universe')
      .update({ pilot_tier: opts.setTier })
      .eq('workspace_id', opts.workspace)
      .in('brand_key', brandKeys)
    if (tierErr) {
      console.error('set_tier failed:', tierErr.message)
      process.exit(1)
    }
  }

  const { data: allRows, error: listErr } = await db
    .from('marketplace_brand_universe')
    .select('*')
    .eq('workspace_id', opts.workspace)

  if (listErr) {
    console.error('list universe failed:', listErr.message)
    process.exit(1)
  }

  const selected = filterUniverseForMaterialize(allRows || [], {
    brand_keys: brandKeys,
    pilot_tier: brandKeys?.length ? null : opts.pilotTier,
    require_enabled: true,
  })

  if (!selected.length) {
    console.error('No matching universe rows. Import first?')
    process.exit(1)
  }

  const results = []
  const errors = []

  for (const universe of selected) {
    try {
      const plan = buildSeedsForUniverse(universe, {
        collector_id: opts.collector,
        enabled: opts.enabled,
        include_serp_secondary: true,
      })
      const seedRow = { ...plan.primary, workspace_id: opts.workspace }

      const { data: seed, error: seedErr } = await db
        .from('marketplace_crawl_seeds')
        .upsert(seedRow, { onConflict: seedUpsertConflictColumns() })
        .select('*')
        .single()

      if (seedErr || !seed) {
        errors.push({ brand_key: universe.brand_key, error: seedErr?.message || 'upsert failed' })
        continue
      }

      let secondary = null
      if (plan.secondary) {
        const secRow = { ...plan.secondary, workspace_id: opts.workspace }
        const { data: sec, error: secErr } = await db
          .from('marketplace_crawl_seeds')
          .upsert(secRow, { onConflict: seedUpsertConflictColumns() })
          .select('id, mode, target')
          .single()
        if (!secErr && sec) secondary = sec
      }

      const { error: linkErr } = await db
        .from('marketplace_brand_universe')
        .update({ primary_seed_id: seed.id })
        .eq('id', universe.id)
        .eq('workspace_id', opts.workspace)

      if (linkErr) {
        errors.push({ brand_key: universe.brand_key, error: `link: ${linkErr.message}` })
        continue
      }

      results.push({
        brand_key: universe.brand_key,
        display_name: universe.display_name,
        strategy: plan.strategy,
        shop_username: universe.shop_username || null,
        seed_id: seed.id,
        mode: seed.mode,
        target: seed.target,
        next_run_at: seed.next_run_at,
        collector_id: seed.collector_id,
        secondary,
      })
    } catch (e) {
      errors.push({ brand_key: universe.brand_key, error: e?.message || String(e) })
    }
  }

  console.log(
    JSON.stringify(
      {
        materialized: results.length,
        shop_primary: results.filter((r) => r.strategy === 'shop_primary').length,
        serp_only: results.filter((r) => r.strategy === 'serp_only').length,
        errors: errors.length ? errors : undefined,
        preferred_hour_note: 'UTC (preferred_hour=10 ≈ 18:00 SGT)',
        detail_top_n: 0,
        seeds: results,
      },
      null,
      2,
    ),
  )

  if (errors.length && !results.length) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
