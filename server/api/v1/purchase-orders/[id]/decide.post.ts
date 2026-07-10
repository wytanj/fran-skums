import { requireApiKey } from '../../../../utils/apiAuth'
import { decideInternalPo } from '../../../../utils/internalPo'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'po:decide')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const body = await readBody(event)
  if (!['approved', 'rejected'].includes(body?.decision)) {
    throw createError({ statusCode: 400, statusMessage: "decision must be 'approved' or 'rejected'" })
  }
  try {
    return await decideInternalPo({
      workspace_id: auth.workspaceId,
      po_id: id,
      decision: body.decision,
      decision_note: body.decision_note,
    })
  } catch (err: any) {
    throw createError({ statusCode: 400, statusMessage: err?.message?.slice(0, 400) || 'decide failed' })
  }
})
