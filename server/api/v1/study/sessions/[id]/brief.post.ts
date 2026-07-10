/**
 * Generate study brief (Grok if XAI_API_KEY set, else offline grounded brief).
 * POST /api/v1/study/sessions/:id/brief
 * Body: { force_offline?: boolean }
 */
import { requireApiKey } from '../../../../../utils/apiAuth'
import { runStudyBrief } from '../../../../../utils/marketplaceStudy'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'study:write')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const body = await readBody(event).catch(() => ({}))

  try {
    const result = await runStudyBrief(id, auth.workspaceId, {
      force_offline: body?.force_offline === true,
    })
    return {
      artifact: result.artifact,
      grounded: result.grounded,
      model: result.model,
      evidence: {
        listing_count: result.evidence.listing_count,
        metrics: result.evidence.metrics,
      },
    }
  } catch (err: any) {
    throw createError({
      statusCode: err?.message?.includes('not found') ? 404 : 500,
      statusMessage: err?.message?.slice(0, 400) || 'brief failed',
    })
  }
})
