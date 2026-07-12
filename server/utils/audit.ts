/**
 * Server-side audit helper (M1). Wraps core/audit/record.mjs for Nitro routes.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
// @ts-expect-error shared mjs module
import { recordAudit as recordAuditCore, mutationEnvelope, defaultNextActions } from '../../core/audit/record.mjs'

export type AuditChannel =
  | 'ui'
  | 'mcp'
  | 'api'
  | 'assistant'
  | 'cron'
  | 'worker'
  | 'import'
  | 'sync'
  | 'app'
  | 'system'
  | 'db_trigger'

export interface RecordAuditArgs {
  workspace_id: string
  entity_type: string
  entity_id: string
  event_type?: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'IMPORT' | 'SYNC' | 'VERIFY' | 'ATTEST'
  channel: AuditChannel
  actor_user_id?: string | null
  actor_kind?: 'user' | 'agent' | 'system' | 'service'
  client_name?: string | null
  tool_name?: string | null
  request_id?: string | null
  source_id?: string | null
  idempotency_key?: string | null
  before_data?: unknown
  after_data?: unknown
  metadata?: Record<string, unknown>
  diff?: Record<string, unknown>
}

export async function recordAudit(
  client: SupabaseClient,
  input: RecordAuditArgs,
  opts?: { strict?: boolean },
) {
  return recordAuditCore(client, input, opts)
}

export { mutationEnvelope, defaultNextActions }

/**
 * Convenience for API-key routes.
 */
export async function recordApiAudit(
  client: SupabaseClient,
  input: Omit<RecordAuditArgs, 'channel' | 'actor_kind'> & {
    api_key_id?: string | null
  },
) {
  return recordAudit(client, {
    ...input,
    channel: 'api',
    actor_kind: 'service',
    source_id: input.api_key_id || input.source_id || null,
    client_name: input.client_name || 'api-key',
  })
}
