/**
 * Fran/POS alias for store receive (same as POST /api/store-ops/receive).
 */
import { submitStoreReceive } from '../../../utils/storeReceive'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const orderId = String(body.order_id || body.replenishment_order_id || body.source_ref || '').trim()
  const idempotencyKey = String(body.idempotency_key || '').trim()
  const lines = Array.isArray(body.lines) ? body.lines : []

  if (!orderId) throw createError({ statusCode: 400, statusMessage: 'order_id is required' })
  if (!idempotencyKey) throw createError({ statusCode: 400, statusMessage: 'idempotency_key is required' })
  if (!lines.length) throw createError({ statusCode: 400, statusMessage: 'lines required' })

  const ctx = await authenticateApiKey(event)
  if (!ctx) {
    throw createError({
      statusCode: 401,
      statusMessage: 'API key required. Pass via Authorization: Bearer <key> or X-API-Key header.',
    })
  }
  if (!hasScope(ctx, 'pos:write') && !hasScope(ctx, 'store_ops:write')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'API key lacks pos:write or store_ops:write',
    })
  }

  const client = getAdminClient()
  try {
    const result = await submitStoreReceive(client, {
      workspaceId: ctx.workspaceId,
      orderId,
      idempotencyKey,
      receivedByRef: body.received_by_ref || body.received_by || null,
      receivedAt: body.received_at || null,
      posLocationCode: body.pos_location_code || null,
      collectorName: body.collector_name || null,
      collectorNote: body.collector_note || null,
      lines: lines.map((line: any) => ({
        sku: String(line.sku || '').trim(),
        product_id: line.product_id || null,
        replenishment_order_line_id: line.replenishment_order_line_id || line.order_line_id || null,
        expected_qty: Number(line.expected_qty || 0),
        received_qty: Number(line.received_qty ?? line.quantity ?? 0),
        damaged_qty: Number(line.damaged_qty || 0),
        exception_type: line.exception_type || null,
        note: line.note || line.reason || null,
      })),
    })

    setResponseStatus(event, result.duplicate ? 200 : 201)
    return { ok: true, ...result }
  } catch (err: any) {
    throw createError({
      statusCode: err?.statusCode || 500,
      statusMessage: err?.message || 'Receive failed',
    })
  }
})
