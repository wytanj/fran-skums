export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'categories:read')
  const client = getAdminClient()

  const { data, error } = await client
    .from('categories')
    .select('*')
    .eq('workspace_id', ctx.workspaceId)
    .order('sort_order')

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [] }
})
