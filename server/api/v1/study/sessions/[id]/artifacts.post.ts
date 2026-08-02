/**
 * Append a notebook page (note / other / …).
 * POST /api/v1/study/sessions/:id/artifacts
 * Body: { artifact_type?, title?, body?, url?, channel?, payload?, evidence_refs? }
 */
import { requireApiKey } from '../../../../../utils/apiAuth'
import { addStudyArtifact, researchDeepLink } from '../../../../../utils/marketplaceStudy'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'study:write')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const body = await readBody(event)
  try {
    const artifact = await addStudyArtifact({
      workspace_id: auth.workspaceId,
      session_id: id,
      artifact_type: body?.artifact_type || 'note',
      title: body?.title,
      body: body?.body,
      url: body?.url,
      channel: body?.channel,
      payload: body?.payload,
      evidence_refs: body?.evidence_refs,
    })
    setResponseStatus(event, 201)
    return {
      artifact,
      deep_link: researchDeepLink(id),
      note: 'Notebook page added — no crawl.',
    }
  } catch (err: any) {
    const msg = err?.message?.slice(0, 300) || 'Failed to add artifact'
    const notFound = /not found/i.test(msg)
    throw createError({
      statusCode: notFound ? 404 : 400,
      statusMessage: msg,
    })
  }
})
