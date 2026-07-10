/**
 * List pipeline candidates.
 * GET /api/v1/pipeline/candidates?status=&kind=
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { listPipelineCandidates } from '../../../utils/marketplacePipeline'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const query = getQuery(event)

  try {
    const candidates = await listPipelineCandidates(auth.workspaceId, {
      status: typeof query.status === 'string' ? query.status : undefined,
      kind: typeof query.kind === 'string' ? query.kind : undefined,
      limit: Number(query.limit) || 50,
    })
    return { candidates }
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: err?.message || 'list failed' })
  }
})
