export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:read')
  const client = getAdminClient()
  const id = getRouterParam(event, 'id')

  const { data, error } = await client
    .from('v_product_identity_graph')
    .select('product_id, workspace_id, sku_assignments')
    .eq('product_id', id!)
    .eq('workspace_id', ctx.workspaceId)
    .single()

  if (error || !data) {
    throw createError({ statusCode: 404, statusMessage: 'Product identity graph not found' })
  }

  return { data: data.sku_assignments || [] }
})
