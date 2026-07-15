import { notifyReplenishmentRequestSubmitted } from '../../utils/storeReplenishment'

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveInt(value: unknown) {
  const parsed = Math.floor(Number(value) || 0)
  return parsed > 0 ? parsed : 0
}

function requestNumber() {
  return `SRR-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 999).toString().padStart(3, '0')}`
}

const REQUEST_TYPES = new Set([
  'manual',
  'low_stock',
  'cycle_count',
  'campaign',
  'system_suggested',
  'pos_requested',
])

const PRIORITIES = new Set(['low', 'normal', 'urgent', 'critical'])

/**
 * HQ UI: create store replenishment request (signal only).
 * Scope: store_ops:write
 * Uses service role after scope check so RLS cannot block RETURNING.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  const client = getServiceClient()
  const actor = await requireScope(event, 'store_ops:write', {
    workspaceId,
    client,
    accessLevel: 'write',
  })

  const linesInput = Array.isArray(body.lines) ? body.lines : []
  const lines = linesInput
    .map((line: any) => ({
      sku: trimString(line.sku),
      requested_qty: positiveInt(line.requested_qty ?? line.quantity),
      reason: trimString(line.reason) || null,
      product_id: trimString(line.product_id) || null,
    }))
    .filter((line: any) => line.sku && line.requested_qty > 0)

  if (!lines.length) {
    throw createError({ statusCode: 400, statusMessage: 'Add at least one SKU line with quantity > 0' })
  }

  const requestType = trimString(body.request_type) || 'manual'
  if (!REQUEST_TYPES.has(requestType)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid request_type: ${requestType}` })
  }

  const priority = trimString(body.priority) || 'normal'
  if (!PRIORITIES.has(priority)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid priority: ${priority}` })
  }

  let neededBy: string | null = trimString(body.needed_by) || null
  if (neededBy && !/^\d{4}-\d{2}-\d{2}/.test(neededBy)) {
    throw createError({ statusCode: 400, statusMessage: 'needed_by must be a date (YYYY-MM-DD)' })
  }
  if (neededBy) neededBy = neededBy.slice(0, 10)

  const posLocationId = trimString(body.pos_location_id) || null
  let storeLocationId = trimString(body.store_location_id) || null

  // Prefer POS location's inventory bind when store not set
  if (!storeLocationId && posLocationId) {
    const { data: posLoc } = await client
      .from('pos_locations')
      .select('inventory_location_id')
      .eq('workspace_id', workspaceId)
      .eq('id', posLocationId)
      .maybeSingle()
    storeLocationId = posLoc?.inventory_location_id || null
  }

  const { data: request, error } = await client
    .from('store_replenishment_requests')
    .insert({
      workspace_id: workspaceId,
      request_number: trimString(body.request_number) || requestNumber(),
      request_type: requestType,
      status: 'submitted',
      priority,
      source_type: trimString(body.source_type) || 'skums',
      source_ref: trimString(body.source_ref) || null,
      idempotency_key: trimString(body.idempotency_key) || null,
      pos_location_id: posLocationId,
      store_location_id: storeLocationId,
      requested_by: actor.userId || null,
      needed_by: neededBy,
      reason: trimString(body.reason) || null,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : { entry_surface: 'store_ops_api' },
    })
    .select()
    .single()

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to create replenishment request',
    })
  }

  const lineRows = lines.map((line: any) => ({
    workspace_id: workspaceId,
    request_id: request.id,
    product_id: line.product_id,
    sku: line.sku,
    requested_qty: line.requested_qty,
    status: 'requested',
    reason: line.reason,
    metadata: {},
  }))

  const { data: insertedLines, error: lineError } = await client
    .from('store_replenishment_request_lines')
    .insert(lineRows)
    .select()

  if (lineError) {
    // roll back header so UI can retry cleanly
    await client.from('store_replenishment_requests').delete().eq('id', request.id)
    throw createError({
      statusCode: 500,
      statusMessage: lineError.message || 'Failed to create request lines',
    })
  }

  // HQ inbox notification (best-effort)
  let notificationId: string | null = null
  try {
    const notif = await notifyReplenishmentRequestSubmitted(client, {
      workspaceId,
      requestId: request.id,
      requestNumber: request.request_number,
      priority: request.priority,
      reason: request.reason,
      lineCount: lines.length,
      requestedBy: actor.userId || null,
      actorUserId: actor.userId || null,
    })
    notificationId = notif?.id || null
  } catch {
    // non-blocking
  }

  return {
    ok: true,
    data: {
      request,
      lines: insertedLines || [],
      notification_id: notificationId,
      message: 'Request submitted to HQ queue (not sent to Loft).',
    },
  }
})
