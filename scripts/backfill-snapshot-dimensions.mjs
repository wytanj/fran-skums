#!/usr/bin/env node
/**
 * Track RP — backfill the denormalised snapshot dimensions added in mig 076.
 *
 * New harvests populate these on write (upsertObservations.snapshotDimensions).
 * Existing rows have them NULL, which would make the SQL filters in
 * brandListingsQuery silently exclude all historical data — the same class of
 * bug this track exists to remove. So this must run once after mig 076.
 *
 * Idempotent: only touches rows where the derived value differs from what is
 * stored, so re-running is cheap and safe.
 *
 * Usage:
 *   node scripts/backfill-snapshot-dimensions.mjs -w <uuid> [--dry-run] [--batch 500]
 *   node scripts/backfill-snapshot-dimensions.mjs --all-workspaces
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { snapshotDimensions } from '../marketplace/writers/upsertObservations.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

function loadDotEnv() {
  const p = resolve(ROOT, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m || process.env[m[1]] !== undefined) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    process.env[m[1]] = v
  }
}

function parseArgs(argv) {
  const opts = {
    workspace: process.env.MARKETPLACE_WORKSPACE_ID || process.env.FRAN_MCP_WORKSPACE_ID || null,
    allWorkspaces: false,
    dryRun: false,
    batch: 500,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workspace' || a === '-w') opts.workspace = argv[++i]
    else if (a === '--all-workspaces') opts.allWorkspaces = true
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--batch') opts.batch = Math.min(Math.max(Number(argv[++i]) || 500, 50), 1000)
    else if (a === '--help' || a === '-h') {
      console.log(`backfill-snapshot-dimensions.mjs -w <uuid> [--dry-run] [--batch N]

Populates brand_key / shop_username / shop_collection_name /
platform_category_leaf on marketplace_listing_snapshots from signals (mig 076).

  -w, --workspace <uuid>  Workspace to backfill
  --all-workspaces        Every workspace with snapshots
  --dry-run               Report what would change, write nothing
  --batch N               Rows per page (default 500, max 1000)`)
      process.exit(0)
    }
  }
  return opts
}

async function backfillWorkspace(db, workspaceId, opts) {
  const stats = { scanned: 0, changed: 0, unchanged: 0, errors: 0 }
  let from = 0

  for (;;) {
    const { data, error } = await db
      .from('marketplace_listing_snapshots')
      .select('id, signals, brand_key, shop_username, shop_collection_name, platform_category_leaf')
      .eq('workspace_id', workspaceId)
      .order('id', { ascending: true })
      .range(from, from + opts.batch - 1)

    if (error) throw new Error(error.message)
    if (!data?.length) break

    for (const row of data) {
      stats.scanned++
      const want = snapshotDimensions(row.signals)
      const differs =
        want.brand_key !== (row.brand_key ?? null)
        || want.shop_username !== (row.shop_username ?? null)
        || want.shop_collection_name !== (row.shop_collection_name ?? null)
        || want.platform_category_leaf !== (row.platform_category_leaf ?? null)

      if (!differs) {
        stats.unchanged++
        continue
      }
      stats.changed++
      if (opts.dryRun) continue

      const { error: upErr } = await db
        .from('marketplace_listing_snapshots')
        .update(want)
        .eq('id', row.id)
      if (upErr) {
        stats.errors++
        console.error(`[backfill] ${row.id}: ${upErr.message}`)
      }
    }

    if (data.length < opts.batch) break
    from += opts.batch
    console.error(`[backfill] ${workspaceId}: ${stats.scanned} scanned, ${stats.changed} changed…`)
  }

  return stats
}

async function main() {
  loadDotEnv()
  const opts = parseArgs(process.argv.slice(2))

  const url = process.env.SUPABASE_URL || process.env.NUXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    console.error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
    process.exitCode = 1
    return
  }
  if (!opts.workspace && !opts.allWorkspaces) {
    console.error('Need --workspace <uuid> or --all-workspaces')
    process.exitCode = 1
    return
  }

  const db = createClient(url, key, { auth: { persistSession: false } })

  let workspaceIds = [opts.workspace]
  if (opts.allWorkspaces) {
    const { data, error } = await db.from('workspaces').select('id').limit(200)
    if (error) throw new Error(error.message)
    workspaceIds = (data || []).map((w) => w.id)
  }

  const results = {}
  for (const wsId of workspaceIds) {
    if (!wsId) continue
    console.error(`\n[backfill] workspace ${wsId}${opts.dryRun ? ' (dry-run)' : ''}`)
    results[wsId] = await backfillWorkspace(db, wsId, opts)
  }

  console.log(JSON.stringify({ dry_run: opts.dryRun, results }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
