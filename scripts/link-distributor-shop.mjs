#!/usr/bin/env node
/**
 * Link a multi-brand distributor Mall shop to several brand_keys, from the CLI.
 *
 * The extension and POST /api/v1/marketplace/brand-universe/resolve-distributor-shop
 * do the same job for an operator with a browser. This exists for the cases where
 * that is the wrong tool: repairing a shop that was linked as single_brand, and
 * doing it reproducibly with a diff you can read before committing to it.
 *
 * Why it matters that shop_kind is right: isMultiBrandDistributor() reads it, and
 * when it is 'single_brand' the harvest never loads brand_profiles, so every
 * product on the shop inherits the seed's brand_key. That is how wishtrend.sg
 * filed 94 listings — Klairs, I'm From and By Wishtrend alike — as dear-klairs.
 * In multi mode an unattributed product becomes brand_key = null instead, which
 * is honest.
 *
 * Reuses mergeDistributorMetadata / universeShopPatchFromResolve so the row shape
 * cannot drift from what the API writes.
 *
 * Usage:
 *   node scripts/link-distributor-shop.mjs --shop wishtrend.sg --brands dear-klairs,im-from --dry-run
 *   node scripts/link-distributor-shop.mjs --shop wishtrend.sg --brands dear-klairs,im-from
 *
 * Options:
 *   --shop <username>     Mall shop username (no @, no URL)
 *   --brands a,b[,c]      brand_keys to link. Merged with brands already on the
 *                         shop unless --replace. Two or more required in total.
 *   --replace             Set the shop's brand set to exactly --brands
 *   --workspace <uuid>    Defaults to the only workspace, or MARKETPLACE_WORKSPACE_ID
 *   --alias k=a|b         Add title aliases for a brand (repeatable). Needed when
 *                         Shopee titles use a short form of the brand name.
 *   --dry-run             Print the diff and change nothing
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import {
  SHOP_KIND_DISTRIBUTOR,
  mergeDistributorMetadata,
} from '../marketplace/distributorShop.mjs'
import { universeShopPatchFromResolve } from '../marketplace/resolveShopUsername.mjs'

function parseArgs(argv) {
  const o = { shop: '', brands: [], replace: false, workspace: '', dryRun: false, aliases: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--shop') o.shop = String(argv[++i] || '')
    else if (a === '--brands') o.brands = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--workspace') o.workspace = String(argv[++i] || '')
    else if (a === '--replace') o.replace = true
    else if (a === '--dry-run') o.dryRun = true
    else if (a === '--alias') {
      // --alias dear-klairs=klairs|dearklairs   (repeatable)
      const raw = String(argv[++i] || '')
      const eq = raw.indexOf('=')
      if (eq > 0) {
        const key = raw.slice(0, eq).toLowerCase().trim()
        const vals = raw.slice(eq + 1).split('|').map((s) => s.trim()).filter(Boolean)
        if (key && vals.length) (o.aliases[key] ||= []).push(...vals)
      }
    }
    else if (a === '--help' || a === '-h') o.help = true
  }
  return o
}

function normaliseShop(input) {
  return String(input || '')
    .trim()
    .replace(/^https?:\/\/[^/]+\//i, '')
    .replace(/^@/, '')
    .replace(/[#?].*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

const opts = parseArgs(process.argv.slice(2))
if (opts.help || !opts.shop || !opts.brands.length) {
  console.log(readUsage())
  process.exit(opts.help ? 0 : 1)
}

function readUsage() {
  return [
    'Usage: node scripts/link-distributor-shop.mjs --shop <username> --brands a,b [--replace] [--dry-run]',
    '',
    'Links a Mall shop to 2+ brand_keys and sets shop_kind=multi_brand_distributor,',
    'so the harvest attributes per product title instead of filing everything under',
    'the seed brand.',
  ].join('\n')
}

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(1)
}
const db = createClient(url, serviceKey)

/**
 * Merge --alias values into metadata.aliases.
 *
 * The title matcher builds needles from display_name and brand_key only, so a
 * brand whose Shopee titles use a short form — "Klairs" for Dear Klairs — never
 * matches without one of these.
 */
function withAliases(meta, brandKey) {
  const extra = opts.aliases[brandKey] || []
  if (!extra.length) return meta
  const existing = Array.isArray(meta.aliases) ? meta.aliases : []
  const merged = []
  const seen = new Set()
  for (const a of [...existing, ...extra]) {
    const v = String(a || '').trim()
    if (!v || seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase())
    merged.push(v)
  }
  return { ...meta, aliases: merged }
}

const shop_username = normaliseShop(opts.shop)
const requested = opts.brands.map((b) => b.toLowerCase().trim())

async function resolveWorkspace() {
  if (opts.workspace) return opts.workspace
  if (process.env.MARKETPLACE_WORKSPACE_ID) return process.env.MARKETPLACE_WORKSPACE_ID
  const { data } = await db.from('workspaces').select('id, name').order('created_at').limit(2)
  if (!data?.length) throw new Error('no workspaces found')
  if (data.length > 1) {
    throw new Error(
      `more than one workspace — pass --workspace. Found: ${data.map((w) => `${w.name} (${w.id})`).join(', ')}`,
    )
  }
  return data[0].id
}

