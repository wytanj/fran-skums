export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'agents:write')
  const client = getAdminClient()
  const body = await readBody(event)

  if (!body.agent_type || !body.intent_summary) {
    throw createError({ statusCode: 400, statusMessage: 'agent_type and intent_summary are required' })
  }

  const { data, error } = await client
    .from('agent_proposals')
    .insert({
      workspace_id: ctx.workspaceId,
      source_event_id: body.source_event_id || null,
      app_key: body.app_key || null,
      agent_type: body.agent_type,
      intent_summary: body.intent_summary,
      affected_objects: body.affected_objects || [],
      proposed_steps: body.proposed_steps || [],
      data_diff: body.data_diff || {},
      risk_level: body.risk_level || 'low',
      policy_result: body.policy_result || {},
      approval_required: body.approval_required ?? true,
      status: body.status || 'draft',
      created_by_agent: body.created_by_agent || null,
      rollback_metadata: body.rollback_metadata || {},
      metadata: body.metadata || {},
    })
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  setResponseStatus(event, 201)
  return { data }
})
