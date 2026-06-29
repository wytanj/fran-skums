import {
  completeIntegrationExecution,
  integrationCredential,
  loadIntegrationConnection,
  startIntegrationExecution,
  upsertIntegrationEntityMapping,
} from '../../../utils/integrationActions'
import {
  createWorldsyntechInboundShipment,
  stableWorldsyntechHash,
  type WorldsyntechCredentials,
} from '../../../../fulfillment/worldsyntech-ofs/client'
import { mapWorldsyntechInboundCreateResult } from '../../../../fulfillment/worldsyntech-ofs/mapping'
import type { InboundShipmentRequest } from '../../../../fulfillment/_types'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const connectionId = String(body.connection_id || '').trim()
  const shipment = body.shipment as InboundShipmentRequest | undefined
  if (!connectionId) throw createError({ statusCode: 400, statusMessage: 'connection_id is required' })
  if (!shipment?.tracking_number || !shipment?.date_estimate || !shipment?.lines?.length) {
    throw createError({ statusCode: 400, statusMessage: 'shipment with tracking_number, date_estimate, and lines is required' })
  }

  const client = getServiceClient()
  const connection = await loadIntegrationConnection(event, client, connectionId, 'worldsyntech-ofs', 'write')
  const credential = integrationCredential(connection)
  if (!credential?.credential_data) throw createError({ statusCode: 400, statusMessage: 'WorldSyntech/OFS connection has no credential' })

  const startedAt = Date.now()
  const executionId = await startIntegrationExecution(client, connection, 'create_inbound_shipment', {
    source: 'worldsyntech_ofs',
    reference_no: shipment.reference_no || shipment.tracking_number,
  })

  try {
    const result = await createWorldsyntechInboundShipment(credential.credential_data as WorldsyntechCredentials, shipment)
    const mapped = mapWorldsyntechInboundCreateResult(Array.isArray(result.data) ? result.data : [])
    for (const externalId of mapped.external_ids || []) {
      await upsertIntegrationEntityMapping(client, {
        workspace_id: connection.workspace_id,
        connection_id: connection.id,
        entity_type: 'inbound_shipment',
        external_id: externalId,
        external_secondary_id: shipment.tracking_number,
        external_data: {
          source: 'worldsyntech_ofs',
          shipment,
          response: result.data,
        },
        remote_hash: stableWorldsyntechHash(result.data),
      })
    }

    await client.from('integration_credentials').update({ credential_data: result.credentials }).eq('id', credential.id)
    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'success',
      outputData: { source: 'worldsyntech_ofs', result: mapped },
      itemsProcessed: shipment.lines.length,
      itemsCreated: mapped.external_ids?.length || 0,
    })

    return { ok: true, connection_id: connection.id, result: mapped }
  } catch (error: any) {
    const message = error?.message || 'WorldSyntech/OFS inbound shipment creation failed'
    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'error',
      outputData: { source: 'worldsyntech_ofs' },
      errorMessage: message,
      itemsFailed: 1,
    })
    throw createError({ statusCode: 502, statusMessage: message })
  }
})
