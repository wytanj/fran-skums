import {
  decideReplenishmentRequest,
  type ReplenishmentDecision,
} from '../../../../utils/storeReplenishment'

const DECISIONS = new Set(['approve_now', 'reject', 'defer_to_wave'])

/**
 * HQ decision on a store replenishment request.
 * Requires store_ops:approve. Never calls Loft.
 */
export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '').trim()
  const body = await readBody(event)
  const workspaceId = String(body.workspace_id || '').trim()
  const decision = String(body.decision || '').trim() as ReplenishmentDecision

  if (!id) throw createError({ statusCode: 400, statusMessage: 'request id is required' })
  if (!workspaceId) throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  if (!DECISIONS.has(decision)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'decision must be approve_now | reject | defer_to_wave',
    })
  }

  const client = getServiceClient()
  const actor = await requireScope(event, 'store_ops:approve', {
    workspaceId,
    client,
    accessLevel: 'write',
  })

  try {
    const result = await decideReplenishmentRequest(client, {
      workspaceId,
      requestId: id,
      decision,
      decisionReason: body.decision_reason || body.reason || null,
      waveDate: body.wave_date || null,
      decidedBy: actor.userId || null,
      mcpContext: body.mcp_context || null,
      deliveryMode: body.delivery_mode || null,
    })
    return { ok: true, ...result }
  } catch (err: any) {
    const status = err?.statusCode || 500
    throw createError({ statusCode: status, statusMessage: err?.message || 'Decision failed' })
  }
})
