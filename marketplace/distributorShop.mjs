/**
 * MH-7 — Multi-brand distributor shop helpers.
 */

import { normalizeBrandKeyList } from './attributeBrandFromTitle.mjs'

export const SHOP_KIND_SINGLE = 'single_brand'
export const SHOP_KIND_DISTRIBUTOR = 'multi_brand_distributor'

/**
 * @param {object | null} brand  universe row
 */
export function isMultiBrandDistributor(brand) {
  if (!brand) return false
  if (brand.shop_kind === SHOP_KIND_DISTRIBUTOR) return true
  const meta = brand.metadata && typeof brand.metadata === 'object' ? brand.metadata : {}
  return meta.shop_kind === SHOP_KIND_DISTRIBUTOR
}

/**
 * @param {object | null} brand
 * @returns {string[]}
 */
export function distributorBrandKeysFromRow(brand) {
  const meta = brand?.metadata && typeof brand.metadata === 'object' ? brand.metadata : {}
  const fromMeta = normalizeBrandKeyList(meta.distributor_brand_keys)
  if (fromMeta.length) return fromMeta
  if (brand?.brand_key) return [String(brand.brand_key).toLowerCase()]
  return []
}

/**
 * Merge metadata for a brand linked to a multi-brand shop.
 * @param {object} existingMeta
 * @param {{
 *   shop_username: string
 *   brand_keys: string[]
 *   shop_kind?: string
 * }} opts
 */
export function mergeDistributorMetadata(existingMeta, opts) {
  const meta = {
    ...(existingMeta && typeof existingMeta === 'object' ? existingMeta : {}),
  }
  meta.shop_kind = opts.shop_kind || SHOP_KIND_DISTRIBUTOR
  meta.distributor_brand_keys = normalizeBrandKeyList(opts.brand_keys)
  meta.distributor_shop_username = String(opts.shop_username || '')
    .toLowerCase()
    .trim()
  meta.distributor_linked_at = new Date().toISOString()
  return meta
}

/**
 * Load brand profiles for attribution given a shop_username.
 * @param {any} db
 * @param {string} workspaceId
 * @param {string} shopUsername
 * @returns {Promise<Array<{ brand_key: string, display_name: string, shop_kind: string, metadata: object }>>}
 */
export async function loadBrandsForShopUsername(db, workspaceId, shopUsername) {
  const user = String(shopUsername || '')
    .toLowerCase()
    .trim()
  if (!user) return []

  const { data, error } = await db
    .from('marketplace_brand_universe')
    .select('id, brand_key, display_name, shop_username, shop_kind, metadata, enabled')
    .eq('workspace_id', workspaceId)
    .eq('shop_username', user)
    .eq('enabled', true)
    .limit(100)

  if (error) throw new Error(error.message)
  let rows = data || []
  if (!rows.length) return []

  // Distributor Malls often stock brands linked to a *different* distributor shop
  // (e.g. Abib titles on younfamily.sg). Use the full multi_brand_distributor
  // allowlist for attribution, not only rows sharing this shop_username.
  const shopIsDistributor = rows.some((r) => isMultiBrandDistributor(r))
  if (shopIsDistributor) {
    const { data: allDist, error: eDist } = await db
      .from('marketplace_brand_universe')
      .select('id, brand_key, display_name, shop_username, shop_kind, metadata, enabled')
      .eq('workspace_id', workspaceId)
      .eq('shop_kind', SHOP_KIND_DISTRIBUTOR)
      .eq('enabled', true)
      .limit(200)
    if (eDist) throw new Error(eDist.message)
    if (allDist?.length) rows = allDist
  }

  // Expand allowlist: union of distributor_brand_keys + all rows sharing shop
  const keySet = new Set(rows.map((r) => String(r.brand_key).toLowerCase()))
  for (const r of rows) {
    for (const k of distributorBrandKeysFromRow(r)) keySet.add(k)
  }

  // If allowlist has brands not already in rows, fetch them for display_name
  const missing = [...keySet].filter((k) => !rows.some((r) => r.brand_key === k))
  let extra = []
  if (missing.length) {
    const { data: more, error: e2 } = await db
      .from('marketplace_brand_universe')
      .select('id, brand_key, display_name, shop_username, shop_kind, metadata, enabled')
      .eq('workspace_id', workspaceId)
      .in('brand_key', missing)
      .eq('enabled', true)
      .limit(100)
    if (e2) throw new Error(e2.message)
    extra = more || []
  }

  const byKey = new Map()
  for (const r of [...rows, ...extra]) {
    const meta = r.metadata && typeof r.metadata === 'object' ? r.metadata : {}
    byKey.set(String(r.brand_key).toLowerCase(), {
      brand_key: String(r.brand_key).toLowerCase(),
      display_name: r.display_name || r.brand_key,
      shop_kind: r.shop_kind || SHOP_KIND_SINGLE,
      metadata: meta,
      // buildBrandMatchProfile() reads `aliases`, but there is no aliases column
      // and nothing used to populate it — so the alias mechanism was dead code
      // and no brand could ever match a short form of its name. Dear Klairs is
      // the case that exposed it: display_name yields "dear klairs", while every
      // Shopee title says just "Klairs …", so 71 of 94 listings on wishtrend.sg
      // failed to attribute once the shop was correctly in multi-brand mode.
      aliases: Array.isArray(meta.aliases)
        ? meta.aliases.map((a) => String(a || '').trim()).filter(Boolean)
        : [],
    })
  }
  return [...byKey.values()]
}
