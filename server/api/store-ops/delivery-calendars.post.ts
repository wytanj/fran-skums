import { upsertDeliveryCalendar } from '../../utils/storeDeliveryCalendar'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const workspaceId = String(body.workspace_id || '').trim()
  const inventoryLocationId = String(body.inventory_location_id || '').trim()
  if (!workspaceId || !inventoryLocationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'workspace_id and inventory_location_id are required',
    })
  }

  const client = getServiceClient()
  try {
    await requireScope(event, 'store_ops:approve', { workspaceId, client, accessLevel: 'write' })
  } catch {
    await requireScope(event, 'locations:write', { workspaceId, client, accessLevel: 'write' })
  }

  const data = await upsertDeliveryCalendar(client, {
    workspaceId,
    inventoryLocationId,
    posLocationId: body.pos_location_id || null,
    receiveWeekdays: Array.isArray(body.receive_weekdays) ? body.receive_weekdays : [],
    receiveWindowStart: body.receive_window_start || null,
    receiveWindowEnd: body.receive_window_end || null,
    preferredDeliveryMode: body.preferred_delivery_mode === 'self_collect' ? 'self_collect' : 'delivery',
    notes: body.notes || null,
  })
  return { ok: true, data }
})
