import { applyInventoryAdjustment } from '../../../../utils/inventoryAdjustments'

/**
 * Apply pending inventory adjustment → ledger.
 * Scopes: inventory:write (required). Optional store_ops:verify if unified inbox policy.
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
    const result = await applyInventoryAdjustment(client, {
      workspaceId,
      adjustmentId: id,
      appliedBy: actor.userId || null,
      note: body.note || null,
      channel: 'ui',
    })
    return { ok: true, ...result }
  } catch (err: any) {
    throw createError({
      statusCode: err?.statusCode || 500,
      statusMessage: err?.message || 'Apply adjustment failed',
    })
  }
})
