export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:read')
  const client = getAdminClient()
  const query = getQuery(event)

  const limit = Math.min(Number(query.limit) || 25, 100)
  const offset = Number(query.offset) || 0

  let q = client
    .from('products')
    .select('*, brand:brand_id(id, name), category:category_id(id, name)', { count: 'exact' })
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (query.search) {
    q = q.or(`title.ilike.%${query.search}%,sku.ilike.%${query.search}%`)
  }
  if (query.status) {
    q = q.eq('status', query.status as string)
  }
  if (query.schema_id) {
    q = q.eq('schema_id', query.schema_id as string)
  }
  if (query.sku) {
    q = q.eq('sku', query.sku as string)
  }
  if (query.ean) {
    q = q.eq('ean', query.ean as string)
  }

  const { data, count, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return {
    data: data || [],
    total: count || 0,
    limit,
    offset,
  }
})
