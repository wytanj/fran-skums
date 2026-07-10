/**
 * Accept / reject / defer a pipeline candidate.
 * POST /api/v1/pipeline/candidates/:id/decide
 * Body: { decision: 'accepted'|'rejected'|'deferred', decision_note? }
 */
import { requireApiKey } from '../../../../../utils/apiAuth'
import { decidePipelineCandidate } from '../../../../../utils/marketplacePipeline'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'pipeline:decide')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const body = await readBody(event)
  const decision = body?.decision
  if (!['accepted', 'rejected', 'deferred'].includes(decision)) {
    throw createError({
      statusCode: 400,
      statusMessage: "decision must be 'accepted' | 'rejected' | 'deferred'",
    })
  }

  try {
    const candidate = await decidePipelineCandidate({
      workspace_id: auth.workspaceId,
      candidate_id: id,
      decision,
      decision_note: body?.decision_note,
    })
    return { candidate }
  } catch (err: any) {
    throw createError({
      statusCode: err?.message?.includes('not found') ? 404 : 400,
      statusMessage: err?.message?.slice(0, 400) || 'decide failed',
    })
  }
})
