export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'schemas:read')
  const client = getAdminClient()

  const { data, error } = await client
    .from('product_schemas')
    .select('*')
    .or(`workspace_id.eq.${ctx.workspaceId},workspace_id.is.null`)
    .order('created_at')

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [] }
})
