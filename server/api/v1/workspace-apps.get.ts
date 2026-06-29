export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'apps:read')
  const client = getAdminClient()
  const query = getQuery(event)

  let q = client
    .from('workspace_apps')
    .select('*, app_definition:app_definition_id(*)')
    .eq('workspace_id', ctx.workspaceId)
    .order('updated_at', { ascending: false })

  if (query.status) {
    q = q.eq('status', query.status as string)
  }
  if (query.app_key) {
    q = q.eq('app_key', query.app_key as string)
  }

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [] }
})
