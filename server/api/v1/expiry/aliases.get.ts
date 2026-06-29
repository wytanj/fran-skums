export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:read')
  const client = getAdminClient()
  const query = getQuery(event)

  let q = client
    .from('sku_aliases')
    .select('*, product:product_id(id, title, sku)')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })

  if (query.product_id) q = q.eq('product_id', query.product_id as string)
  if (query.alias_value) q = q.eq('alias_value', query.alias_value as string)

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [] }
})
