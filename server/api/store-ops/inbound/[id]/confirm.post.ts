import { confirmInboundAndPromote } from '../../../../utils/inboundShipment'

/**
 * LISE confirm inbound + promote stock to LOFT-SG.
 * Scopes: store_ops:inbound + inventory:write (promote)
 */
export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '').trim()
  const body = await readBody(event)
  const workspaceId = String(body.workspace_id || '').trim()
  if (!id || !workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'id and workspace_id required' })
  }

  const client = getServiceClient()
  try {
    await requireScope(event, 'store_ops:inbound', { workspaceId, client, accessLevel: 'write' })
  } catch {
    await requireScope(event, 'store_ops:execute_3pl', { workspaceId, client, accessLevel: 'write' })
  }
  await requireScope(event, 'inventory:write', { workspaceId, client, accessLevel: 'write' })

  // re-resolve actor for confirmed_by
  const actor = await requireScope(event, 'store_ops:read', { workspaceId, client, accessLevel: 'write' })

  try {
    const result = await confirmInboundAndPromote(client, {
      workspaceId,
      shipmentId: id,
      confirmedBy: actor.userId || null,
      forcePromote: body.force === true,
      lineUpdates: Array.isArray(body.line_updates)
        ? body.line_updates.map((u: any) => ({
            line_id: String(u.line_id || u.id),
            quantity_received: u.quantity_received != null ? Number(u.quantity_received) : undefined,
            quantity_spoil: u.quantity_spoil != null ? Number(u.quantity_spoil) : undefined,
            expiry_year: u.expiry_year != null ? Number(u.expiry_year) : null,
            expiry_month: u.expiry_month != null ? Number(u.expiry_month) : null,
            expiry_day: u.expiry_day != null ? Number(u.expiry_day) : null,
          }))
        : undefined,
    })
    return { ok: true, ...result }
  } catch (err: any) {
    throw createError({
      statusCode: err?.statusCode || 500,
      statusMessage: err?.message || 'Confirm inbound failed',
    })
  }
})
