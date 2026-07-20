/**
 * List marketplace brand universe rows.
 * GET /api/v1/marketplace/brand-universe
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { listBrandUniverse } from '../../../utils/marketplaceBrandUniverse'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const query = getQuery(event)

  try {
    const brands = await listBrandUniverse(auth.workspaceId, query as Record<string, unknown>)
    const need_shop = brands.filter(
      (b: any) => !b.shop_username || b.shop_resolve_status !== 'confirmed',
    ).length
    return {
      brands,
      count: brands.length,
      need_shop,
      workspace_id: auth.workspaceId,
    }
  } catch (e: any) {
    throw createError({ statusCode: 500, statusMessage: e?.message || 'list failed' })
  }
})

