export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'agents:write')
  const client = getAdminClient()
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  const status = body.status || 'resolved'
  if (!['resolved', 'dismissed', 'cancelled'].includes(status)) {
    throw createError({ statusCode: 400, statusMessage: 'status must be resolved, dismissed, or cancelled' })
  }

  const metadata = {
    ...(body.metadata || {}),
    resolution_notes: body.resolution_notes || body.decision_notes || null,
  }

  const { data, error } = await client
    .from('product_attention_items')
    .update({
      status,
      resolved_by: body.resolved_by || null,
      resolved_at: new Date().toISOString(),
      metadata,
    })
    .eq('id', id!)
    .eq('workspace_id', ctx.workspaceId)
    .select()
    .single()

  if (error || !data) {
    throw createError({ statusCode: error ? 500 : 404, statusMessage: error?.message || 'Attention item not found' })
  }

  await client.from('domain_events').insert({
    workspace_id: ctx.workspaceId,
    event_type: `attention_item.${status}`,
    source_type: 'api',
    source_app_key: body.source_app_key || 'skums_core',
    aggregate_type: 'product_attention_item',
    aggregate_id: data.id,
    idempotency_key: body.idempotency_key || `attention-item:${data.id}:${status}`,
    payload: {
      attention_item: data,
      resolution_notes: metadata.resolution_notes,
    },
    metadata: body.event_metadata || {},
  })

  return { data }
})
