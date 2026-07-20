#!/usr/bin/env node
/**
 * MH-1 offline / ops: extract shop collections from saved Mall HTML and save to DB.
 *
 * Usage:
 *   node scripts/discover-shop-collections.mjs --workspace <uuid> \
 *     --html extensions/sample-beauty-of-joseon/*.html \
 *     --brand beauty-of-joseon
 *
 *   # Dry parse only:
 *   node scripts/discover-shop-collections.mjs --html path/to/shop.html --dry-run
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractShopCollectionsFromHtml,
  mergeShopCollectionsMetadata,
} from '../marketplace/shopCollections.mjs'
import { resolveShopFromManualUrl, universeShopPatchFromResolve } from '../marketplace/resolveShopUsername.mjs'

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
  const opts = { workspace: null, html: null, brand: null, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workspace' || a === '-w') opts.workspace = argv[++i]
    else if (a === '--html') opts.html = argv[++i]
    else if (a === '--brand') opts.brand = argv[++i]
    else if (a === '--dry-run') opts.dryRun = true
  }
  return opts
}

function resolveHtmlPath(p) {
  if (!p) {
    const dir = join(ROOT, 'extensions/sample-beauty-of-joseon')
    if (existsSync(dir)) {
      const f = readdirSync(dir).find((x) => x.endsWith('.html'))
      if (f) return join(dir, f)
    }
    return null
  }
  if (p.includes('*')) {
    // simple: sample dir
    const dir = join(ROOT, 'extensions/sample-beauty-of-joseon')
    const f = readdirSync(dir).find((x) => x.endsWith('.html'))
    return f ? join(dir, f) : null
  }
  return resolve(p)
}

async function main() {
  loadDotEnv()
  const opts = parseArgs(process.argv.slice(2))
  const htmlPath = resolveHtmlPath(opts.html)
  if (!htmlPath || !existsSync(htmlPath)) {
    console.error('HTML file not found')
    process.exit(1)
  }

  const html = readFileSync(htmlPath, 'utf8')
  const disc = extractShopCollectionsFromHtml(html, {
    page_url: 'https://shopee.sg/beautyofjoseonsg',
  })

  console.log(
    JSON.stringify(
      {
        file: basename(htmlPath),
        shop_username: disc.shop_username,
        collection_count: disc.collections.length,
        collections: disc.collections,
        dry_run: opts.dryRun,
      },
      null,
      2,
    ),
  )

  if (opts.dryRun || !opts.workspace) {
    if (!opts.workspace) console.error('(no --workspace: parse only)')
    return
  }

  const url = process.env.SUPABASE_URL || process.env.NUXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY
  const db = createClient(url, key, { auth: { persistSession: false } })

  const brandKey = (opts.brand || 'beauty-of-joseon').toLowerCase()
  const { data: row, error } = await db
    .from('marketplace_brand_universe')
    .select('*')
    .eq('workspace_id', opts.workspace)
    .eq('brand_key', brandKey)
    .maybeSingle()

  if (error || !row) {
    console.error('brand not found', error?.message)
    process.exit(1)
  }

  const meta = mergeShopCollectionsMetadata(row.metadata || {}, disc)
  const resolved = resolveShopFromManualUrl(disc.shop_username, {
    brand_key: brandKey,
    country: 'sg',
  })
  const shopPatch = resolved.ok
    ? universeShopPatchFromResolve({
        ...resolved,
        status: 'confirmed',
        source: 'import',
        evidence: { via: 'discover-shop-collections.mjs' },
      })
    : {}

  const { data: updated, error: upErr } = await db
    .from('marketplace_brand_universe')
    .update({
      metadata: meta,
      ...shopPatch,
    })
    .eq('id', row.id)
    .select('brand_key, shop_username, metadata')
    .single()

  if (upErr) {
    console.error(upErr.message)
    process.exit(1)
  }

  console.log(
    JSON.stringify(
      {
        saved: true,
        brand_key: updated.brand_key,
        shop_username: updated.shop_username,
        collection_count: updated.metadata?.shop_collections?.length,
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
