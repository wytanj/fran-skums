export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'apps:write')
  const client = getAdminClient()
  const body = await readBody(event)

  const appKey = String(body.app_key || '').trim()
  if (!appKey) {
    throw createError({ statusCode: 400, statusMessage: 'app_key is required' })
  }

  const { data: definition, error: definitionError } = await client
    .from('app_definitions')
    .select('id, app_key')
    .or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`)
    .eq('app_key', appKey)
    .limit(1)
    .maybeSingle()

  if (definitionError) {
    throw createError({ statusCode: 500, statusMessage: definitionError.message })
  }

  const { data, error } = await client
    .from('workspace_apps')
    .upsert({
      workspace_id: ctx.workspaceId,
      app_definition_id: definition?.id || null,
      app_key: appKey,
      status: body.status || 'enabled',
      config: body.config || {},
      capabilities: body.capabilities || {},
      metadata: body.metadata || {},
      disabled_at: body.status === 'disabled' ? new Date().toISOString() : null,
    }, { onConflict: 'workspace_id,app_key' })
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  setResponseStatus(event, 201)
  return { data }
})
