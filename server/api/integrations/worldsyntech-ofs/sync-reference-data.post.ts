import {
  completeIntegrationExecution,
  integrationCredential,
  loadIntegrationConnection,
  startIntegrationExecution,
  upsertIntegrationEntityMapping,
} from '../../../utils/integrationActions'
import {
  fetchWorldsyntechReferenceData,
  stableWorldsyntechHash,
  type WorldsyntechCredentials,
} from '../../../../fulfillment/worldsyntech-ofs/client'

function externalId(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (value !== null && value !== undefined && String(value).trim()) return String(value)
  }
  return null
}

async function storeReferenceRows(client: any, connection: any, entityType: string, rows: Record<string, unknown>[], keys: string[]) {
  let stored = 0
  for (const row of rows) {
    const id = externalId(row, keys)
    if (!id) continue
    await upsertIntegrationEntityMapping(client, {
      workspace_id: connection.workspace_id,
      connection_id: connection.id,
      entity_type: entityType,
      external_id: id,
      external_data: {
        source: 'worldsyntech_ofs',
        [entityType]: row,
      },
      remote_hash: stableWorldsyntechHash(row),
    })
    stored += 1
  }
  return stored
}

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
    throw createError({ statusCode: 400, statusMessage: 'WorldSyntech/OFS connection has no credential' })
  }

  const maxPages = Math.min(Math.max(Number.parseInt(String(body.max_pages || 5), 10) || 5, 1), 25)
  const startedAt = Date.now()
  const executionId = await startIntegrationExecution(client, connection, 'sync_reference_data', {
    source: 'worldsyntech_ofs',
    max_pages: maxPages,
  })

  try {
    const result = await fetchWorldsyntechReferenceData(credential.credential_data as WorldsyntechCredentials, { maxPages })
    const data = result.data
    const counts = {
      addresses: await storeReferenceRows(client, connection, 'address', data.addresses, ['address_id', 'id']),
      countries: await storeReferenceRows(client, connection, 'country', data.countries, ['country_id', 'id']),
      zones: await storeReferenceRows(client, connection, 'zone', data.zones, ['zone_id', 'id']),
      delivery_methods: await storeReferenceRows(client, connection, 'delivery_method', data.delivery_methods, ['delivery_method_id', 'id']),
    }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
    const now = new Date().toISOString()

    await client
      .from('integration_credentials')
      .update({ credential_data: result.credentials })
      .eq('id', credential.id)

    await client
      .from('integration_connections')
      .update({
        status: 'active',
        last_synced_at: now,
        last_error: null,
        config: {
          ...(connection.config || {}),
          worldsyntech_ofs: {
            ...((connection.config || {}).worldsyntech_ofs || {}),
            reference_data: {
              last_synced_at: now,
              counts,
            },
          },
        },
      })
      .eq('id', connection.id)

    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'success',
      outputData: { source: 'worldsyntech_ofs', counts },
      itemsProcessed: total,
      itemsUpdated: total,
    })

    return { ok: true, connection_id: connection.id, counts }
  } catch (error: any) {
    const message = error?.message || 'WorldSyntech/OFS reference sync failed'
    await client
      .from('integration_connections')
      .update({
        status: 'error',
        last_error: message,
        total_errors: (connection.total_errors || 0) + 1,
      })
      .eq('id', connection.id)

    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'error',
      outputData: { source: 'worldsyntech_ofs' },
      errorMessage: message,
      itemsFailed: 1,
    })

    throw createError({ statusCode: 502, statusMessage: message })
  }
})
