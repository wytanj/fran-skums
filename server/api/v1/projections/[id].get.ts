import { requireApiKey } from '../../../utils/apiAuth'
import { getProjection } from '../../../utils/projections'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const projection = await getProjection(auth.workspaceId, id)
  if (!projection) throw createError({ statusCode: 404, statusMessage: 'not found' })
  return { projection }
})
