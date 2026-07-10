/**
 * Create internal PO draft.
 * POST /api/v1/purchase-orders
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { createInternalPoDraft } from '../../../utils/internalPo'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'po:draft')
  const body = await readBody(event)
  try {
    const result = await createInternalPoDraft({
      workspace_id: auth.workspaceId,
      ...body,
    })
    setResponseStatus(event, result.deduped ? 200 : 201)
    return result
  } catch (err: any) {
    throw createError({ statusCode: 400, statusMessage: err?.message?.slice(0, 400) || 'create failed' })
  }
})
