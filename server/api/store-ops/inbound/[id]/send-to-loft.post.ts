import {
  completeIntegrationExecution,
  integrationCredential,
  loadIntegrationConnection,
  startIntegrationExecution,
} from '../../../../utils/integrationActions'
import { sendInboundToLoft } from '../../../../utils/inboundShipment'
import type { WorldsyntechCredentials } from '../../../../../fulfillment/worldsyntech-ofs/client'

/**
 * Send ASN draft to WorldSyntech ship_to_warehouse/create.
 * Scopes: store_ops:inbound + execute_3pl family
 */
export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '').trim()
  const body = await readBody(event)
  const workspaceId = String(body.workspace_id || '').trim()
  const connectionId = String(body.connection_id || '').trim()
  if (!id || !workspaceId || !connectionId) {
    throw createError({ statusCode: 400, statusMessage: 'id, workspace_id, connection_id required' })
  }

  const client = getServiceClient()
  try {
    await requireScope(event, 'store_ops:inbound', { workspaceId, client, accessLevel: 'write' })
  } catch {
    await requireScope(event, 'store_ops:execute_3pl', { workspaceId, client, accessLevel: 'write' })
  }

  const connection = await loadIntegrationConnection(event, client, connectionId, 'worldsyntech-ofs', 'write')
  if (connection.workspace_id !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'Connection workspace mismatch' })
  }
  const credential = integrationCredential(connection)
  if (!credential?.credential_data) {
    throw createError({ statusCode: 400, statusMessage: 'Connection has no credential' })
  }

  const startedAt = Date.now()
  const executionId = await startIntegrationExecution(client, connection, 'create_inbound_shipment', {
    source: 'inbound_send',
    shipment_id: id,
  })

  try {
    const result = await sendInboundToLoft(client, {
      workspaceId,
      shipmentId: id,
      connectionId,
      credentials: credential.credential_data as WorldsyntechCredentials,
    })

    if (result.credentials) {
      await client
        .from('integration_credentials')
        .update({ credential_data: result.credentials })
        .eq('id', credential.id)
    }

    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'success',
      outputData: { source: 'worldsyntech_ofs', result: result.result },
      itemsProcessed: 1,
      itemsCreated: result.result.external_ids?.length || 0,
    })

    return { ok: true, ...result }
  } catch (err: any) {
    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'error',
      outputData: { source: 'worldsyntech_ofs' },
      errorMessage: err?.message || 'Send ASN failed',
      itemsFailed: 1,
    })
    throw createError({
      statusCode: err?.statusCode || 502,
      statusMessage: err?.message || 'Send ASN to Loft failed',
    })
  }
})
