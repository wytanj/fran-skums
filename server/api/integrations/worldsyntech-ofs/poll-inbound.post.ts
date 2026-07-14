import {
  completeIntegrationExecution,
  integrationCredential,
  loadIntegrationConnection,
  startIntegrationExecution,
} from '../../../utils/integrationActions'
import { pollInboundFromLoft } from '../../../utils/inboundShipment'
import type { WorldsyntechCredentials } from '../../../../fulfillment/worldsyntech-ofs/client'

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

  const startedAt = Date.now()
  const executionId = await startIntegrationExecution(client, connection, 'poll_inbound_shipments', {
    source: 'worldsyntech_ofs',
    offset: body.offset,
    limit: body.limit,
  })

  try {
    const result = await pollInboundFromLoft(client, {
      workspaceId: connection.workspace_id,
      connectionId: connection.id,
      credentials: credential.credential_data as WorldsyntechCredentials,
      offset: Number(body.offset) || 0,
      limit: Number(body.limit) || 50,
    })

    if (result.credentials) {
      await client
        .from('integration_credentials')
        .update({ credential_data: result.credentials })
        .eq('id', credential.id)
    }

    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'success',
      outputData: {
        source: 'worldsyntech_ofs',
        remote_count: result.remote_count,
        updated: result.updated,
      },
      itemsProcessed: result.remote_count,
      itemsCreated: result.updated,
    })

    return { ok: true, ...result }
  } catch (error: any) {
    const message = error?.message || 'Poll inbound failed'
    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'error',
      outputData: { source: 'worldsyntech_ofs' },
      errorMessage: message,
      itemsFailed: 1,
    })
    throw createError({ statusCode: 502, statusMessage: message })
  }
})
