export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'pos:read')
  const client = getAdminClient()
  const body = await readBody(event)

  const identifier = String(body.identifier || body.scanned_value || '').trim()
  if (!identifier) {
    throw createError({ statusCode: 400, statusMessage: 'identifier is required' })
  }

  const { data, error } = await client.rpc('resolve_pos_scan', {
    p_workspace_id: ctx.workspaceId,
    p_identifier: identifier,
    p_channel_id: body.channel_id || null,
    p_location_id: body.location_id || null,
  })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data }
})
