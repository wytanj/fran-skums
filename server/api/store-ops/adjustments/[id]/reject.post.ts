import { rejectInventoryAdjustment } from '../../../../utils/inventoryAdjustments'

/**
 * Reject pending inventory adjustment (no ledger write).
 * Scopes: inventory:write
 */
export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '').trim()
  const body = await readBody(event)
  const workspaceId = String(body.workspace_id || '').trim()

  if (!id || !workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'id and workspace_id are required' })
  }

  const client = getServiceClient()
  const actor = await requireScope(event, 'inventory:write', {
    workspaceId,
    client,
    accessLevel: 'write',
  })

  try {
    const result = await rejectInventoryAdjustment(client, {
      workspaceId,
      adjustmentId: id,
      rejectedBy: actor.userId || null,
      note: body.note || null,
      channel: 'ui',
    })
    return { ok: true, ...result }
  } catch (err: any) {
    throw createError({
      statusCode: err?.statusCode || 500,
      statusMessage: err?.message || 'Reject adjustment failed',
    })
  }
})
