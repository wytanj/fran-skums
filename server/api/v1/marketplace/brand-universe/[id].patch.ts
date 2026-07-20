/**
 * Patch a brand universe row (tier, enabled, priority, flags).
 * PATCH /api/v1/marketplace/brand-universe/:id
 */
import { requireApiKey } from '../../../../utils/apiAuth'
import { patchBrandUniverse } from '../../../../utils/marketplaceBrandUniverse'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:write')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const body = await readBody(event)
  try {
    const brand = await patchBrandUniverse(auth.workspaceId, id, body || {})
    return { brand }
  } catch (e: any) {
    throw createError({
      statusCode: e?.statusCode || 500,
      statusMessage: e?.message || 'patch failed',
    })
  }
})
