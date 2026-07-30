/**
 * RP-4 — grouped aggregates over the Shopee Mall harvest.
 *
 * GET /api/v1/marketplace/brand-rollup
 *   ?group_by=brand|shelf|platform_leaf|shop
 *   &metrics=sku_count,sold_sum
 *   &brand_key=biodance & min_sold=1000 & limit=50
 *
 * Aggregation runs in Postgres (mig 077), so payload and latency stay roughly
 * constant as the harvest grows. Prefer this over brand-listings for any
 * "which X sells most" question.
 *
 * Scope: intel:read
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { queryBrandRollup } from '../../../../marketplace/brandRollupQuery.mjs'
import { getServiceClient } from '../../../utils/supabase'

function csvList(v: unknown): string[] | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const query = getQuery(event)
  const db = getServiceClient()

  try {
    return {
      workspace_id: auth.workspaceId,
      ...(await queryBrandRollup(db, auth.workspaceId, {
        group_by: (typeof query.group_by === 'string' ? query.group_by : 'brand') as any,
        metrics: csvList(query.metrics),
        brand_key: typeof query.brand_key === 'string' ? query.brand_key : undefined,
        brand_keys: csvList(query.brand_keys),
        shop_username: typeof query.shop_username === 'string' ? query.shop_username : undefined,
        shop_collection_name:
          typeof query.shop_collection_name === 'string' ? query.shop_collection_name : undefined,
        platform_category_leaf:
          typeof query.platform_category_leaf === 'string'
            ? query.platform_category_leaf
            : undefined,
        min_sold:
          query.min_sold != null && query.min_sold !== '' ? Number(query.min_sold) : undefined,
        seller_type: typeof query.seller_type === 'string' ? query.seller_type : undefined,
        since: typeof query.since === 'string' ? query.since : undefined,
        until: typeof query.until === 'string' ? query.until : undefined,
        limit: Number(query.limit) || 50,
      })),
    }
  } catch (e: any) {
    throw createError({
      statusCode: 400,
      statusMessage: e?.message?.slice(0, 400) || 'brand-rollup failed',
    })
  }
})
