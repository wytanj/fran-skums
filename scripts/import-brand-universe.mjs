#!/usr/bin/env node
/**
 * Import sample-brands.csv into marketplace_brand_universe.
 *
 * Usage:
 *   node scripts/import-brand-universe.mjs --workspace <uuid> [--dry-run]
 *   node scripts/import-brand-universe.mjs --workspace <uuid> --file path/to.csv
 *
 * Env:
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY  (or NUXT_PUBLIC_SUPABASE_URL / SUPABASE_KEY)
 *
 * Default pilot_tier=paused — does not create crawl seeds (PR-2 materialize).
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSampleBrandsCsv } from '../marketplace/brandKey.mjs'

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
    file: resolve(ROOT, 'sample-brands.csv'),
    dryRun: false,
    marketplace: 'shopee',
    country: 'sg',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workspace' || a === '-w') opts.workspace = argv[++i]
    else if (a === '--file' || a === '-f') opts.file = resolve(argv[++i])
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--marketplace') opts.marketplace = argv[++i]
    else if (a === '--country') opts.country = String(argv[++i] || 'sg').toLowerCase()
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node scripts/import-brand-universe.mjs --workspace <uuid> [--dry-run] [--file path]
Default file: sample-brands.csv
Writes pilot_tier=paused. Does not materialize crawl seeds.`)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${a}`)
    }
  }
  return opts
}

async function main() {
  loadDotEnv(resolve(ROOT, '.env'))
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.workspace) {
    console.error('Missing --workspace <uuid>')
    process.exit(1)
  }
  if (!existsSync(opts.file)) {
    console.error(`File not found: ${opts.file}`)
    process.exit(1)
  }

  const csvText = readFileSync(opts.file, 'utf8')
  const parsed = parseSampleBrandsCsv(csvText, { source: 'sample-brands.csv' })
  console.log(
    JSON.stringify(
      {
        dry_run: opts.dryRun,
        file: opts.file,
        workspace_id: opts.workspace,
        ...parsed.stats,
        skipped: parsed.skipped.length,
        sample_keys: parsed.rows.slice(0, 5).map((r) => r.brand_key),
      },
      null,
      2,
    ),
  )

  if (opts.dryRun) {
    console.log(`Dry run: ${parsed.rows.length} unique brands (no DB write)`)
    process.exit(0)
  }

  const url = process.env.SUPABASE_URL || process.env.NUXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY
  if (!url || !key) {
    console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env')
    process.exit(1)
  }

  const db = createClient(url, key, { auth: { persistSession: false } })
  const now = new Date().toISOString()
  let upserted = 0
  let errors = 0

  // Upsert in batches of 50
  const batchSize = 50
  for (let i = 0; i < parsed.rows.length; i += batchSize) {
    const chunk = parsed.rows.slice(i, i + batchSize)
    const payload = chunk.map((r) => ({
      workspace_id: opts.workspace,
      brand_key: r.brand_key,
      display_name: r.display_name,
      categories: r.categories,
      origin_country: r.origin_country,
      official_interest: r.official_interest,
      shopee_mall_interest: r.shopee_mall_interest,
      iherb_interest: r.iherb_interest,
      followers_note: r.followers_note,
      marketplace: opts.marketplace,
      country: opts.country,
      pilot_tier: 'paused',
      enabled: true,
      priority: r.priority,
      source: r.source,
      imported_at: now,
      metadata: {
        csv_nos: r.csv_nos,
        import_script: 'import-brand-universe.mjs',
      },
    }))

    const { data, error } = await db
      .from('marketplace_brand_universe')
      .upsert(payload, {
        onConflict: 'workspace_id,marketplace,country,brand_key',
      })
      .select('brand_key')

    if (error) {
      console.error('Upsert error:', error.message)
      errors++
    } else {
      upserted += data?.length || chunk.length
    }
  }

  console.log(JSON.stringify({ upserted, errors, unique: parsed.rows.length }, null, 2))
  if (errors) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
