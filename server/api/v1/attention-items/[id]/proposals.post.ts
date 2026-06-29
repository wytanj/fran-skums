export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'agents:write')
  const client = getAdminClient()
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  const { data: item, error: itemError } = await client
    .from('product_attention_items')
    .select('*')
    .eq('id', id!)
    .eq('workspace_id', ctx.workspaceId)
    .single()

  if (itemError || !item) {
    throw createError({ statusCode: itemError ? 500 : 404, statusMessage: itemError?.message || 'Attention item not found' })
  }

  const proposalInput = buildAgentProposalFromAttentionItem(item, body)

  const { data: proposal, error: proposalError } = await client
    .from('agent_proposals')
    .insert(proposalInput)
    .select()
    .single()

  if (proposalError) throw createError({ statusCode: 500, statusMessage: proposalError.message })

  await client
    .from('product_attention_items')
    .update({ proposal_id: proposal.id, status: 'proposed' })
    .eq('id', item.id)
    .eq('workspace_id', ctx.workspaceId)

  setResponseStatus(event, 201)
  return { data: proposal }
})
