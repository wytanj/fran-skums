export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'apps:read')
  const client = getAdminClient()
  const query = getQuery(event)

  let q = client
    .from('workspace_capability_sources')
    .select('*, app_definition:app_definition_id(*), workspace_app:workspace_app_id(*)')
    .eq('workspace_id', ctx.workspaceId)
    .order('capability_key', { ascending: true })

  if (query.capability_key) {
    q = q.eq('capability_key', query.capability_key as string)
  }
  if (query.mode) {
    q = q.eq('mode', query.mode as string)
  }

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [] }
})
