import {
  completeIntegrationExecution,
  integrationCredential,
  loadIntegrationConnection,
  startIntegrationExecution,
  upsertIntegrationEntityMapping,
} from '../../../utils/integrationActions'
import {
  fetchWorldsyntechApi,
  stableWorldsyntechHash,
  type WorldsyntechCredentials,
} from '../../../../fulfillment/worldsyntech-ofs/client'

/**
 * Poll OFS order list and update mapped store_replenishment_orders.
 * Requires integrations:execute / session write on connection.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const connectionId = String(body.connection_id || '').trim()
  if (!connectionId) {
    throw createError({ statusCode: 400, statusMessage: 'connection_id is required' })
  }

  const client = getServiceClient()
  const connection = await loadIntegrationConnection(event, client, connectionId, 'worldsyntech-ofs', 'write')
  const credential = integrationCredential(connection)
  if (!credential?.credential_data) {
    throw createError({ statusCode: 400, statusMessage: 'Connection has no credential' })
  }

  const offset = Math.max(0, Number(body.offset) || 0)
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 250)
  const startedAt = Date.now()
  const executionId = await startIntegrationExecution(client, connection, 'poll_orders', {
    source: 'worldsyntech_ofs',
    offset,
    limit,
  })

  try {
    const page = await fetchWorldsyntechApi<Record<string, unknown>[]>(
      credential.credential_data as WorldsyntechCredentials,
      'rest_customer/order/get_list',
      { offset, limit },
    )

    const rows = Array.isArray(page.data) ? page.data : []
    let updated = 0

    for (const raw of rows) {
      const orderId = String((raw as any).order_id ?? (raw as any).id ?? '').trim()
      if (!orderId) continue
      const remoteStatus = String((raw as any).order_status ?? (raw as any).status ?? '').trim()
      const referenceNo = String((raw as any).reference_no ?? '').trim()

      await upsertIntegrationEntityMapping(client, {
        workspace_id: connection.workspace_id,
        connection_id: connection.id,
        entity_type: 'order',
        external_id: orderId,
        external_secondary_id: referenceNo || null,
        external_data: { source: 'worldsyntech_ofs', order: raw },
        remote_hash: stableWorldsyntechHash(raw),
      })

      const orFilter = referenceNo
        ? `external_order_id.eq.${orderId},order_number.eq.${referenceNo}`
        : `external_order_id.eq.${orderId}`

      const { data: byExternal } = await client
        .from('store_replenishment_orders')
        .select('id, status, metadata')
        .eq('workspace_id', connection.workspace_id)
        .or(orFilter)
        .limit(5)

      for (const local of byExternal || []) {
        const skumsStatus = mapRemoteOrderStatus(remoteStatus, local.status)
        await client
          .from('store_replenishment_orders')
          .update({
            external_order_id: orderId,
            external_status: remoteStatus || null,
            status: skumsStatus,
            metadata: {
              ...(local.metadata || {}),
              last_polled_at: new Date().toISOString(),
              last_remote: raw,
            },
          })
          .eq('id', local.id)
        updated += 1
      }
    }

    await client
      .from('integration_credentials')
      .update({ credential_data: page.credentials })
      .eq('id', credential.id)

    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'success',
      outputData: { source: 'worldsyntech_ofs', remote_count: rows.length, updated },
      itemsProcessed: rows.length,
      itemsCreated: updated,
    })

    return {
      ok: true,
      remote_count: rows.length,
      updated,
      has_more: rows.length >= limit,
      next_offset: rows.length >= limit ? offset + limit : null,
    }
  } catch (error: any) {
    const message = error?.message || 'Poll orders failed'
    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'error',
      outputData: { source: 'worldsyntech_ofs' },
      errorMessage: message,
      itemsFailed: 1,
    })
    throw createError({ statusCode: 502, statusMessage: message })
  }
})

function mapRemoteOrderStatus(remote: string, current: string): string {
  const r = remote.toLowerCase()
  if (!r) return current
  if (r.includes('cancel')) return 'cancelled'
  if (r.includes('deliver') || r.includes('complete')) return current === 'received' ? 'received' : 'shipped'
  if (r.includes('ship') || r.includes('dispatch')) return 'shipped'
  if (r.includes('pick') || r.includes('ready') || r.includes('collect')) return 'shipped'
  if (r.includes('process') || r.includes('ack')) return 'acknowledged'
  if (r.includes('fail') || r.includes('error') || r.includes('stockout')) return 'exception'
  return current === 'sent_to_3pl' || current === 'acknowledged' || current === 'shipped'
    ? current
    : 'sent_to_3pl'
}
