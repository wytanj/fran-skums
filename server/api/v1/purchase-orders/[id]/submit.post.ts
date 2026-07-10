import { requireApiKey } from '../../../../utils/apiAuth'
import { submitInternalPo } from '../../../../utils/internalPo'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'po:submit')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  try {
    return await submitInternalPo(auth.workspaceId, id)
  } catch (err: any) {
    throw createError({ statusCode: 400, statusMessage: err?.message?.slice(0, 400) || 'submit failed' })
  }
})
