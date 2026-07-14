import {
  completeIntegrationExecution,
  integrationCredential,
  loadIntegrationConnection,
  startIntegrationExecution,
  upsertIntegrationEntityMapping,
} from '../../../utils/integrationActions'
import {
  fetchWorldsyntechProductsPage,
  stableWorldsyntechHash,
  type WorldsyntechCredentials,
} from '../../../../fulfillment/worldsyntech-ofs/client'
import { mapWorldsyntechProduct } from '../../../../fulfillment/worldsyntech-ofs/mapping'

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

/**
 * Pull OFS product master into integration_entity_mappings (entity_type=product).
 * Scopes: integrations:execute (+ session admin elevation via loadIntegrationConnection write).
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
    throw createError({ statusCode: 400, statusMessage: 'WorldSyntech/OFS connection has no credential' })
  }

  // Soft scope gate for future API-key workers (session path uses workspace write)
  const config = (connection.config || {}) as Record<string, any>
  const ofsConfig = (config.worldsyntech_ofs || {}) as Record<string, any>
  const reset = body.reset === true
  const offset = reset ? 0 : clampInteger(body.offset ?? ofsConfig.products?.next_offset, 0, 0, 1_000_000)
  const limit = clampInteger(body.limit, 250, 1, 250)
  const languageId = clampInteger(body.language_id ?? (credential.credential_data as any).language_id, 1, 1, 10)
  const startedAt = Date.now()
  const executionId = await startIntegrationExecution(client, connection, 'pull_products', {
    source: 'worldsyntech_ofs',
    offset,
    limit,
    language_id: languageId,
  })

  try {
    const page = await fetchWorldsyntechProductsPage(credential.credential_data as WorldsyntechCredentials, {
      offset,
      limit,
      language_id: languageId,
      status: 1,
    })
    const mapped = page.records.map(mapWorldsyntechProduct)
    let stored = 0
    let unmappedSku = 0

    for (const record of mapped) {
      const externalId = record.external_product_id || record.sku
      if (!externalId) continue

      let localEntityId: string | null = null
      let localEntityType: string | null = null
      if (record.sku) {
        const { data: product } = await client
          .from('products')
          .select('id')
          .eq('workspace_id', connection.workspace_id)
          .eq('sku', record.sku)
          .maybeSingle()
        if (product?.id) {
          localEntityId = product.id
          localEntityType = 'product'
        } else {
          unmappedSku += 1
        }
      }

      await upsertIntegrationEntityMapping(client, {
        workspace_id: connection.workspace_id,
        connection_id: connection.id,
        entity_type: 'product',
        local_entity_type: localEntityType,
        local_entity_id: localEntityId,
        external_id: String(externalId),
        external_secondary_id: record.sku || null,
        external_data: {
          source: 'worldsyntech_ofs',
          product: record,
          mapping_status: localEntityId ? 'matched_sku' : 'unmapped',
        },
        remote_hash: stableWorldsyntechHash(record.raw),
      })
      stored += 1
    }

    const now = new Date().toISOString()
    const nextOffset = page.has_more ? Number.parseInt(page.next_cursor || String(offset + limit), 10) : 0
    await client
      .from('integration_connections')
      .update({
        config: {
          ...config,
          worldsyntech_ofs: {
            ...ofsConfig,
            products: {
              last_pulled_at: now,
              last_offset: offset,
              next_offset: nextOffset,
              has_more: page.has_more,
              last_count: stored,
              unmapped_sku_count: unmappedSku,
            },
          },
        },
        last_sync_at: now,
      })
      .eq('id', connection.id)

    await client
      .from('integration_credentials')
      .update({ credential_data: page.credentials })
      .eq('id', credential.id)

    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'success',
      outputData: {
        source: 'worldsyntech_ofs',
        stored,
        unmapped_sku: unmappedSku,
        has_more: page.has_more,
        next_offset: nextOffset,
      },
      itemsProcessed: mapped.length,
      itemsCreated: stored,
    })

    return {
      ok: true,
      connection_id: connection.id,
      stored,
      unmapped_sku: unmappedSku,
      has_more: page.has_more,
      next_offset: nextOffset,
      records: mapped.slice(0, 25),
    }
  } catch (error: any) {
    const message = error?.message || 'WorldSyntech/OFS product pull failed'
    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'error',
      outputData: { source: 'worldsyntech_ofs' },
      errorMessage: message,
      itemsFailed: 1,
    })
    throw createError({ statusCode: 502, statusMessage: message })
  }
})
