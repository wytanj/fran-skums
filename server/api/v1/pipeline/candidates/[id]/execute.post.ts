/**
 * Execute an accepted candidate (Phase 3: watchlist_seed | catalog_product).
 * POST /api/v1/pipeline/candidates/:id/execute
 */
import { requireApiKey } from '../../../../../utils/apiAuth'
import { executePipelineCandidate } from '../../../../../utils/marketplacePipeline'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'pipeline:execute')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  try {
    const candidate = await executePipelineCandidate({
      workspace_id: auth.workspaceId,
      candidate_id: id,
    })
    return { candidate }
  } catch (err: any) {
    throw createError({
      statusCode: err?.message?.includes('not found') ? 404 : 400,
      statusMessage: err?.message?.slice(0, 400) || 'execute failed',
    })
  }
})
