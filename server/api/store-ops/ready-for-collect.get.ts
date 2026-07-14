import { listReadyForCollect } from '../../utils/storeReceive'

/**
 * HQ queue: self-collect orders ready (or pending pickup) at Loft.
 * Scope: store_ops:read
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const workspaceId = String(query.workspace_id || '').trim()
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  const client = getServiceClient()
  await requireScope(event, 'store_ops:read', {
    workspaceId,
    client,
    accessLevel: 'member',
  })

  const data = await listReadyForCollect(client, {
    workspaceId,
    limit: Number(query.limit) || 50,
  })

  return {
    data,
    note: 'Self-collect orders for LISE pickup at Loft. Store receive still required after collection.',
  }
})
