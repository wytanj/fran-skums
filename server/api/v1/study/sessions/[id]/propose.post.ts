/**
 * Propose pipeline candidates from latest study brief.
 * POST /api/v1/study/sessions/:id/propose
 * Body: { kinds?: string[] }
 */
import { requireApiKey } from '../../../../../utils/apiAuth'
import { proposeFromStudyBrief } from '../../../../../utils/marketplacePipeline'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'pipeline:propose')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const body = await readBody(event).catch(() => ({}))

  try {
    const result = await proposeFromStudyBrief({
      workspace_id: auth.workspaceId,
      study_session_id: id,
      kinds: Array.isArray(body?.kinds) ? body.kinds.map(String) : undefined,
    })
    return result
  } catch (err: any) {
    throw createError({
      statusCode: err?.message?.includes('not found') ? 404 : 400,
      statusMessage: err?.message?.slice(0, 400) || 'propose failed',
    })
  }
})
