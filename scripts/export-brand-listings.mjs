#!/usr/bin/env node
/**
 * Local brand-radar CSV/JSON export (no Vercel deploy required).
 *
 *   node scripts/export-brand-listings.mjs -w <uuid> --brand biodance --format csv -o biodance.csv
 *   node scripts/export-brand-listings.mjs -w <uuid> --brand biodance --format json --summary
 *   node scripts/export-brand-listings.mjs -w <uuid> --brand biodance --min-sold 1000 --format csv
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  queryBrandListings,
  queryBrandSummary,
} from '../marketplace/brandListingsQuery.mjs'

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
    brandKeys: null,
    brandKey: null,
    minSold: null,
    shelf: null,
    q: null,
    format: 'csv',
    limit: 200,
    out: null,
    summaryOnly: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workspace' || a === '-w') opts.workspace = argv[++i]
    else if (a === '--brand' || a === '--brands') {
      const raw = String(argv[++i] || '')
      const parts = raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
      if (parts.length === 1) opts.brandKey = parts[0]
      else opts.brandKeys = parts
    } else if (a === '--min-sold') opts.minSold = Number(argv[++i])
    else if (a === '--shelf' || a === '--shop-collection') opts.shelf = argv[++i]
    else if (a === '--q') opts.q = argv[++i]
    else if (a === '--format') opts.format = String(argv[++i] || 'csv').toLowerCase()
    else if (a === '--limit') opts.limit = Number(argv[++i]) || 200
    else if (a === '-o' || a === '--out') opts.out = argv[++i]
    else if (a === '--summary') opts.summaryOnly = true
    else if (a === '--help' || a === '-h') {
      console.log(`export-brand-listings.mjs -w <uuid> --brand <key> [--format csv|json] [-o file]

  --brand key[,key2]   Brand key(s)
  --min-sold N
  --shelf name         Marketing shelf substring
  --q text
  --limit N            default 200
  --format csv|json
  --summary            Print radar summary JSON only
  -o path              Write file (default stdout)`)
      process.exit(0)
    }
  }
  return opts
}

async function main() {
  loadDotEnv()
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.workspace) {
    console.error('Need --workspace')
    process.exitCode = 1
    return
  }
  if (!opts.brandKey && !opts.brandKeys?.length) {
    console.error('Need --brand')
    process.exitCode = 1
    return
  }

  const url = process.env.SUPABASE_URL || process.env.NUXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY
  if (!url || !key) {
    console.error('Need SUPABASE_URL + SERVICE_ROLE_KEY')
    process.exitCode = 1
    return
  }

  const db = createClient(url, key, { auth: { persistSession: false } })
  const filters = {
    brand_key: opts.brandKey || undefined,
    brand_keys: opts.brandKeys || undefined,
    shop_collection_name: opts.shelf || undefined,
    min_sold: opts.minSold,
    q: opts.q || undefined,
    limit: opts.limit,
  }

  if (opts.summaryOnly) {
    const s = await queryBrandSummary(db, opts.workspace, { ...filters, top_n: 10 })
    const text = JSON.stringify(s, null, 2)
    if (opts.out) writeFileSync(resolve(opts.out), text, 'utf8')
    else console.log(text)
    process.exitCode = 0
    return
  }

  const result = await queryBrandListings(db, opts.workspace, {
    ...filters,
    format: opts.format === 'json' ? 'json' : 'csv',
  })

  if (opts.format === 'json') {
    const text = JSON.stringify(result, null, 2)
    if (opts.out) writeFileSync(resolve(opts.out), text, 'utf8')
    else console.log(text)
  } else {
    const csv = result.csv || ''
    if (opts.out) {
      writeFileSync(resolve(opts.out), csv, 'utf8')
      console.error(`[export] wrote ${result.row_count} rows → ${opts.out}`)
      console.error(JSON.stringify(result.summary, null, 2))
    } else {
      console.log(csv)
    }
  }
  process.exitCode = 0
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
