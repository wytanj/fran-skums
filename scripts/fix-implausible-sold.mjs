#!/usr/bin/env node
/**
 * One-off repair: null out implausible sold counts already in the warehouse.
 *
 * Cause: the grid scraper matched "sold" against the whole product card, which
 * includes the title. A real listing —
 *   "Shopee x BANILA CO 7.7 Brand Box 100M Sold Cleansing Balm"
 * — was ingested as 100,000,000 units and made that brand the top seller in
 * every rollup. The extraction is fixed in mallHarvestWorker /
 * extension content.js; this repairs rows harvested before that.
 *
 * Non-destructive: the numeric is nulled so aggregates stop being wrong, but
 * the original label and value are preserved in `signals` for audit.
 *
 * Usage:
 *   node scripts/fix-implausible-sold.mjs -w <uuid> [--dry-run]
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_PLAUSIBLE_SOLD } from '../marketplace/soldLabel.mjs'

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

async function main() {
  loadDotEnv()
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const wsIdx = argv.findIndex((a) => a === '-w' || a === '--workspace')
  const workspace =
    wsIdx > -1 ? argv[wsIdx + 1] : process.env.MARKETPLACE_WORKSPACE_ID || null

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
    process.exitCode = 1
    return
  }
  if (!workspace) {
    console.error('Need -w <workspace uuid>')
    process.exitCode = 1
    return
  }

  const db = createClient(url, key, { auth: { persistSession: false } })

  const { data, error } = await db
    .from('marketplace_listing_snapshots')
    .select('id, sold_label, sold_count_lower_bound, signals')
    .eq('workspace_id', workspace)
    .gt('sold_count_lower_bound', MAX_PLAUSIBLE_SOLD)
    .limit(1000)

  if (error) throw new Error(error.message)

  console.error(
    `[fix-sold] ${data?.length || 0} snapshot(s) above the plausibility ceiling (${MAX_PLAUSIBLE_SOLD.toLocaleString()})`,
  )

  let fixed = 0
  for (const row of data || []) {
    console.error(
      `  ${row.sold_count_lower_bound?.toLocaleString()} — "${row.sold_label}" (${row.signals?.brand_key || '?'})`,
    )
    if (dryRun) continue
    const { error: upErr } = await db
      .from('marketplace_listing_snapshots')
      .update({
        sold_count_lower_bound: null,
        signals: {
          ...(row.signals || {}),
          sold_parse_suspect: true,
          sold_raw_rejected: row.sold_count_lower_bound,
          sold_raw_label: row.sold_label,
        },
      })
      .eq('id', row.id)
    if (upErr) console.error(`  ! ${row.id}: ${upErr.message}`)
    else fixed++
  }

  console.log(
    JSON.stringify(
      { dry_run: dryRun, found: data?.length || 0, fixed, ceiling: MAX_PLAUSIBLE_SOLD },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
