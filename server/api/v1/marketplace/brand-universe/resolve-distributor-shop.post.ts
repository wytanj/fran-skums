/**
 * MH-7 — Link a multi-brand distributor Mall shop to several brand_keys.
 *
 * POST /api/v1/marketplace/brand-universe/resolve-distributor-shop
 * Scope: intel:write
 *
 * Body:
 *   brand_keys: string[]   (new or full set; merged with brands already on this shop)
 *   shop_url | shop_username
 *   shop_id?
 *   replace?: boolean      (default false = merge allowlist)
 *   evidence?
 */
import { requireApiKey } from '../../../../utils/apiAuth'
import { resolveDistributorShop } from '../../../../utils/marketplaceBrandUniverse'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:write')
  const body = await readBody(event)

  try {
    const result = await resolveDistributorShop(auth.workspaceId, {
      brand_keys: Array.isArray(body?.brand_keys) ? body.brand_keys : [],
      shop_url: body?.shop_url,
      shop_username: body?.shop_username,
      shop_id: body?.shop_id ?? null,
      replace: body?.replace === true,
      evidence: body?.evidence && typeof body.evidence === 'object' ? body.evidence : {},
    })
    return { ok: true, ...result }
  } catch (e: any) {
    throw createError({
      statusCode: e?.statusCode || 500,
      statusMessage: e?.message || 'resolve-distributor-shop failed',
      message: e?.message || 'resolve-distributor-shop failed',
    })
  }
})
