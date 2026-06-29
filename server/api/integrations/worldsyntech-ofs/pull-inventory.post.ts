import {
  completeIntegrationExecution,
  integrationCredential,
  loadIntegrationConnection,
  startIntegrationExecution,
  upsertIntegrationEntityMapping,
} from '../../../utils/integrationActions'
import {
  fetchWorldsyntechInventoryPage,
  stableWorldsyntechHash,
  type WorldsyntechCredentials,
} from '../../../../fulfillment/worldsyntech-ofs/client'
import { mapWorldsyntechInventory } from '../../../../fulfillment/worldsyntech-ofs/mapping'

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
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

  const config = (connection.config || {}) as Record<string, any>
  const ofsConfig = (config.worldsyntech_ofs || {}) as Record<string, any>
  const reset = body.reset === true
  const offset = reset ? 0 : clampInteger(body.offset ?? ofsConfig.inventory?.next_offset, 0, 0, 1_000_000)
  const limit = clampInteger(body.limit, 250, 1, 250)
  const languageId = clampInteger(body.language_id ?? (credential.credential_data as any).language_id, 1, 1, 10)
  const startedAt = Date.now()
  const executionId = await startIntegrationExecution(client, connection, 'pull_inventory', {
    source: 'worldsyntech_ofs',
    offset,
    limit,
    language_id: languageId,
  })

  try {
    const page = await fetchWorldsyntechInventoryPage(credential.credential_data as WorldsyntechCredentials, {
      offset,
      limit,
      language_id: languageId,
      status: 1,
    })
    const mapped = page.records.map(mapWorldsyntechInventory)
    let stored = 0

    for (const record of mapped) {
      const externalId = record.external_product_id || record.sku
      if (!externalId) continue
      await upsertIntegrationEntityMapping(client, {
        workspace_id: connection.workspace_id,
        connection_id: connection.id,
        entity_type: 'inventory_snapshot',
        local_entity_type: record.sku ? 'sku' : null,
        external_id: externalId,
        external_secondary_id: record.sku || null,
        external_data: {
          source: 'worldsyntech_ofs',
          inventory: record,
        },
        remote_hash: stableWorldsyntechHash(record.raw),
      })
      stored += 1
    }

    const now = new Date().toISOString()
    const nextOffset = page.has_more ? Number.parseInt(page.next_cursor || String(offset + limit), 10) : 0
    await client
      .from('integration_credentials')
      .update({ credential_data: page.credentials })
      .eq('id', credential.id)

    await client
      .from('integration_connections')
      .update({
        status: 'active',
        last_synced_at: now,
        last_error: null,
        total_synced: (connection.total_synced || 0) + stored,
        config: {
          ...config,
          worldsyntech_ofs: {
            ...ofsConfig,
            inventory: {
              last_pulled_at: now,
              offset,
              limit,
              has_more: page.has_more,
              next_offset: nextOffset,
            },
          },
        },
      })
      .eq('id', connection.id)

    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'success',
      outputData: {
        source: 'worldsyntech_ofs',
        fetched: mapped.length,
        stored,
        has_more: page.has_more,
        next_offset: nextOffset,
      },
      itemsProcessed: mapped.length,
      itemsUpdated: stored,
    })

    return {
      ok: true,
      connection_id: connection.id,
      fetched: mapped.length,
      stored,
      has_more: page.has_more,
      next_offset: nextOffset,
      records: mapped.slice(0, 20),
    }
  } catch (error: any) {
    const message = error?.message || 'WorldSyntech/OFS inventory pull failed'
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
