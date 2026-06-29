export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'api:read')
  const client = getAdminClient()

  const { data, error } = await client
    .from('api_keys')
    .select('id, name, description, key_prefix, scopes, rate_limit_rpm, is_active, last_used_at, total_requests, created_at, expires_at')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [] }
})
