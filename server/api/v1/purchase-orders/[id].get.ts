import { requireApiKey } from '../../../utils/apiAuth'
import { getInternalPo } from '../../../utils/internalPo'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const pack = await getInternalPo(auth.workspaceId, id)
  if (!pack) throw createError({ statusCode: 404, statusMessage: 'PO not found' })
  return pack
})
