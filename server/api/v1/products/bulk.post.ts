/**
 * Bulk upsert products — the workhorse endpoint for n8n batch workflows.
 * Accepts an array of products. Uses SKU as the merge key if provided.
 *
 * Body: { products: [...], merge_on?: 'sku' | 'ean' | 'upc' | 'gtin' }
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:write')
  const client = getAdminClient()
  const body = await readBody(event)

  const items: any[] = body.products
  if (!Array.isArray(items) || items.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'products array is required' })
  }
  if (items.length > 500) {
    throw createError({ statusCode: 400, statusMessage: 'Maximum 500 products per batch' })
  }

  const mergeOn: string = body.merge_on || 'sku'
  const allowedFields = new Set([
    'title', 'sku', 'ean', 'upc', 'gtin', 'isbn', 'asin', 'mpn',
    'description', 'short_description', 'status',
    'cost_price', 'retail_price', 'sale_price', 'currency',
    'weight', 'weight_unit', 'length', 'width', 'height', 'dimension_unit',
    'stock_quantity', 'low_stock_threshold', 'track_inventory',
    'seo_title', 'seo_description', 'seo_keywords', 'canonical_url',
    'tags', 'brand_id', 'category_id', 'schema_id',
    'product_data', 'is_canonical', 'rendition_name', 'export_target',
  ])

  // Caches for brand/category name resolution
  const brandCache: Record<string, string> = {}
  const categoryCache: Record<string, string> = {}

  async function resolveBrand(name: string): Promise<string | null> {
    const key = name.trim().toLowerCase()
    if (!key) return null
    if (brandCache[key]) return brandCache[key]
    const { data: existing } = await client.from('brands').select('id').eq('workspace_id', ctx.workspaceId).ilike('name', name.trim()).limit(1)
    if (existing?.length) { brandCache[key] = existing[0].id; return existing[0].id }
    const { data: created } = await client.from('brands').insert({ workspace_id: ctx.workspaceId, name: name.trim() }).select('id').single()
    if (created) { brandCache[key] = created.id; return created.id }
    return null
  }

  async function resolveCategory(name: string): Promise<string | null> {
    const key = name.trim().toLowerCase()
    if (!key) return null
    if (categoryCache[key]) return categoryCache[key]
    const { data: existing } = await client.from('categories').select('id').eq('workspace_id', ctx.workspaceId).ilike('name', name.trim()).limit(1)
    if (existing?.length) { categoryCache[key] = existing[0].id; return existing[0].id }
    const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const { data: created } = await client.from('categories').insert({ workspace_id: ctx.workspaceId, name: name.trim(), slug }).select('id').single()
    if (created) { categoryCache[key] = created.id; return created.id }
    return null
  }

  const created: any[] = []
  const updated: any[] = []
  const errors: any[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item.title && !item[mergeOn]) {
      errors.push({ index: i, error: `title or ${mergeOn} is required` })
      continue
    }

    try {
      let existing: any = null
      if (item[mergeOn]) {
        const { data } = await client
          .from('products')
          .select('id')
          .eq('workspace_id', ctx.workspaceId)
          .eq(mergeOn, item[mergeOn])
          .limit(1)
          .single()
        existing = data
      }

      const row: Record<string, any> = {}
      for (const [k, v] of Object.entries(item)) {
        if (allowedFields.has(k)) row[k] = v
      }

      if (item.brand_name && !row.brand_id) {
        const bid = await resolveBrand(item.brand_name)
        if (bid) row.brand_id = bid
      }
      if (item.category_name && !row.category_id) {
        const cid = await resolveCategory(item.category_name)
        if (cid) row.category_id = cid
      }

      if (existing) {
        row.updated_at = new Date().toISOString()
        const { data, error } = await client
          .from('products')
          .update(row)
          .eq('id', existing.id)
          .select()
          .single()
        if (error) throw error
        updated.push(data)
      } else {
        row.workspace_id = ctx.workspaceId
        row.product_data = row.product_data || {}
        if (!row.title) row.title = item[mergeOn] || 'Untitled'
        const { data, error } = await client
          .from('products')
          .insert(row)
          .select()
          .single()
        if (error) throw error
        created.push(data)
      }
    } catch (e: any) {
      errors.push({ index: i, error: e.message })
    }
  }

  return {
    created: created.length,
    updated: updated.length,
    errors: errors.length,
    details: { created, updated, errors },
  }
})
