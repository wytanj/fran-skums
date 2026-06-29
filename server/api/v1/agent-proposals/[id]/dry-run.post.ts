export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'agents:write')
  const client = getAdminClient()
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  const { data: proposal, error } = await client
    .from('agent_proposals')
    .select('*')
    .eq('id', id!)
    .eq('workspace_id', ctx.workspaceId)
    .single()

  if (error || !proposal) {
    throw createError({ statusCode: error ? 500 : 404, statusMessage: error?.message || 'Agent proposal not found' })
  }

  const output = {
    mode: 'dry_run',
    proposal_id: proposal.id,
    status: proposal.status,
    approval_required: proposal.approval_required,
    would_execute: proposal.status === 'approved',
    proposed_steps: proposal.proposed_steps || [],
    affected_objects: proposal.affected_objects || [],
    data_diff: proposal.data_diff || {},
  }

  await client.from('agent_execution_logs').insert({
    workspace_id: ctx.workspaceId,
    proposal_id: proposal.id,
    source_event_id: proposal.source_event_id || null,
    app_key: proposal.app_key || null,
    agent_type: proposal.agent_type,
    status: 'succeeded',
    input_data: body || {},
    output_data: output,
    finished_at: new Date().toISOString(),
    metadata: {
      mode: 'dry_run',
    },
  })

  return { data: output }
})
