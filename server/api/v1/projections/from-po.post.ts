import { requireApiKey } from '../../../utils/apiAuth'
import { projectFromPo } from '../../../utils/projections'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'projection:run')
  const body = await readBody(event)
  if (!body?.po_id) throw createError({ statusCode: 400, statusMessage: 'po_id required' })
  try {
    const projection = await projectFromPo(auth.workspaceId, body.po_id, body)
    setResponseStatus(event, 201)
    return { projection }
  } catch (err: any) {
    throw createError({ statusCode: 400, statusMessage: err?.message?.slice(0, 400) || 'failed' })
  }
})
