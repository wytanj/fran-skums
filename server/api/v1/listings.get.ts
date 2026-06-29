export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:read')
  const client = getAdminClient()
  const query = getQuery(event)

  const limit = Math.min(Number(query.limit) || 25, 100)
  const offset = Number(query.offset) || 0

  let q = client
    .from('listings')
    .select(`
      *,
      channel:channel_id(id, channel_key, name, channel_type, vendor, market, adapter_id),
      product_identity:product_identity_id(id, name, identity_kind, status),
      trade_unit:trade_unit_id(id, unit_kind, label, quantity, base_unit, is_default)
    `, { count: 'exact' })
    .eq('workspace_id', ctx.workspaceId)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (query.product_id) {
    q = q.eq('product_id', query.product_id as string)
  }
  if (query.product_identity_id) {
    q = q.eq('product_identity_id', query.product_identity_id as string)
  }
  if (query.trade_unit_id) {
    q = q.eq('trade_unit_id', query.trade_unit_id as string)
  }
  if (query.channel_id) {
    q = q.eq('channel_id', query.channel_id as string)
  }
  if (query.status) {
    q = q.eq('status', query.status as string)
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
