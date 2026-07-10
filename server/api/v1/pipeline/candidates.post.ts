/**
 * Propose a pipeline candidate.
 * POST /api/v1/pipeline/candidates
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { proposePipelineCandidate } from '../../../utils/marketplacePipeline'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'pipeline:propose')
  const body = await readBody(event)

  try {
    const result = await proposePipelineCandidate({
      workspace_id: auth.workspaceId,
      kind: body?.kind,
      title: body?.title,
      summary: body?.summary,
      payload: body?.payload,
      evidence_refs: body?.evidence_refs,
      source_study_id: body?.source_study_id,
      listing_id: body?.listing_id,
      product_id: body?.product_id,
      idempotency_key: body?.idempotency_key,
    })
    setResponseStatus(event, result.deduped ? 200 : 201)
    return result
  } catch (err: any) {
    throw createError({
      statusCode: 400,
      statusMessage: err?.message?.slice(0, 400) || 'propose failed',
    })
  }
})
