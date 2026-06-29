export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'agents:read')
  const client = getAdminClient()
  const query = getQuery(event)

  const limit = boundedApiLimit(query.limit, 50, 200)
  const offset = Math.max(Math.floor(Number(query.offset) || 0), 0)

  let q = client
    .from('product_attention_items')
    .select('*', { count: 'exact' })
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (query.status) q = q.eq('status', String(query.status))
  if (query.attention_type) q = q.eq('attention_type', String(query.attention_type))
  if (query.risk_level) q = q.eq('risk_level', String(query.risk_level))
  if (query.source_app_key) q = q.eq('source_app_key', String(query.source_app_key))
  if (query.proposal_id) q = q.eq('proposal_id', String(query.proposal_id))

  const { data, count, error } = await q
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { data: data || [], total: count || 0, limit, offset }
})
