import { verifyInventoryException } from '../../../../utils/storeReceive'

const ACTIONS = new Set(['confirm', 'reject', 'adjust', 'escalate'])

/**
 * HQ verify POS-reported receive exceptions.
 * Scope: store_ops:verify
 */
export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '').trim()
  const body = await readBody(event)
  const workspaceId = String(body.workspace_id || '').trim()
  const action = String(body.action || '').trim()

  if (!id || !workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'id and workspace_id are required' })
  }
  if (!ACTIONS.has(action)) {
    throw createError({ statusCode: 400, statusMessage: 'action must be confirm|reject|adjust|escalate' })
  }

  const client = getServiceClient()
  const actor = await requireScope(event, 'store_ops:verify', {
    workspaceId,
    client,
    accessLevel: 'write',
  })

  if (action === 'adjust') {
    await requireScope(event, 'inventory:write', { workspaceId, client, accessLevel: 'write' })
  }

  try {
    const updated = await verifyInventoryException(client, {
      workspaceId,
      exceptionId: id,
      action: action as any,
      verifiedBy: actor.userId || null,
      note: body.note || null,
      adjustActualQty: body.adjust_actual_qty != null ? Number(body.adjust_actual_qty) : null,
    })
    return { ok: true, exception: updated }
  } catch (err: any) {
    throw createError({
      statusCode: err?.statusCode || 500,
      statusMessage: err?.message || 'Verify failed',
    })
  }
})
