import {
  completeIntegrationExecution,
  integrationCredential,
  loadIntegrationConnection,
  startIntegrationExecution,
} from '../../../../utils/integrationActions'
import { sendOrderToLoft } from '../../../../utils/storeReplenishment'
import type { WorldsyntechCredentials } from '../../../../../fulfillment/worldsyntech-ofs/client'

/**
 * Explicit send of a converted order to Loft/OFS.
 * Requires store_ops:execute_3pl (not mere approve).
 */
export default defineEventHandler(async (event) => {
  const orderId = String(getRouterParam(event, 'id') || '').trim()
  const body = await readBody(event)
  const workspaceId = String(body.workspace_id || '').trim()
  const connectionId = String(body.connection_id || '').trim()
  if (!orderId || !workspaceId || !connectionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'order id, workspace_id, and connection_id are required',
    })
  }
  if (!body.shipping_address?.address || !body.shipping_address?.name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'shipping_address with name and address is required',
    })
  }

  const client = getServiceClient()
  const actor = await requireScope(event, 'store_ops:execute_3pl', {
    workspaceId,
    client,
    accessLevel: 'write',
  })

  if (body.override_expiry) {
    await requireScope(event, 'inventory:override_expiry', {
      workspaceId,
      client,
      accessLevel: 'write',
    })
  }

  const connection = await loadIntegrationConnection(event, client, connectionId, 'worldsyntech-ofs', 'write')
  if (connection.workspace_id !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'Connection workspace mismatch' })
  }
  const credential = integrationCredential(connection)
  if (!credential?.credential_data) {
    throw createError({ statusCode: 400, statusMessage: 'Connection has no credential' })
  }

  // Resolve external product ids from mappings by sku
  const externalProductIdBySku: Record<string, string | number> = body.external_product_id_by_sku || {}
  const { data: orderLines } = await client
    .from('store_replenishment_order_lines')
    .select('sku')
    .eq('order_id', orderId)

  for (const line of orderLines || []) {
    if (!line.sku || externalProductIdBySku[line.sku]) continue
    const { data: mapping } = await client
      .from('integration_entity_mappings')
      .select('external_id, external_secondary_id')
      .eq('connection_id', connectionId)
      .eq('entity_type', 'product')
      .eq('external_secondary_id', line.sku)
      .maybeSingle()
    if (mapping?.external_id) {
      externalProductIdBySku[line.sku] = mapping.external_id
    }
  }

  const startedAt = Date.now()
  const executionId = await startIntegrationExecution(client, connection, 'create_store_replenishment', {
    source: 'store_ops_send',
    order_id: orderId,
  })

  try {
    const result = await sendOrderToLoft(client, {
      workspaceId,
      orderId,
      connectionId,
      credentials: credential.credential_data as WorldsyntechCredentials,
      shippingAddress: body.shipping_address,
      externalProductIdBySku,
      overrideExpiry: Boolean(body.override_expiry),
      overrideExpiryReason: body.override_expiry_reason || null,
      overrideBy: actor.userId || null,
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
      errorMessage: err?.message || 'Send to Loft failed',
      itemsFailed: 1,
    })
    throw createError({ statusCode: 502, statusMessage: err?.message || 'Send to Loft failed' })
  }
})
