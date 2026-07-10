/**
 * Open a study session.
 * POST /api/v1/study/sessions
 * Body: { hypothesis, query?, marketplace?, country?, metadata? }
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { createStudySession } from '../../../utils/marketplaceStudy'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'study:write')
  const body = await readBody(event)

  try {
    const session = await createStudySession({
      workspace_id: auth.workspaceId,
      hypothesis: body?.hypothesis,
      query: body?.query ?? null,
      marketplace: body?.marketplace,
      country: body?.country,
      metadata: body?.metadata,
    })
    setResponseStatus(event, 201)
    return { session }
  } catch (err: any) {
    throw createError({
      statusCode: 400,
      statusMessage: err?.message?.slice(0, 300) || 'Failed to create study session',
    })
  }
})
