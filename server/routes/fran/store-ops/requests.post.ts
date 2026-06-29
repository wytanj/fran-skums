import { genericStoreOpsRequestType, normalizeFranStoreOpsType } from '../../../fran/pos'

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveInt(value: unknown) {
  const parsed = Math.floor(Number(value) || 0)
  return parsed > 0 ? parsed : 0
}

function requestNumber() {
  return `FRAN-REQ-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`
}

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'pos:write')
  const client = getAdminClient()
  const body = await readBody(event)
  const franRequestType = normalizeFranStoreOpsType(body.fran_request_type || body.request_type)
  const idempotencyKey = trimString(body.idempotency_key)

  if (idempotencyKey) {
    const { data: existing, error: existingError } = await client
      .from('store_replenishment_requests')
      .select('*')
      .eq('workspace_id', ctx.workspaceId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    if (existingError) throw createError({ statusCode: 500, statusMessage: existingError.message })
    if (existing) return { data: existing, duplicate: true }
  }

  const linesInput = Array.isArray(body.lines) ? body.lines : []
  const lines = linesInput
    .map((line: any) => ({
      sku: trimString(line.sku || line.barcode || line.identifier),
      requested_qty: positiveInt(line.requested_qty ?? line.quantity),
      reason: trimString(line.reason || body.reason) || null,
      metadata: {
        ...(line.metadata || {}),
        fran_request_type: franRequestType,
      },
    }))
    .filter((line: any) => line.sku && line.requested_qty > 0)

  if (!lines.length) {
    throw createError({ statusCode: 400, statusMessage: 'lines must include at least one sku and positive quantity' })
  }

  const { data: request, error: requestError } = await client
    .from('store_replenishment_requests')
    .insert({
      workspace_id: ctx.workspaceId,
      request_number: body.request_number || requestNumber(),
      request_type: genericStoreOpsRequestType(franRequestType),
      status: body.status || 'submitted',
      priority: body.priority || 'normal',
      source_type: body.source_type || 'pos',
      source_ref: body.source_ref || body.reference || null,
      idempotency_key: idempotencyKey || null,
      pos_location_id: body.pos_location_id || null,
      store_location_id: body.store_location_id || body.inventory_location_id || null,
      needed_by: body.needed_by || null,
      reason: body.reason || null,
      metadata: {
        ...(body.metadata || {}),
        fran_request_type: franRequestType,
        crm_ref: body.crm_ref || null,
        reward_ref: body.reward_ref || null,
        source_app: 'fran_pos',
      },
    })
    .select()
    .single()

  if (requestError) throw createError({ statusCode: 500, statusMessage: requestError.message })

  const { data: requestLines, error: lineError } = await client
    .from('store_replenishment_request_lines')
    .insert(lines.map((line: any) => ({
      ...line,
      workspace_id: ctx.workspaceId,
      request_id: request.id,
    })))
    .select()

  if (lineError) throw createError({ statusCode: 500, statusMessage: lineError.message })

  setResponseStatus(event, 201)
  return { data: { request, lines: requestLines || [] } }
})
