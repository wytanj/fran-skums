import { resolveNextWaveForStore } from '../../utils/storeDeliveryCalendar'

/**
 * Next Mon/Thu (or settings) wave + store calendar for POS/HQ.
 * Scopes: store_ops:read or pos:read
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
    await requireScope(event, 'pos:read', { workspaceId, client, accessLevel: 'member' })
  }

  const result = await resolveNextWaveForStore(client, {
    workspaceId,
    posLocationCode: query.pos_location_code ? String(query.pos_location_code) : null,
    inventoryLocationId: query.inventory_location_id ? String(query.inventory_location_id) : null,
  })
  return result
})
