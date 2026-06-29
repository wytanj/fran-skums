/**
 * Flexible product search/lookup for automation.
 * Supports finding by SKU, EAN, UPC, GTIN, or title.
 * Returns matches so n8n can do find-or-create patterns.
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:read')
  const client = getAdminClient()
  const query = getQuery(event)

  const conditions: string[] = []

  if (query.sku) conditions.push(`sku.eq.${query.sku}`)
  if (query.ean) conditions.push(`ean.eq.${query.ean}`)
  if (query.upc) conditions.push(`upc.eq.${query.upc}`)
  if (query.gtin) conditions.push(`gtin.eq.${query.gtin}`)
  if (query.title) conditions.push(`title.ilike.%${query.title}%`)

  if (conditions.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Provide at least one of: sku, ean, upc, gtin, title' })
  }

  const { data, error } = await client
    .from('products')
    .select('*')
    .eq('workspace_id', ctx.workspaceId)
    .or(conditions.join(','))
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [], total: data?.length || 0 }
})
