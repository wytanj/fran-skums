import { requireApiKey } from '../../../../utils/apiAuth'
import { addInternalPoLines } from '../../../../utils/internalPo'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'po:draft')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const body = await readBody(event)
  try {
    const pack = await addInternalPoLines(auth.workspaceId, id, body?.lines || [])
    return pack
  } catch (err: any) {
    throw createError({ statusCode: 400, statusMessage: err?.message?.slice(0, 400) || 'add lines failed' })
  }
})
