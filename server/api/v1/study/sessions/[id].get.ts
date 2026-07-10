/**
 * Get study session + artifacts.
 * GET /api/v1/study/sessions/:id
 */
import { requireApiKey } from '../../../../utils/apiAuth'
import { getStudySession } from '../../../../utils/marketplaceStudy'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const pack = await getStudySession(auth.workspaceId, id)
  if (!pack) throw createError({ statusCode: 404, statusMessage: 'Study session not found' })
  return pack
})
