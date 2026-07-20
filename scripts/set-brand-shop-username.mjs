#!/usr/bin/env node
/**
 * Set confirmed Shopee Mall shop_username on brand universe (before shop scrape).
 *
 * Usage:
 *   node scripts/set-brand-shop-username.mjs --workspace <uuid> \
 *     --brand beauty-of-joseon \
 *     --url "https://shopee.sg/beautyofjoseonsg?categoryId=100630&itemId=28707244664"
 *
 *   node scripts/set-brand-shop-username.mjs --workspace <uuid> --brand cosrx --username cosrx.sg
 *
 * Then re-run materialize-brand-seeds to flip primary seed to mode=shop.
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveShopFromManualUrl,
  universeShopPatchFromResolve,
  heuristicShopUsernameCandidates,
} from '../marketplace/resolveShopUsername.mjs'

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
    brand: null,
    url: null,
    username: null,
    suggest: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workspace' || a === '-w') opts.workspace = argv[++i]
    else if (a === '--brand' || a === '-b') opts.brand = argv[++i]
    else if (a === '--url' || a === '-u') opts.url = argv[++i]
    else if (a === '--username') opts.username = argv[++i]
    else if (a === '--suggest') opts.suggest = true
    else if (a === '--help') {
      console.log(`set-brand-shop-username.mjs --workspace <uuid> --brand <brand_key|display> --url <mall_url>`)
      process.exit(0)
    }
  }
  return opts
}

async function main() {
  loadDotEnv(resolve(ROOT, '.env'))
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.workspace || !opts.brand) {
    console.error('Need --workspace and --brand')
    process.exit(1)
  }
  if (!opts.url && !opts.username && !opts.suggest) {
    console.error('Need --url or --username (or --suggest for heuristic shortlist only)')
    process.exit(1)
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
  const brandQ = String(opts.brand).trim()

  const { data: rows, error } = await db
    .from('marketplace_brand_universe')
    .select('*')
    .eq('workspace_id', opts.workspace)
    .or(`brand_key.eq.${brandQ},display_name.ilike.${brandQ}`)

  if (error) {
    console.error(error.message)
    process.exit(1)
  }

  // Fallback filter client-side if or syntax fussy
  let row = (rows || []).find(
    (r) =>
      r.brand_key === brandQ.toLowerCase() ||
      r.brand_key === brandQ ||
      String(r.display_name).toLowerCase() === brandQ.toLowerCase(),
  )
  if (!row && rows?.length === 1) row = rows[0]
  if (!row) {
    // try brand_key only
    const { data: byKey } = await db
      .from('marketplace_brand_universe')
      .select('*')
      .eq('workspace_id', opts.workspace)
      .eq('brand_key', brandQ.toLowerCase().replace(/\s+/g, '-'))
      .maybeSingle()
    row = byKey
  }
  if (!row) {
    const { data: all } = await db
      .from('marketplace_brand_universe')
      .select('brand_key, display_name')
      .eq('workspace_id', opts.workspace)
      .ilike('display_name', `%${brandQ}%`)
      .limit(10)
    console.error('Brand not found. Near matches:', all)
    process.exit(1)
  }

  if (opts.suggest) {
    console.log(
      JSON.stringify(
        {
          brand_key: row.brand_key,
          display_name: row.display_name,
          heuristic_candidates: heuristicShopUsernameCandidates(row.display_name, {
            country: row.country || 'sg',
          }),
          note: 'Candidates only — do not scrape as primary until confirmed via --url',
        },
        null,
        2,
      ),
    )
    process.exit(0)
  }

  const input = opts.url || opts.username
  const resolved = resolveShopFromManualUrl(input, {
    country: row.country || 'sg',
    brand_key: row.brand_key,
  })
  if (!resolved.ok) {
    console.error(resolved)
    process.exit(1)
  }

  const patch = universeShopPatchFromResolve(resolved)
  const { data: updated, error: upErr } = await db
    .from('marketplace_brand_universe')
    .update(patch)
    .eq('id', row.id)
    .select('*')
    .single()

  if (upErr) {
    console.error(upErr.message)
    process.exit(1)
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        brand_key: updated.brand_key,
        shop_username: updated.shop_username,
        shop_url: updated.shop_url,
        shop_resolve_status: updated.shop_resolve_status,
        next: 'node scripts/materialize-brand-seeds.mjs --workspace ' + opts.workspace,
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
