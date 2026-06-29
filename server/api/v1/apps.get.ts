export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'apps:read')
  const client = getAdminClient()
  const query = getQuery(event)

  let q = client
    .from('app_definitions')
    .select('*')
    .or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`)
    .order('app_type', { ascending: true })
    .order('app_key', { ascending: true })

  if (query.app_type) {
    q = q.eq('app_type', query.app_type as string)
  }
  if (query.status) {
    q = q.eq('status', query.status as string)
  }

  const { data, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [] }
})
