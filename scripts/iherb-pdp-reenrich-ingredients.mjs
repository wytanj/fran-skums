#!/usr/bin/env node
/**
 * Targeted re-enrich of iHerb PDPs that are missing ingredients_text.
 *
 * The first specs pass ran a parser that only knew the old prodOverview* /
 * bare-<h3>Ingredients layout. Pages using the newer .ingredient-info /
 * #product-supplement-facts markup (<h3><strong>Other ingredients</strong>…)
 * scored null and left ~6% of SKUs without ingredients they actually publish.
 * parseProductIngredients now handles that layout; this re-navigates only the
 * still-missing rows and rewrites them.
 *
 *   node scripts/iherb-pdp-reenrich-ingredients.mjs            # dry-run: list
 *   node scripts/iherb-pdp-reenrich-ingredients.mjs --connect  # live, all rows
 *   node scripts/iherb-pdp-reenrich-ingredients.mjs --connect --limit 10 --tabs 3
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectComputerBrowser } from '../marketplace/computerHarvest.mjs'
import { enrichIherbPdps } from '../marketplace/iherb/pdpEnrich.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const envp = resolve(ROOT, '.env')
if (existsSync(envp)) for (const line of readFileSync(envp, 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#')) continue; const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (!m || process.env[m[1]] !== undefined) continue; let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[m[1]] = v }

const argv = process.argv.slice(2)
const opts = { connect: null, limit: 0, tabs: 3, delayMs: undefined }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--connect') { const n = argv[i + 1]; if (n && !n.startsWith('-')) opts.connect = argv[++i]; else opts.connect = 'http://127.0.0.1:9222' }
  else if (a === '--limit') opts.limit = Number(argv[++i] || 0)
  else if (a === '--tabs') opts.tabs = Number(argv[++i] || 3)
  else if (a === '--delay-ms') opts.delayMs = Number(argv[++i])
  else if (a === '-w') opts.workspace = argv[++i]
}
const ws = opts.workspace || process.env.FRAN_MCP_WORKSPACE_ID
const CDP = opts.connect || process.env.IHERB_CDP_URL || process.env.SHOPEE_CDP_URL

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Load every product still missing ingredients_text with a real /pr/ PDP url.
let all = []
let from = 0
for (;;) {
  const { data, error } = await db
    .from('iherb_products')
    .select('id, part_number, product_id, brand_key, name, url, metadata')
    .eq('workspace_id', ws)
    .range(from, from + 999)
  if (error) { console.error(error); process.exit(1) }
  all = all.concat(data || [])
  if (!data || data.length < 1000) break
  from += 1000
}

let candidates = all
  .filter((r) => !r.metadata?.ingredients_text && /iherb\.com\/pr\//i.test(r.url || ''))
  .map((r) => ({
    product_row_id: r.id,
    part_number: r.part_number,
    product_id: r.product_id,
    brand_key: r.brand_key,
    name: r.name,
    url: r.url,
    sold_lower_bound: null,
  }))

if (opts.limit > 0) candidates = candidates.slice(0, opts.limit)

console.error(`[reenrich] ${candidates.length} rows missing ingredients${opts.limit ? ` (capped ${opts.limit})` : ''}`)

if (!opts.connect) {
  console.log(JSON.stringify({
    dry_run: true,
    missing_ingredients: candidates.length,
    by_brand: Object.entries(candidates.reduce((m, c) => ((m[c.brand_key] = (m[c.brand_key] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 15),
    sample: candidates.slice(0, 8).map((c) => ({ b: c.brand_key, part: c.part_number, name: (c.name || '').slice(0, 45) })),
  }, null, 2))
  process.exit(0)
}

const { browser } = await connectComputerBrowser(CDP)
const pages = []
for (let i = 0; i < Math.max(1, opts.tabs); i++) {
  try { pages.push(await browser.newPage()) } catch { /* cap reached */ break }
}
if (!pages.length) pages.push((await browser.pages())[0])

try {
  const result = await enrichIherbPdps(pages, {
    workspace_id: ws,
    db,
    candidates,
    fast: true,
    concurrency: pages.length,
    delay_ms: opts.delayMs,
  })
  console.log(JSON.stringify({
    ok: result.ok, failed: result.failed, blocked: result.blocked, candidates: result.candidates,
    sample: result.rows.filter((r) => r.ok).slice(0, 8).map((r) => ({ part: r.part_number, gtin: r.gtin })),
    failed_sample: result.rows.filter((r) => !r.ok && !r.skipped).slice(0, 8).map((r) => ({ part: r.part_number, reason: r.reason || r.error || r.health })),
  }, null, 2))
  if (result.blocked >= 3) process.exitCode = 2
} finally {
  for (const p of pages) { try { await p.close() } catch { /* ignore */ } }
  try { browser.disconnect() } catch { /* ignore */ }
}
