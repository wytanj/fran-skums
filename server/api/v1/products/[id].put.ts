export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:write')
  const client = getAdminClient()
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  const updates: Record<string, any> = { updated_at: new Date().toISOString() }

  const fields = [
    'title', 'sku', 'ean', 'upc', 'gtin', 'isbn', 'asin', 'mpn',
    'description', 'short_description', 'status',
    'cost_price', 'retail_price', 'sale_price', 'currency',
    'weight', 'weight_unit', 'length', 'width', 'height', 'dimension_unit',
    'stock_quantity', 'low_stock_threshold', 'track_inventory',
    'seo_title', 'seo_description', 'seo_keywords', 'canonical_url',
    'tags', 'brand_id', 'category_id', 'schema_id',
    'product_data', 'is_canonical', 'rendition_name', 'export_target',
  ]

  for (const f of fields) {
    if (body[f] !== undefined) updates[f] = body[f]
  }

  const { data, error } = await client
    .from('products')
    .update(updates)
    .eq('id', id!)
    .eq('workspace_id', ctx.workspaceId)
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Product not found' })

  return { data }
})
