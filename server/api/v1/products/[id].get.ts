export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:read')
  const client = getAdminClient()
  const id = getRouterParam(event, 'id')

  const { data, error } = await client
    .from('products')
    .select('*, brand:brand_id(*), category:category_id(*), images:product_images(*), variants:product_variants(*)')
    .eq('id', id!)
    .eq('workspace_id', ctx.workspaceId)
    .single()

  if (error || !data) {
    throw createError({ statusCode: 404, statusMessage: 'Product not found' })
  }

  return { data }
})
