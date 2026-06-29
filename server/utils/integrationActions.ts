import type { SupabaseClient } from '@supabase/supabase-js'
import type { H3Event } from 'h3'
import { createError } from 'h3'
import { requireWorkspaceAccess, type WorkspaceAccessLevel } from './workspaceAccess'

export function integrationNodeSlug(record: any): string | null {
  const node = record?.node_definition
  if (Array.isArray(node)) return node[0]?.slug || null
  return node?.slug || null
}

export function integrationCredential(record: any): any | null {
  const credential = record?.credential
  if (Array.isArray(credential)) return credential[0] || null
  return credential || null
}

export async function loadIntegrationCredential(
  event: H3Event,
  client: SupabaseClient,
  credentialId: string,
  expectedSlug: string,
  accessLevel: WorkspaceAccessLevel = 'write',
) {
  const { data: credential, error } = await client
    .from('integration_credentials')
    .select('id, workspace_id, node_def_id, credential_data, node_definition:integration_node_definitions(slug, name)')
    .eq('id', credentialId)
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!credential) throw createError({ statusCode: 404, statusMessage: 'Credential not found' })

  await requireWorkspaceAccess(event, client, credential.workspace_id, accessLevel)

  if (integrationNodeSlug(credential) !== expectedSlug) {
    throw createError({ statusCode: 400, statusMessage: `Credential is not for ${expectedSlug}` })
  }

  return credential
}

export async function loadIntegrationConnection(
  event: H3Event,
  client: SupabaseClient,
  connectionId: string,
  expectedSlug: string,
  accessLevel: WorkspaceAccessLevel = 'write',
) {
  const { data: connection, error } = await client
    .from('integration_connections')
    .select(`
      id,
      workspace_id,
      node_def_id,
      credential_id,
      name,
      status,
      config,
      total_synced,
      total_errors,
      node_definition:integration_node_definitions(slug, name),
      credential:integration_credentials(id, credential_data, is_valid)
    `)
    .eq('id', connectionId)
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!connection) throw createError({ statusCode: 404, statusMessage: 'Connection not found' })

  await requireWorkspaceAccess(event, client, connection.workspace_id, accessLevel)

  if (integrationNodeSlug(connection) !== expectedSlug) {
    throw createError({ statusCode: 400, statusMessage: `Connection is not for ${expectedSlug}` })
  }

  return connection
}

export async function startIntegrationExecution(
  client: SupabaseClient,
  connection: { id: string; workspace_id: string },
  actionKey: string,
  inputData: Record<string, unknown> = {},
): Promise<string | null> {
  const { data } = await client
    .from('integration_executions')
    .insert({
      connection_id: connection.id,
      workspace_id: connection.workspace_id,
      execution_type: 'action',
      action_key: actionKey,
      input_data: inputData,
    })
    .select('id')
    .single()

  return data?.id || null
}

export async function completeIntegrationExecution(
  client: SupabaseClient,
  executionId: string | null,
  startedAt: number,
  result: {
    status: 'success' | 'error' | 'cancelled' | 'timeout'
    outputData?: Record<string, unknown>
    errorMessage?: string
    itemsProcessed?: number
    itemsCreated?: number
    itemsUpdated?: number
    itemsFailed?: number
  },
) {
  if (!executionId) return
  await client
    .from('integration_executions')
    .update({
      status: result.status,
      output_data: result.outputData || {},
      error_message: result.errorMessage || null,
      items_processed: result.itemsProcessed || 0,
      items_created: result.itemsCreated || 0,
      items_updated: result.itemsUpdated || 0,
      items_failed: result.itemsFailed || 0,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    })
    .eq('id', executionId)
}

export async function upsertIntegrationEntityMapping(
  client: SupabaseClient,
  row: {
    workspace_id: string
    connection_id: string
    entity_type: string
    local_entity_type?: string | null
    local_entity_id?: string | null
    external_id: string
    external_secondary_id?: string | null
    external_data?: Record<string, unknown>
    remote_hash?: string | null
  },
) {
  const payload = {
    ...row,
    external_data: row.external_data || {},
    last_synced_at: new Date().toISOString(),
  }

  const { data: existing, error: existingError } = await client
    .from('integration_entity_mappings')
    .select('id')
    .eq('connection_id', row.connection_id)
    .eq('entity_type', row.entity_type)
    .eq('external_id', row.external_id)
    .maybeSingle()

  if (existingError) throw existingError

  if (existing?.id) {
    const { error } = await client
      .from('integration_entity_mappings')
      .update(payload)
      .eq('id', existing.id)
    if (error) throw error
    return existing.id
  }

  const { data, error } = await client
    .from('integration_entity_mappings')
    .insert(payload)
    .select('id')
    .single()

  if (error) throw error
  return data.id
}
