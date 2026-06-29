export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'agents:write')
  const client = getAdminClient()
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  const status = body.status || body.decision
  if (!['approved', 'rejected', 'cancelled'].includes(status)) {
    throw createError({ statusCode: 400, statusMessage: 'status must be approved, rejected, or cancelled' })
  }

  const patch: Record<string, any> = {
    status,
    metadata: body.metadata || {},
  }

  if (status === 'approved') {
    patch.approved_at = new Date().toISOString()
  }

  const { data, error } = await client
    .from('agent_proposals')
    .update(patch)
    .eq('id', id!)
    .eq('workspace_id', ctx.workspaceId)
    .select()
    .single()

  if (error || !data) {
    throw createError({ statusCode: error ? 500 : 404, statusMessage: error?.message || 'Agent proposal not found' })
  }

  await client.from('approval_requests').insert({
    workspace_id: ctx.workspaceId,
    proposal_id: data.id,
    approval_type: 'agent_proposal',
    status,
    decision_notes: body.decision_notes || null,
    decided_at: new Date().toISOString(),
    metadata: body.approval_metadata || {},
  })

  return { data }
})
