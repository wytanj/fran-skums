#!/usr/bin/env node
/**
 * Bulk-import shop resolutions from extension export JSON.
 *
 * File shape (array):
 *   [{ "brand_key": "anua", "shop_url": "https://shopee.sg/...", "shop_username": "..." }]
 *
 * Usage:
 *   node scripts/import-shop-resolutions.mjs --workspace <uuid> --file shops.json
 *   node scripts/import-shop-resolutions.mjs --workspace <uuid> --file shops.json --materialize
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveShopFromManualUrl,
  universeShopPatchFromResolve,
} from '../marketplace/resolveShopUsername.mjs'
import {
  buildSeedsForUniverse,
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
  const opts = { workspace: null, file: null, materialize: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workspace' || a === '-w') opts.workspace = argv[++i]
    else if (a === '--file' || a === '-f') opts.file = resolve(argv[++i])
    else if (a === '--materialize') opts.materialize = true
  }
  return opts
}

async function main() {
  loadDotEnv(resolve(ROOT, '.env'))
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.workspace || !opts.file) {
    console.error('Need --workspace and --file')
    process.exit(1)
  }
  const rows = JSON.parse(readFileSync(opts.file, 'utf8'))
  const list = Array.isArray(rows) ? rows : rows.resolutions || []

  const url = process.env.SUPABASE_URL || process.env.NUXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY
  const db = createClient(url, key, { auth: { persistSession: false } })

  const out = []
  for (const item of list) {
    const brand_key = String(item.brand_key || '').toLowerCase()
    const input = item.shop_url || item.shop_username
    const resolved = resolveShopFromManualUrl(input, {
      country: 'sg',
      brand_key,
    })
    if (!resolved.ok) {
      out.push({ brand_key, ok: false, error: resolved.error })
      continue
    }
    const patch = universeShopPatchFromResolve({
      ...resolved,
      status: item.status || 'confirmed',
      source: item.source || 'import',
    })
    const { data, error } = await db
      .from('marketplace_brand_universe')
      .update(patch)
      .eq('workspace_id', opts.workspace)
      .eq('brand_key', brand_key)
      .select('brand_key, shop_username, shop_resolve_status')
      .maybeSingle()
    out.push({ brand_key, ok: !error && data, data, error: error?.message })
  }

  if (opts.materialize) {
    const keys = out.filter((r) => r.ok).map((r) => r.brand_key)
    const { data: universeRows } = await db
      .from('marketplace_brand_universe')
      .select('*')
      .eq('workspace_id', opts.workspace)
      .in('brand_key', keys)
    for (const u of universeRows || []) {
      const plan = buildSeedsForUniverse(u, { collector_id: 'shopee_puppeteer' })
      await db
        .from('marketplace_crawl_seeds')
        .upsert({ ...plan.primary, workspace_id: opts.workspace }, {
          onConflict: seedUpsertConflictColumns(),
        })
      if (plan.secondary) {
        await db
          .from('marketplace_crawl_seeds')
          .upsert({ ...plan.secondary, workspace_id: opts.workspace }, {
            onConflict: seedUpsertConflictColumns(),
          })
      }
    }
  }

  console.log(JSON.stringify({ updated: out.filter((r) => r.ok).length, out }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
