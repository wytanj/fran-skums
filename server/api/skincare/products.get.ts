import { getServiceClient } from '../../utils/supabase'

const WORKSPACE_ID = '4fdea5f5-413a-40b8-9b39-9fcad66ebf17'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const {
    source,
    subcategory,
    concern,
    skin_type,
    min_ips,
    max_ips,
    tier,
    trend,
    search,
    sort_by = 'ips_score',
    sort_dir = 'desc',
    page = '1',
    per_page = '50',
  } = query as Record<string, string>

  const db = getServiceClient()
  const pageNum = Math.max(1, parseInt(page))
  const perPage = Math.min(100, Math.max(1, parseInt(per_page)))
  const offset = (pageNum - 1) * perPage

  let q = db
    .from('external_products')
    .select('*', { count: 'exact' })
    .eq('workspace_id', WORKSPACE_ID)

  // Filters
  if (source) q = q.eq('source', source)
  if (subcategory) q = q.eq('subcategory', subcategory)
  if (concern) q = q.contains('concern_tags', [concern])
  if (tier) q = q.eq('top_tier_ingredient', tier)
  if (trend) q = q.eq('ingredient_trend_signal', trend)
  if (min_ips) q = q.gte('ips_score', parseFloat(min_ips))
  if (max_ips) q = q.lte('ips_score', parseFloat(max_ips))

  if (search) {
    q = q.or(`product_name.ilike.%${search}%,brand_name.ilike.%${search}%`)
  }

  // Skin type filter: products with high fit for the given skin type
  // This requires jsonb filtering which Supabase handles via ->
  if (skin_type && ['dry', 'oily', 'combination', 'sensitive', 'acne'].includes(skin_type)) {
    // Filter where skin_type_fit->>skin_type >= 0.6
    q = q.gte(`skin_type_fit->>${skin_type}`, '0.6')
  }

  // Sorting
  const validSortCols = ['ips_score', 'rating', 'review_count', 'price', 'crawled_at', 'product_name']
  const sortCol = validSortCols.includes(sort_by) ? sort_by : 'ips_score'
  q = q.order(sortCol, { ascending: sort_dir === 'asc', nullsFirst: false })

  // Pagination
  q = q.range(offset, offset + perPage - 1)

  const { data, count, error } = await q

  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }

  return {
    products: data ?? [],
    total: count ?? 0,
    page: pageNum,
    per_page: perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  }
})
