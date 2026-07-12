/**
 * Create internal PO draft.
 * POST /api/v1/purchase-orders
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { recordApiAudit } from '../../../utils/audit'
import { getAdminClient } from '../../../utils/supabase'
import { createInternalPoDraft } from '../../../utils/internalPo'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'po:draft')
  const body = await readBody(event)
  try {
    const result = await createInternalPoDraft({
      workspace_id: auth.workspaceId,
      ...body,
    })
    const po = result.po
    if (po?.id) {
      await recordApiAudit(getAdminClient(), {
        workspace_id: auth.workspaceId,
        entity_type: 'internal_purchase_orders',
        entity_id: po.id,
        event_type: 'po.created',
        operation: result.deduped ? 'UPDATE' : 'INSERT',
        api_key_id: auth.keyId || null,
        after_data: po,
        metadata: { status: po.status, line_count: result.lines?.length ?? 0 },
      })
    }
    setResponseStatus(event, result.deduped ? 200 : 201)
    return {
      ...result,
      object_type: 'internal_purchase_orders',
      id: po?.id,
      status: po?.status ?? 'draft',
      is_draft: po?.status === 'draft',
      channel: 'api',
      next_allowed_actions: ['po_update_draft', 'po_add_lines', 'po_submit'],
    }
  } catch (err: any) {
    throw createError({ statusCode: 400, statusMessage: err?.message?.slice(0, 400) || 'create failed' })
  }
})
