#!/usr/bin/env node
/**
 * Local export of recipe **full** (one Excel sheet per brand).
 *
 *   node scripts/export-brand-workbook.mjs -w <uuid> [--out path.xlsx] [--min-sold N]
 *
 * Uses SUPABASE_URL + SERVICE_ROLE from .env (same as harvest scripts).
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildBrandWorkbook } from '../marketplace/exportBrandWorkbook.mjs'

function loadEnv() {
  const p = resolve('.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const k = t.slice(0, i)
    let v = t.slice(i + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    if (process.env[k] === undefined) process.env[k] = v
  }
}

function parseArgs(argv) {
  const opts = {
    workspace: 'c21c057f-ea01-4e19-bc79-fafcf2626b19',
    out: null,
    minSold: undefined,
    maxBrands: 120,
    brandKeys: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-w' || a === '--workspace') opts.workspace = argv[++i]
    else if (a === '--out' || a === '-o') opts.out = argv[++i]
    else if (a === '--min-sold') opts.minSold = Number(argv[++i])
    else if (a === '--max-brands') opts.maxBrands = Number(argv[++i]) || 120
    else if (a === '--brand-keys') {
      opts.brandKeys = String(argv[++i] || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage: node scripts/export-brand-workbook.mjs -w <uuid> [-o out.xlsx]
  --min-sold N
  --max-brands N   (default 120)
  --brand-keys a,b,c`)
      process.exit(0)
    }
  }
  return opts
}

loadEnv()
const opts = parseArgs(process.argv.slice(2))
const url = process.env.SUPABASE_URL || process.env.NUXT_PUBLIC_SUPABASE_URL
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY
if (!url || !key) {
  console.error('Need SUPABASE_URL + SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })
console.error('[export] building full workbook…')
const built = await buildBrandWorkbook(db, opts.workspace, {
  recipe: 'full',
  min_sold: opts.minSold,
  max_brands: opts.maxBrands,
  brand_keys: opts.brandKeys,
})
const out = resolve(opts.out || built.filename)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, built.buffer)
console.error(
  `[export] wrote ${out} sheets=${built.sheet_count} rows=${built.row_count} bytes=${built.buffer.length}`,
)
console.log(
  JSON.stringify(
    {
      ok: true,
      path: out,
      filename: built.filename,
      sheet_count: built.sheet_count,
      row_count: built.row_count,
      brands: built.brands?.length,
    },
    null,
    2,
  ),
)
