import { requireApiKey } from '../../../utils/apiAuth'
import { projectFromStudy } from '../../../utils/projections'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'projection:run')
  const body = await readBody(event)
  if (!body?.study_session_id) throw createError({ statusCode: 400, statusMessage: 'study_session_id required' })
  if (body.unit_cost == null) throw createError({ statusCode: 400, statusMessage: 'unit_cost required' })
  try {
    const projection = await projectFromStudy(auth.workspaceId, body.study_session_id, body)
    setResponseStatus(event, 201)
    return { projection }
  } catch (err: any) {
    throw createError({ statusCode: 400, statusMessage: err?.message?.slice(0, 400) || 'failed' })
  }
})
