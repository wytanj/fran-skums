/**
 * MH-1 — Save discovered Mall shop collections onto brand universe.
 *
 * POST /api/v1/marketplace/brand-universe/collections
 * Scope: intel:write
 *
 * Body:
 *   brand_key? | id?
 *   shop_username?
 *   collections: [{ name, shop_collection_id, url?, is_all_products? }]
 *   confirm_shop?: boolean  (default true when shop_username present)
 */
import { requireApiKey } from '../../../../utils/apiAuth'
import { mergeShopCollectionsMetadata } from '../../../../../marketplace/shopCollections.mjs'
import { resolveShopFromManualUrl, universeShopPatchFromResolve } from '../../../../../marketplace/resolveShopUsername.mjs'
import { getServiceClient } from '../../../../utils/supabase'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:write')
  const body = await readBody(event)
  const collections = Array.isArray(body?.collections) ? body.collections : []
  if (!collections.length) {
    throw createError({ statusCode: 400, statusMessage: 'collections[] required' })
  }

  const db = getServiceClient()
  let row: any = null

  if (body?.id) {
    const { data } = await db
      .from('marketplace_brand_universe')
      .select('*')
      .eq('workspace_id', auth.workspaceId)
      .eq('id', body.id)
      .maybeSingle()
    row = data
  } else if (body?.brand_key) {
    const { data } = await db
      .from('marketplace_brand_universe')
      .select('*')
      .eq('workspace_id', auth.workspaceId)
      .eq('brand_key', String(body.brand_key).toLowerCase().trim())
      .maybeSingle()
    row = data
  } else if (body?.shop_username) {
    const { data } = await db
      .from('marketplace_brand_universe')
      .select('*')
      .eq('workspace_id', auth.workspaceId)
      .eq('shop_username', String(body.shop_username).toLowerCase().trim())
      .maybeSingle()
    row = data
  }

  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Brand universe row not found (brand_key, id, or shop_username)',
    })
  }

  const normalized = collections.map((c: any) => ({
    name: String(c.name || '').trim(),
    shop_collection_id: c.shop_collection_id != null ? String(c.shop_collection_id) : null,
    url: c.url || null,
    is_all_products: Boolean(c.is_all_products) || /all\s*products/i.test(String(c.name || '')),
  })).filter((c: any) => c.name)

  const meta = mergeShopCollectionsMetadata(row.metadata || {}, {
    shop_username: body.shop_username || row.shop_username,
    collections: normalized,
    discovered_at: new Date().toISOString(),
  })

  const patch: Record<string, unknown> = {
    metadata: meta,
  }

  // Optionally confirm shop identity
  const shopUser = body.shop_username || row.shop_username
  if (shopUser && body.confirm_shop !== false) {
    const resolved = resolveShopFromManualUrl(String(shopUser), {
      country: row.country || 'sg',
      brand_key: row.brand_key,
    })
    if (resolved.ok) {
      Object.assign(
        patch,
        universeShopPatchFromResolve({
          ...resolved,
          status: 'confirmed',
          source: 'import',
          evidence: {
            via: 'collections_discover',
            collection_count: normalized.length,
          },
        }),
      )
    }
  }

  const { data, error } = await db
    .from('marketplace_brand_universe')
    .update(patch)
    .eq('id', row.id)
    .eq('workspace_id', auth.workspaceId)
    .select('*')
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return {
    ok: true,
    brand_key: data.brand_key,
    shop_username: data.shop_username,
    collection_count: normalized.length,
    collections: normalized,
    brand: data,
  }
})
