export default defineEventHandler(async (event) => {
  const client = getAdminClient()
  const path = getRouterParam(event, 'path')
  const body = await readBody(event)
  const headers = getHeaders(event)

  const { data: webhook, error: whError } = await client
    .from('integration_webhooks')
    .select('*, connection:integration_connections(*, node_definition:integration_node_definitions(*))')
    .eq('path', path!)
    .eq('is_active', true)
    .single()

  if (whError || !webhook) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found or inactive' })
  }

  if (webhook.secret) {
    const provided = headers['x-webhook-secret'] || headers['x-hook-secret']
    if (provided !== webhook.secret) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid webhook secret' })
    }
  }

  // Log the execution
  const { data: execution } = await client
    .from('integration_executions')
    .insert({
      connection_id: webhook.connection_id,
      workspace_id: webhook.workspace_id,
      execution_type: 'webhook',
      trigger_key: webhook.trigger_key,
      input_data: {
        headers: { 'content-type': headers['content-type'], 'user-agent': headers['user-agent'] },
        body,
      },
      status: 'success',
      items_processed: Array.isArray(body) ? body.length : 1,
      finished_at: new Date().toISOString(),
    })
    .select()
    .single()

  // Update webhook stats
  await client
    .from('integration_webhooks')
    .update({
      last_received_at: new Date().toISOString(),
      total_received: (webhook.total_received || 0) + 1,
    })
    .eq('id', webhook.id)

  return {
    received: true,
    execution_id: execution?.id,
    trigger: webhook.trigger_key,
    items: Array.isArray(body) ? body.length : 1,
  }
})
