/**
 * Open a research notebook (study session). Does not start Shopee crawl.
 * POST /api/v1/study/sessions
 * Body: { hypothesis, query?, marketplace?, country?, metadata?, subject_kind?, brand_key?, crawl_intent?, discovery?, discovery_url? }
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { createStudySession, researchDeepLink } from '../../../utils/marketplaceStudy'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'study:write')
  const body = await readBody(event)

  try {
    const meta =
      body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? { ...body.metadata }
        : {}
    if (body?.discovery_url) meta.discovery_url = String(body.discovery_url)

    const session = await createStudySession({
      workspace_id: auth.workspaceId,
      hypothesis: body?.hypothesis,
      query: body?.query ?? null,
      marketplace: body?.marketplace,
      country: body?.country,
      metadata: meta,
      subject_kind: body?.subject_kind,
      brand_key: body?.brand_key,
      crawl_intent: body?.crawl_intent,
      discovery: body?.discovery,
      opened_by: auth.boundUserId || null,
    })
    setResponseStatus(event, 201)
    return {
      session,
      deep_link: researchDeepLink(session.id),
      note: 'Research notebook opened — no Shopee crawl.',
    }
  } catch (err: any) {
    throw createError({
      statusCode: 400,
      statusMessage: err?.message?.slice(0, 300) || 'Failed to create study session',
    })
  }
})
