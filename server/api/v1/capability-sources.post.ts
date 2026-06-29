export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'apps:write')
  const client = getAdminClient()
  const body = await readBody(event)

  const capabilityKey = String(body.capability_key || '').trim()
  if (!capabilityKey) {
    throw createError({ statusCode: 400, statusMessage: 'capability_key is required' })
  }

  const { data, error } = await client
    .from('workspace_capability_sources')
    .upsert({
      workspace_id: ctx.workspaceId,
      capability_key: capabilityKey,
      owner_type: body.owner_type || 'workspace_app',
      app_key: body.app_key || null,
      app_definition_id: body.app_definition_id || null,
      workspace_app_id: body.workspace_app_id || null,
      integration_connection_id: body.integration_connection_id || null,
      mode: body.mode || 'source_of_truth',
      conflict_policy: body.conflict_policy || 'manual_review',
      config: body.config || {},
      metadata: body.metadata || {},
    }, { onConflict: 'workspace_id,capability_key' })
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  setResponseStatus(event, 201)
  return { data }
})
