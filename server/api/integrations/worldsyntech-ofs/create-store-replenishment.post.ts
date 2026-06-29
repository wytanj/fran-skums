import {
  completeIntegrationExecution,
  integrationCredential,
  loadIntegrationConnection,
  startIntegrationExecution,
  upsertIntegrationEntityMapping,
} from '../../../utils/integrationActions'
import {
  createWorldsyntechStoreReplenishmentOrder,
  stableWorldsyntechHash,
  type WorldsyntechCredentials,
} from '../../../../fulfillment/worldsyntech-ofs/client'
import { mapWorldsyntechOrderCreateResult } from '../../../../fulfillment/worldsyntech-ofs/mapping'
import type { StoreReplenishmentOrder } from '../../../../fulfillment/_types'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const connectionId = String(body.connection_id || '').trim()
  const order = body.order as StoreReplenishmentOrder | undefined
  if (!connectionId) throw createError({ statusCode: 400, statusMessage: 'connection_id is required' })
  if (!order?.reference_no || !order?.shipping_address || !order?.lines?.length) {
    throw createError({ statusCode: 400, statusMessage: 'order with reference_no, shipping_address, and lines is required' })
  }

  const client = getServiceClient()
  const connection = await loadIntegrationConnection(event, client, connectionId, 'worldsyntech-ofs', 'write')
  const credential = integrationCredential(connection)
  if (!credential?.credential_data) throw createError({ statusCode: 400, statusMessage: 'WorldSyntech/OFS connection has no credential' })

  const startedAt = Date.now()
  const executionId = await startIntegrationExecution(client, connection, 'create_store_replenishment', {
    source: 'worldsyntech_ofs',
    reference_no: order.reference_no,
  })

  try {
    const result = await createWorldsyntechStoreReplenishmentOrder(credential.credential_data as WorldsyntechCredentials, order)
    const mapped = mapWorldsyntechOrderCreateResult(result.data)
    if (mapped.external_id) {
      await upsertIntegrationEntityMapping(client, {
        workspace_id: connection.workspace_id,
        connection_id: connection.id,
        entity_type: 'order',
        local_entity_type: 'store_replenishment',
        external_id: mapped.external_id,
        external_secondary_id: order.reference_no,
        external_data: {
          source: 'worldsyntech_ofs',
          order,
          response: result.data,
        },
        remote_hash: stableWorldsyntechHash(result.data),
      })
    }

    await client.from('integration_credentials').update({ credential_data: result.credentials }).eq('id', credential.id)
    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'success',
      outputData: { source: 'worldsyntech_ofs', result: mapped },
      itemsProcessed: order.lines.length,
      itemsCreated: mapped.external_ids?.length || 0,
    })

    return { ok: true, connection_id: connection.id, result: mapped }
  } catch (error: any) {
    const message = error?.message || 'WorldSyntech/OFS store replenishment creation failed'
    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'error',
      outputData: { source: 'worldsyntech_ofs' },
      errorMessage: message,
      itemsFailed: 1,
    })
    throw createError({ statusCode: 502, statusMessage: message })
  }
})
