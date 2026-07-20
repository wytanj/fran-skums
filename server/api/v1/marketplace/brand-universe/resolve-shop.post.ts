/**
 * Confirm / set Mall shop_username on a brand universe row.
 * Used by Chrome extension and ops scripts.
 *
 * POST /api/v1/marketplace/brand-universe/resolve-shop
 * Scope: intel:write
 *
 * Body:
 *   brand_key | id
 *   shop_url | shop_username
 *   shop_id?
 *   status?: confirmed | candidate  (default confirmed)
 *   source?: manual | serp | import
 *   evidence?: object
 */
import { requireApiKey } from '../../../../utils/apiAuth'
import { resolveBrandShop } from '../../../../utils/marketplaceBrandUniverse'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:write')
  const body = await readBody(event)

  try {
    const brand = await resolveBrandShop(auth.workspaceId, {
      brand_key: body?.brand_key,
      id: body?.id,
      shop_url: body?.shop_url,
      shop_username: body?.shop_username,
      shop_id: body?.shop_id ?? null,
      status: body?.status === 'candidate' ? 'candidate' : 'confirmed',
      source: body?.source || 'manual',
      evidence: body?.evidence && typeof body.evidence === 'object' ? body.evidence : {},
    })
    return { ok: true, brand }
  } catch (e: any) {
    throw createError({
      statusCode: e?.statusCode || 500,
      statusMessage: e?.message || 'resolve-shop failed',
    })
  }
})
