/**
 * List recent marketplace listing snapshots (BI read path).
 *
 * GET /api/v1/marketplace/snapshots
 *   ?search_query=
 *   &seller_type=
 *   &listing_id=
 *   &min_price= &max_price=
 *   &since= &until=
 *   &overseas=true
 *   &limit=
 */
import { requireApiKey } from '../../../utils/apiAuth'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const query = getQuery(event)
  const db = getServiceClient()
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200)

  let q = db
    .from('marketplace_listing_snapshots')
    .select(
      `
      id,
      listing_id,
      crawl_job_id,
      crawled_at,
      price,
      original_price,
      currency,
      rating,
      review_count,
      sold_label,
      sold_count_lower_bound,
      rank_position,
      search_query,
      seller_type,
      signals,
      marketplace_listings (
        shop_id,
        item_id,
        title,
        shop_name,
        listing_url,
        seller_type,
        marketplace,
        country
      )
    `,
    )
    .eq('workspace_id', auth.workspaceId)
    .order('crawled_at', { ascending: false })
    .limit(limit)

  if (typeof query.search_query === 'string' && query.search_query) {
    q = q.eq('search_query', query.search_query)
  }
  if (typeof query.listing_id === 'string' && query.listing_id) {
    q = q.eq('listing_id', query.listing_id)
  }
  if (typeof query.seller_type === 'string' && query.seller_type) {
    q = q.eq('seller_type', query.seller_type)
  }
  if (typeof query.since === 'string' && query.since) {
    q = q.gte('crawled_at', query.since)
  }
  if (typeof query.until === 'string' && query.until) {
    q = q.lte('crawled_at', query.until)
  }
  if (query.min_price != null && query.min_price !== '') {
    q = q.gte('price', Number(query.min_price))
  }
  if (query.max_price != null && query.max_price !== '') {
    q = q.lte('price', Number(query.max_price))
  }
  if (typeof query.crawl_job_id === 'string' && query.crawl_job_id) {
    q = q.eq('crawl_job_id', query.crawl_job_id)
  }

  const { data, error } = await q
  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  let snapshots = data ?? []

  // JSON signal filters (PostgREST path varies; filter in app for reliability)
  if (query.overseas === 'true' || query.overseas === '1') {
    snapshots = snapshots.filter((s: any) => s.signals?.ships_from_overseas === true)
  }
  if (query.preorder === 'true' || query.preorder === '1') {
    snapshots = snapshots.filter((s: any) => s.signals?.preorder === true)
  }

  return { snapshots, count: snapshots.length }
})
