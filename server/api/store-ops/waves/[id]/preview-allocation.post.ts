import { previewWaveAllocation, saveWaveAllocationPreview } from '../../../../utils/storeDeliveryCalendar'

/**
 * Multi-store allocation preview from Loft ATS for a wave.
 * Scope: store_ops:approve + inventory:read (via approve package)
 */
export default defineEventHandler(async (event) => {
  const waveId = String(getRouterParam(event, 'id') || '').trim()
  const body = await readBody(event)
  const workspaceId = String(body.workspace_id || '').trim()
  if (!waveId || !workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'id and workspace_id are required' })
  }

  const client = getServiceClient()
  const actor = await requireScope(event, 'store_ops:approve', {
    workspaceId,
    client,
    accessLevel: 'write',
  })
  await requireScope(event, 'inventory:read', { workspaceId, client, accessLevel: 'member' })

  const persist = body.persist === true || body.persist === '1'
  try {
    if (persist) {
      const result = await saveWaveAllocationPreview(client, {
        workspaceId,
        waveId,
        createdBy: actor.userId || null,
      })
      return { ok: true, ...result }
    }
    const preview = await previewWaveAllocation(client, { workspaceId, waveId })
    return { ok: true, preview }
  } catch (err: any) {
    throw createError({
      statusCode: err?.statusCode || 500,
      statusMessage: err?.message || 'Allocation preview failed',
    })
  }
})
