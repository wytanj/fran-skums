export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'events:write')
  const client = getAdminClient()
  const body = await readBody(event)

  const eventType = String(body.event_type || '').trim()
  if (!eventType) {
    throw createError({ statusCode: 400, statusMessage: 'event_type is required' })
  }

  const { data, error } = await client
    .from('domain_events')
    .insert({
      workspace_id: ctx.workspaceId,
      event_type: eventType,
      event_version: body.event_version || 1,
      source_type: body.source_type || 'api',
      source_app_key: body.source_app_key || null,
      source_id: body.source_id || null,
      aggregate_type: body.aggregate_type || null,
      aggregate_id: body.aggregate_id || null,
      correlation_id: body.correlation_id || null,
      causation_id: body.causation_id || null,
      idempotency_key: body.idempotency_key || null,
      payload: body.payload || {},
      metadata: body.metadata || {},
    })
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  setResponseStatus(event, 201)
  return { data }
})