const workspaceId = await resolveWorkspace()

// Brands already sitting on this shop, so a partial --brands list merges rather
// than quietly unlinking the others.
const { data: onShop, error: onShopErr } = await db
  .from('marketplace_brand_universe')
  .select('id, brand_key, shop_kind, metadata')
  .eq('workspace_id', workspaceId)
  .eq('shop_username', shop_username)
if (onShopErr) throw new Error(onShopErr.message)

const existingKeys = new Set()
for (const r of onShop || []) {
  existingKeys.add(String(r.brand_key).toLowerCase())
  const meta = r.metadata && typeof r.metadata === 'object' ? r.metadata : {}
  for (const k of meta.distributor_brand_keys || []) existingKeys.add(String(k).toLowerCase())
}

const brand_keys = opts.replace
  ? [...new Set(requested)]
  : [...new Set([...requested, ...existingKeys])]

if (brand_keys.length < 2) {
  console.error(
    `A multi-brand distributor needs 2+ brands. Requested: ${requested.join(', ') || '(none)'}; `
      + `already on @${shop_username}: ${existingKeys.size ? [...existingKeys].join(', ') : '(none)'}`,
  )
  process.exit(1)
}

const { data: rows, error: rowsErr } = await db
  .from('marketplace_brand_universe')
  .select('id, brand_key, display_name, shop_username, shop_kind, shop_resolve_status, metadata')
  .eq('workspace_id', workspaceId)
  .in('brand_key', brand_keys)
if (rowsErr) throw new Error(rowsErr.message)

const found = new Map((rows || []).map((r) => [String(r.brand_key).toLowerCase(), r]))
const missing = brand_keys.filter((k) => !found.has(k))
if (missing.length) {
  console.error(`brand_key not in the universe: ${missing.join(', ')}`)
  console.error('Add the brand first — this script will not invent universe rows.')
  process.exit(1)
}

console.log(`shop      @${shop_username}`)
console.log(`workspace ${workspaceId}`)
console.log(`brands    ${brand_keys.join(', ')}${opts.replace ? '  (replace)' : '  (merged)'}`)
console.log('')
console.log('before:')
for (const k of brand_keys) {
  const r = found.get(k)
  console.log(
    `  ${k.padEnd(16)} shop=${String(r.shop_username || '—').padEnd(16)} kind=${r.shop_kind} status=${r.shop_resolve_status}`,
  )
}

if (opts.dryRun) {
  console.log('')
  console.log('after (dry run — nothing written):')
  for (const k of brand_keys) {
    console.log(`  ${k.padEnd(16)} shop=${shop_username.padEnd(16)} kind=${SHOP_KIND_DISTRIBUTOR} status=confirmed`)
  }
  process.exit(0)
}

const resolved = {
  // universeShopPatchFromResolve() branches on `ok`: without it the patch drops
  // shop_username/shop_url and writes only the resolve status, which leaves a row
  // claiming 'confirmed' with no shop attached.
  ok: true,
  shop_username,
  shop_url: `https://shopee.sg/${shop_username}`,
  shop_id: null,
  status: 'confirmed',
  source: 'manual',
  evidence: {
    via: 'script_link_distributor_shop',
    distributor_brand_keys: brand_keys,
    merged: !opts.replace,
    linked_at: new Date().toISOString(),
  },
}

let changed = 0
for (const key of brand_keys) {
  const row = found.get(key)
  const patch = {
    ...universeShopPatchFromResolve(resolved),
    shop_kind: SHOP_KIND_DISTRIBUTOR,
    shop_resolve_status: 'confirmed',
    shop_resolve_source: 'manual',
    metadata: withAliases(
      mergeDistributorMetadata(row.metadata || {}, {
        shop_username,
        brand_keys,
        shop_kind: SHOP_KIND_DISTRIBUTOR,
      }),
      key,
    ),
  }
  const { error } = await db
    .from('marketplace_brand_universe')
    .update(patch)
    .eq('id', row.id)
    .eq('workspace_id', workspaceId)
  if (error) throw new Error(`${key}: ${error.message}`)
  changed += 1
}

const { data: after } = await db
  .from('marketplace_brand_universe')
  .select('brand_key, shop_username, shop_kind, shop_resolve_status')
  .eq('workspace_id', workspaceId)
  .in('brand_key', brand_keys)

console.log('')
console.log(`after (${changed} row(s) updated):`)
let broken = 0
for (const r of after || []) {
  console.log(
    `  ${String(r.brand_key).padEnd(16)} shop=${String(r.shop_username || '—').padEnd(16)} kind=${r.shop_kind} status=${r.shop_resolve_status}`,
  )
  // A row that claims 'confirmed' without a shop_username is unusable: the
  // harvest has nothing to visit, and shouldUseShopPrimary() will refuse it.
  if (!r.shop_username || r.shop_resolve_status !== 'confirmed' || r.shop_kind !== SHOP_KIND_DISTRIBUTOR) {
    broken += 1
  }
}
if (broken) {
  console.error('')
  console.error(`✗ ${broken} row(s) did not end up fully linked — see above.`)
  process.exit(1)
}
console.log('')
console.log('Existing snapshots keep their old brand_key — re-harvest the shop to redistribute them.')
