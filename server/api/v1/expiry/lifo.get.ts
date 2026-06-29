/**
 * LIFO query — returns in-stock items ordered by expiry (soonest first).
 * Filters: product_id, sku, days_until (max days until expiry), status.
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:read')
  const client = getAdminClient()
  const query = getQuery(event)

  const limit = Math.min(Number(query.limit) || 50, 200)

  let q = client
    .from('expiry_lifo')
    .select('*')
    .eq('workspace_id', ctx.workspaceId)
    .limit(limit)

  if (query.product_id) q = q.eq('product_id', query.product_id as string)
  if (query.sku) q = q.eq('raw_sku', query.sku as string)
  if (query.days_until) q = q.lte('days_until_expiry', Number(query.days_until))

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [] }
})
