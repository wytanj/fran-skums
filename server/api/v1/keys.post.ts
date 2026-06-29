export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'api:write')
  const client = getAdminClient()
  const body = await readBody(event)

  if (!body.name) {
    throw createError({ statusCode: 400, statusMessage: 'name is required' })
  }

  const { raw, hash, prefix } = generateApiKey()

  const { data, error } = await client
    .from('api_keys')
    .insert({
      workspace_id: ctx.workspaceId,
      name: body.name,
      description: body.description || null,
      key_prefix: prefix,
      key_hash: hash,
      scopes: body.scopes || [],
      rate_limit_rpm: body.rate_limit_rpm || 60,
      expires_at: body.expires_at || null,
      created_by: null,
    })
    .select('id, name, key_prefix, scopes, rate_limit_rpm, is_active, created_at, expires_at')
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  setResponseStatus(event, 201)
  return {
    data: { ...data, key: raw },
    warning: 'Store this key securely. It will not be shown again.',
  }
})
