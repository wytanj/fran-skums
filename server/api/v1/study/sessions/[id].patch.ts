/**
 * Update research notebook cover fields.
 * PATCH /api/v1/study/sessions/:id
 * Body: { hypothesis?, query?, status?, metadata?, subject_kind?, brand_key?, crawl_intent?, discovery?, linked_product_id? }
 */
import { requireApiKey } from '../../../../utils/apiAuth'
import { researchDeepLink, updateStudySession } from '../../../../utils/marketplaceStudy'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'study:write')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const body = await readBody(event)
  try {
    const session = await updateStudySession({
      workspace_id: auth.workspaceId,
      session_id: id,
      hypothesis: body?.hypothesis,
      query: body?.query,
      status: body?.status,
      linked_product_id: body?.linked_product_id,
      metadata: body?.metadata,
      subject_kind: body?.subject_kind,
      brand_key: body?.brand_key,
      crawl_intent: body?.crawl_intent,
      discovery: body?.discovery,
    })
    return {
      session,
      deep_link: researchDeepLink(session.id),
      note: 'Notebook updated — no crawl.',
    }
  } catch (err: any) {
    const msg = err?.message?.slice(0, 300) || 'Failed to update study session'
    const notFound = /not found/i.test(msg)
    throw createError({
      statusCode: notFound ? 404 : 400,
      statusMessage: msg,
    })
  }
})
