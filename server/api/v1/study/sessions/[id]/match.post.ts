/**
 * Catalog match for a study session (rule-based + optional Grok rerank).
 * POST /api/v1/study/sessions/:id/match
 * Body: { force_offline?: boolean }
 */
import { requireApiKey } from '../../../../../utils/apiAuth'
import { runStudyMatchCatalog } from '../../../../../utils/marketplaceStudy'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'study:write')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const body = await readBody(event).catch(() => ({}))

  try {
    const result = await runStudyMatchCatalog(id, auth.workspaceId, {
      force_offline: body?.force_offline === true,
    })
    return {
      artifact: result.artifact,
      grounded: result.grounded,
      model: result.model,
      rule_matches: result.rule_matches,
    }
  } catch (err: any) {
    throw createError({
      statusCode: err?.message?.includes('not found') ? 404 : 500,
      statusMessage: err?.message?.slice(0, 400) || 'match failed',
    })
  }
})
