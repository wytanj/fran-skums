/**
 * List marketplace listings with filters.
 * GET /api/v1/marketplace/listings
 *   ?seller_type=&q=&country=&marketplace=&limit=
 */
import { requireApiKey } from '../../../utils/apiAuth'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const query = getQuery(event)
  const db = getServiceClient()
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200)

  let q = db
    .from('marketplace_listings')
    .select('*')
    .eq('workspace_id', auth.workspaceId)
    .order('last_seen_at', { ascending: false })
    .limit(limit)

  if (typeof query.marketplace === 'string') q = q.eq('marketplace', query.marketplace)
  if (typeof query.country === 'string') q = q.eq('country', query.country)
  if (typeof query.seller_type === 'string') q = q.eq('seller_type', query.seller_type)
  if (typeof query.status === 'string') q = q.eq('status', query.status)
  if (typeof query.shop_id === 'string') q = q.eq('shop_id', query.shop_id)
  if (typeof query.q === 'string' && query.q.trim()) {
    q = q.ilike('title', `%${query.q.trim()}%`)
  }

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { listings: data ?? [] }
})
