export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:read')
  const client = getAdminClient()

  const { data, error } = await client.rpc('expiry_summary', { p_workspace_id: ctx.workspaceId })
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data }
})
