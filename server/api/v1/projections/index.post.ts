import { requireApiKey } from '../../../utils/apiAuth'
import { createProjection } from '../../../utils/projections'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'projection:run')
  const body = await readBody(event)
  try {
    const projection = await createProjection({
      workspace_id: auth.workspaceId,
      title: body?.title || 'Projection',
      source_type: body?.source_type || 'manual',
      assumptions: body?.assumptions || body || {},
      linked_po_id: body?.linked_po_id,
      linked_study_id: body?.linked_study_id,
      linked_product_id: body?.linked_product_id,
      force_offline: body?.force_offline === true,
    })
    setResponseStatus(event, 201)
    return { projection }
  } catch (err: any) {
    throw createError({ statusCode: 400, statusMessage: err?.message?.slice(0, 400) || 'projection failed' })
  }
})
