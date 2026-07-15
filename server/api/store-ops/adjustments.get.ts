import { listInventoryAdjustments } from '../../utils/inventoryAdjustments'

/**
 * List inventory adjustments (floor damage/found/stocktake).
 * Scope: store_ops:read or inventory:read
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const workspaceId = String(query.workspace_id || '').trim()
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  const client = getServiceClient()
  try {
    await requireScope(event, 'store_ops:read', { workspaceId, client, accessLevel: 'member' })
  } catch {
    await requireScope(event, 'inventory:read', { workspaceId, client, accessLevel: 'member' })
  }

  const status = query.status ? String(query.status) : 'pending'
  const statuses = status === 'all' ? null : status.split(',').map(s => s.trim()).filter(Boolean)
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200)

  const data = await listInventoryAdjustments(client, {
    workspaceId,
    status: statuses,
    limit,
  })

  return { data, count: data.length }
})
