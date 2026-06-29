export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'brands:read')
  const client = getAdminClient()

  const { data, error } = await client
    .from('brands')
    .select('*')
    .eq('workspace_id', ctx.workspaceId)
    .order('name')

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [] }
})
