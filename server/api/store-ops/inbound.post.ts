import { createInboundShipment } from '../../utils/inboundShipment'

/**
 * Create local inbound ASN (KR/HK → Loft). Does not send to OFS until send-to-loft.
 * Scope: store_ops:inbound (or execute_3pl for ops admins)
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const workspaceId = String(body.workspace_id || '').trim()
  const trackingNumber = String(body.tracking_number || '').trim()
  const dateEstimate = String(body.date_estimate || '').trim()
  const lines = Array.isArray(body.lines) ? body.lines : []

  if (!workspaceId) throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  if (!trackingNumber || !dateEstimate) {
    throw createError({ statusCode: 400, statusMessage: 'tracking_number and date_estimate are required' })
  }
  if (!lines.length) throw createError({ statusCode: 400, statusMessage: 'lines required' })

  const client = getServiceClient()
  // Prefer inbound scope; allow execute_3pl as superset for 3pl admins
  let actor
  try {
    actor = await requireScope(event, 'store_ops:inbound', { workspaceId, client, accessLevel: 'write' })
  } catch {
    actor = await requireScope(event, 'store_ops:execute_3pl', { workspaceId, client, accessLevel: 'write' })
  }

  try {
    const result = await createInboundShipment(client, {
      workspaceId,
      trackingNumber,
      dateEstimate,
      referenceNo: body.reference_no || null,
      connectionId: body.connection_id || null,
      localForwarder: body.local_forwarder || 'M&P',
      offshoreForwarder: body.offshore_forwarder || null,
      palletization: body.palletization || null,
      cartonCount: body.carton_count != null ? Number(body.carton_count) : null,
      palletCount: body.pallet_count != null ? Number(body.pallet_count) : null,
      notes: body.notes || null,
      createdBy: actor.userId || null,
      lines: lines.map((l: any) => ({
        sku: String(l.sku || '').trim(),
        quantity: Number(l.quantity || 0),
        product_id: l.product_id || null,
        product_name: l.product_name || null,
        external_product_id: l.external_product_id || null,
        product_price: l.product_price,
        product_weight: l.product_weight,
        product_dimension: l.product_dimension,
        product_description: l.product_description,
      })),
    })

    setResponseStatus(event, 201)
    return {
      ok: true,
      ...result,
      message: 'ASN draft created. Send to Loft when ready (store_ops:execute_3pl / inbound).',
    }
  } catch (err: any) {
    throw createError({
      statusCode: err?.statusCode || 500,
      statusMessage: err?.message || 'Create inbound failed',
    })
  }
})
