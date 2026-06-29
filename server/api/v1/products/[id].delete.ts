export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:delete')
  const client = getAdminClient()
  const id = getRouterParam(event, 'id')

  const { error } = await client
    .from('products')
    .delete()
    .eq('id', id!)
    .eq('workspace_id', ctx.workspaceId)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { deleted: true }
})
