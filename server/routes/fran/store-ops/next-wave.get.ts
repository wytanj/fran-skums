import { resolveNextWaveForStore } from '../../../utils/storeDeliveryCalendar'
import { authenticateApiKey, hasApiKeyScope } from '../../../utils/apiAuth'

/**
 * POS-facing next wave hint (signal cadence only).
 * Auth: API key with pos:read / store_ops:read (or write).
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const ctx = await authenticateApiKey(event)
  if (!ctx) {
    throw createError({
      statusCode: 401,
      statusMessage: 'API key required. Pass via Authorization: Bearer <key> or X-API-Key header.',
    })
  }
  if (
    !hasApiKeyScope(ctx, 'pos:read')
    && !hasApiKeyScope(ctx, 'store_ops:read')
    && !hasApiKeyScope(ctx, 'pos:write')
    && !hasApiKeyScope(ctx, 'store_ops:write')
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: 'API key lacks required scope: pos:read or store_ops:read',
    })
  }

  const client = getAdminClient()
  return await resolveNextWaveForStore(client, {
    workspaceId: ctx.workspaceId,
    posLocationCode: query.pos_location_code ? String(query.pos_location_code) : null,
    inventoryLocationId: query.inventory_location_id ? String(query.inventory_location_id) : null,
  })
})
