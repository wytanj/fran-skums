import { listExpectedDeliveries } from '../../utils/storeReceive'

/**
 * Expected deliveries for a store (POS receive list).
 * Scopes: store_ops:read or pos:read
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const workspaceId = String(query.workspace_id || '').trim()
  const posLocationCode = String(query.pos_location_code || query.store_code || '').trim()
  const inventoryLocationId = String(query.location_id || query.inventory_location_id || '').trim()

  const client = getServiceClient()
  const apiKey = await authenticateApiKey(event)

  if (apiKey) {
    if (workspaceId && apiKey.workspaceId !== workspaceId) {
      throw createError({ statusCode: 403, statusMessage: 'Workspace mismatch' })
    }
    if (!hasScope(apiKey, 'pos:read') && !hasScope(apiKey, 'store_ops:read')) {
      throw createError({ statusCode: 403, statusMessage: 'API key lacks pos:read or store_ops:read' })
    }
  } else {
    if (!workspaceId) throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
    await requireScope(event, 'store_ops:read', { workspaceId, client, accessLevel: 'member' })
  }

  const ws = apiKey?.workspaceId || workspaceId
  const data = await listExpectedDeliveries(client, {
    workspaceId: ws,
    posLocationCode: posLocationCode || null,
    inventoryLocationId: inventoryLocationId || null,
  })

  return { data, store_code: posLocationCode || null }
})
