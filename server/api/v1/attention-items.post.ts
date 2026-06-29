function requiredString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'agents:write')
  const client = getAdminClient()
  const body = await readBody(event)

  const attentionType = requiredString(body.attention_type)
  const title = requiredString(body.title)

  if (!attentionType) {
    throw createError({ statusCode: 400, statusMessage: 'attention_type is required' })
  }
  if (!title) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }

  const idempotencyKey = requiredString(body.idempotency_key)
  if (idempotencyKey) {
    const { data: existing, error: existingError } = await client
      .from('product_attention_items')
      .select('*')
      .eq('workspace_id', ctx.workspaceId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    if (existingError) throw createError({ statusCode: 500, statusMessage: existingError.message })
    if (existing) return { data: existing, duplicate: true }
  }

  const { data, error } = await client
    .from('product_attention_items')
    .insert({
      workspace_id: ctx.workspaceId,
      attention_type: attentionType,
      risk_level: body.risk_level || 'medium',
      status: body.status || 'open',
      source_type: body.source_type || 'api',
      source_app_key: body.source_app_key || null,
      source_event_id: body.source_event_id || null,
      proposal_id: body.proposal_id || null,
      product_identity_id: body.product_identity_id || null,
      trade_unit_id: body.trade_unit_id || null,
      listing_id: body.listing_id || null,
      channel_id: body.channel_id || null,
      sku_assignment_id: body.sku_assignment_id || null,
      identifier_id: body.identifier_id || null,
      product_id: body.product_id || null,
      variant_id: body.variant_id || null,
      title,
      summary: body.summary || null,
      recommended_action: body.recommended_action || null,
      evidence: body.evidence || {},
      metadata: body.metadata || {},
      assigned_to: body.assigned_to || null,
      idempotency_key: idempotencyKey || null,
    })
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  setResponseStatus(event, 201)
  return { data }
})
