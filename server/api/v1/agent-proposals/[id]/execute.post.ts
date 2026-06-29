export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'agents:write')
  const client = getAdminClient()
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)
  const startedAt = Date.now()

  const { data: proposal, error } = await client
    .from('agent_proposals')
    .select('*')
    .eq('id', id!)
    .eq('workspace_id', ctx.workspaceId)
    .single()

  if (error || !proposal) {
    throw createError({ statusCode: error ? 500 : 404, statusMessage: error?.message || 'Agent proposal not found' })
  }

  if (proposal.status !== 'approved') {
    throw createError({ statusCode: 409, statusMessage: 'proposal must be approved before execution' })
  }

  await client
    .from('agent_proposals')
    .update({ status: 'executing' })
    .eq('id', proposal.id)
    .eq('workspace_id', ctx.workspaceId)

  const executionOutput = {
    mode: 'execute',
    proposal_id: proposal.id,
    executed_steps: proposal.proposed_steps || [],
    affected_objects: proposal.affected_objects || [],
    data_diff: proposal.data_diff || {},
  }

  const eventIdempotencyKey = body.idempotency_key || `agent-proposal:${proposal.id}:executed`
  const { data: domainEvent, error: eventError } = await client
    .from('domain_events')
    .insert({
      workspace_id: ctx.workspaceId,
      event_type: 'agent_proposal.executed',
      source_type: 'agent',
      source_app_key: proposal.app_key || 'skums_core',
      source_id: proposal.id,
      aggregate_type: 'agent_proposal',
      aggregate_id: proposal.id,
      correlation_id: body.correlation_id || null,
      causation_id: proposal.source_event_id || null,
      idempotency_key: eventIdempotencyKey,
      payload: {
        proposal,
        execution: executionOutput,
      },
      metadata: body.event_metadata || {},
    })
    .select()
    .maybeSingle()

  if (eventError && eventError.code !== '23505') {
    await client
      .from('agent_proposals')
      .update({ status: 'failed' })
      .eq('id', proposal.id)
      .eq('workspace_id', ctx.workspaceId)

    throw createError({ statusCode: 500, statusMessage: eventError.message })
  }

  await client.from('agent_execution_logs').insert({
    workspace_id: ctx.workspaceId,
    proposal_id: proposal.id,
    source_event_id: domainEvent?.id || proposal.source_event_id || null,
    app_key: proposal.app_key || null,
    agent_type: proposal.agent_type,
    status: 'succeeded',
    input_data: body || {},
    output_data: executionOutput,
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    metadata: {
      mode: 'execute',
      event_idempotency_key: eventIdempotencyKey,
    },
  })

  const { data: updatedProposal, error: updateError } = await client
    .from('agent_proposals')
    .update({ status: 'executed', executed_at: new Date().toISOString() })
    .eq('id', proposal.id)
    .eq('workspace_id', ctx.workspaceId)
    .select()
    .single()

  if (updateError) throw createError({ statusCode: 500, statusMessage: updateError.message })

  const sourceAttentionItemId = proposal.metadata?.source_attention_item_id
  if (sourceAttentionItemId) {
    await client
      .from('product_attention_items')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', sourceAttentionItemId)
      .eq('workspace_id', ctx.workspaceId)
  }

  return {
    data: {
      proposal: updatedProposal,
      event: domainEvent || null,
      execution: executionOutput,
    },
  }
})
