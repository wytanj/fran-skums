import { convertWaveRequestsToOrders } from '../../../../utils/storeReplenishment'

/**
 * Convert all deferred_to_wave requests on a wave into replenishment orders.
 * Does NOT send to Loft — that requires store_ops:execute_3pl separately.
 */
export default defineEventHandler(async (event) => {
  const waveId = String(getRouterParam(event, 'id') || '').trim()
  const body = await readBody(event)
  const workspaceId = String(body.workspace_id || '').trim()
  if (!waveId || !workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'wave id and workspace_id are required' })
  }

  const client = getServiceClient()
  const actor = await requireScope(event, 'store_ops:approve', {
    workspaceId,
    client,
    accessLevel: 'write',
  })

  const orders = await convertWaveRequestsToOrders(client, {
    workspaceId,
    waveId,
    approvedBy: actor.userId || null,
    deliveryMode: body.delivery_mode || 'delivery',
    connectionId: body.connection_id || null,
    sourceLocationId: body.source_location_id || null,
  })

  return { ok: true, orders, count: orders.length }
})
