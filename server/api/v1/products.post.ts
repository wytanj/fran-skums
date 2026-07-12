import { recordApiAudit } from '../../utils/audit'

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:write')
  const client = getAdminClient()
  const body = await readBody(event)

  if (!body.title) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }

  const product: Record<string, any> = {
    workspace_id: ctx.workspaceId,
    title: body.title,
    status: body.status || 'draft',
    product_data: body.product_data || {},
  }

  // Resolve brand by name if brand_name is provided instead of brand_id
  if (body.brand_name && !body.brand_id) {
    const name = String(body.brand_name).trim()
    if (name) {
      const { data: existing } = await client
        .from('brands')
        .select('id')
        .eq('workspace_id', ctx.workspaceId)
        .ilike('name', name)
        .limit(1)

      if (existing && existing.length > 0) {
        product.brand_id = existing[0].id
      } else {
        const { data: created } = await client
          .from('brands')
          .insert({ workspace_id: ctx.workspaceId, name })
          .select('id')
          .single()
        if (created) product.brand_id = created.id
      }
    }
  }

  // Resolve category by name if category_name is provided instead of category_id
  if (body.category_name && !body.category_id) {
    const name = String(body.category_name).trim()
    if (name) {
      const { data: existing } = await client
        .from('categories')
        .select('id')
        .eq('workspace_id', ctx.workspaceId)
        .ilike('name', name)
        .limit(1)

      if (existing && existing.length > 0) {
        product.category_id = existing[0].id
      } else {
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
        const { data: created } = await client
          .from('categories')
          .insert({ workspace_id: ctx.workspaceId, name, slug })
          .select('id')
          .single()
        if (created) product.category_id = created.id
      }
    }
  }

  const fields = [
    'sku', 'ean', 'upc', 'gtin', 'isbn', 'asin', 'mpn',
    'description', 'short_description',
    'cost_price', 'retail_price', 'sale_price', 'currency',
    'weight', 'weight_unit', 'length', 'width', 'height', 'dimension_unit',
    'stock_quantity', 'low_stock_threshold', 'track_inventory',
    'seo_title', 'seo_description', 'seo_keywords', 'canonical_url',
    'tags', 'brand_id', 'category_id', 'schema_id',
    'is_canonical', 'rendition_name', 'export_target',
  ]

  for (const f of fields) {
    if (body[f] !== undefined) product[f] = body[f]
  }

  const { data, error } = await client
    .from('products')
    .insert(product)
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  await recordApiAudit(client, {
    workspace_id: ctx.workspaceId,
    entity_type: 'products',
    entity_id: data.id,
    event_type: 'product.created',
    operation: 'INSERT',
    api_key_id: ctx.keyId || null,
    after_data: data,
    metadata: { title: data.title, status: data.status },
  })

  setResponseStatus(event, 201)
  return {
    data,
    object_type: 'products',
    id: data.id,
    status: data.status,
    is_draft: data.status === 'draft',
    channel: 'api',
  }
})
