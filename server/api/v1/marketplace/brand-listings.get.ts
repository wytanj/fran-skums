/**
 * Brand-radar sheet slice: latest listings for official Mall brands.
 *
 * GET /api/v1/marketplace/brand-listings
 *   ?brand_key=biodance
 *   &shop_username=biodance.sg
 *   &shop_collection_name=Bundle
 *   &platform_category_leaf=Mask
 *   &min_sold=1000
 *   &q=collagen
 *   &limit=100
 *   &format=json|csv
 *   &raw=1   (csv body only when format=csv)
 *
 * Scope: intel:read
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { queryBrandListings } from '../../../../marketplace/brandListingsQuery.mjs'
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
    const result = await queryBrandListings(db, auth.workspaceId, {
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
      since: typeof query.since === 'string' ? query.since : undefined,
      until: typeof query.until === 'string' ? query.until : undefined,
      limit: Number(query.limit) || 100,
      format: query.format === 'csv' ? 'csv' : 'json',
    })

    if (result.format === 'csv') {
      setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
      setHeader(
        event,
        'Content-Disposition',
        `attachment; filename="brand-listings-${query.brand_key || 'export'}-${Date.now()}.csv"`,
      )
      if (query.raw === '1' || query.raw === 'true') {
        return result.csv
      }
      return {
        format: 'csv',
        workspace_id: auth.workspaceId,
        row_count: result.row_count,
        summary: result.summary,
        columns: result.columns,
        csv: result.csv,
      }
    }

    return {
      ...result,
      workspace_id: auth.workspaceId,
    }
  } catch (e: any) {
    throw createError({
      statusCode: 500,
      statusMessage: e?.message?.slice(0, 400) || 'brand-listings failed',
    })
  }
})
