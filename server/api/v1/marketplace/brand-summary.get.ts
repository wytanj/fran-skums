/**
 * Brand-radar summary for agents / sheet planning.
 *
 * GET /api/v1/marketplace/brand-summary
 *   ?brand_key=biodance
 *   &brand_keys=biodance,anua
 *   &min_sold=1000
 *   &top_n=10
 *   &limit=500
 *
 * Scope: intel:read
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { queryBrandSummary } from '../../../../marketplace/brandListingsQuery.mjs'
import { getServiceClient } from '../../../utils/supabase'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const query = getQuery(event)
  const db = getServiceClient()

  const brand_keys =
    typeof query.brand_keys === 'string'
      ? query.brand_keys
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : undefined

  try {
    return await queryBrandSummary(db, auth.workspaceId, {
      brand_key:
        typeof query.brand_key === 'string' ? query.brand_key.toLowerCase().trim() : undefined,
      brand_keys,
      shop_username:
        typeof query.shop_username === 'string' ? query.shop_username.trim() : undefined,
      shop_collection_name:
        typeof query.shop_collection_name === 'string'
          ? query.shop_collection_name
          : undefined,
      platform_category_leaf:
        typeof query.platform_category_leaf === 'string'
          ? query.platform_category_leaf
          : undefined,
      min_sold: query.min_sold != null && query.min_sold !== '' ? Number(query.min_sold) : undefined,
      q: typeof query.q === 'string' ? query.q : undefined,
      seller_type: typeof query.seller_type === 'string' ? query.seller_type : undefined,
      limit: Number(query.limit) || 500,
      top_n: Number(query.top_n) || 10,
    })
  } catch (e: any) {
    throw createError({
      statusCode: 500,
      statusMessage: e?.message?.slice(0, 400) || 'brand-summary failed',
    })
  }
})
