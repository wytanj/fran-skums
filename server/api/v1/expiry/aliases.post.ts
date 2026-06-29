/**
 * Register or bulk-register SKU aliases for product resolution.
 * Body: { aliases: [{ product_id, alias_value, alias_type?, label? }] }
 * or single: { product_id, alias_value, alias_type?, label? }
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:write')
  const client = getAdminClient()
  const body = await readBody(event)

  const aliases = Array.isArray(body.aliases) ? body.aliases : [body]

  const rows = aliases.map((a: any) => ({
    workspace_id: ctx.workspaceId,
    product_id: a.product_id,
    alias_type: a.alias_type || 'sku',
    alias_value: a.alias_value,
    label: a.label || null,
    source: 'api',
  }))

  const { data, error } = await client
    .from('sku_aliases')
    .upsert(rows, { onConflict: 'workspace_id,alias_type,alias_value' })
    .select()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  setResponseStatus(event, 201)
  return { data, created: data?.length || 0 }
})
