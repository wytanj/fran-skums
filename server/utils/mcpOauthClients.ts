/**
 * Client-registry lookups for the MCP OAuth connector.
 *
 * Split out of mcpOauth.ts for one reason: that module transitively imports
 * `#supabase/server`, which plain Node cannot resolve, so the only way to check
 * these queries was a regex against the source. Here they take an injected `db`
 * and nothing else, so "two workspaces' clients both resolve" is a test that
 * actually runs.
 *
 * Two finders, deliberately distinct:
 *  - findMcpOauthClientById — authenticating a specific client (token, authorize)
 *  - findAnyMcpOauthClient  — the boolean "is OAuth switched on at all"
 *
 * Collapsing those two into one function is what caused a live bug: a
 * newest-row-wins lookup meant generating credentials for a second workspace
 * silently stopped the first workspace's connector from being recognised.
 *
 * @see server/utils/mcpOauth.ts
 * @see tests/mcp-oauth-clients.test.mjs
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const TABLE = 'mcp_oauth_clients'
const COLUMNS = 'id, client_id, client_secret_hash'

export type McpOauthClientRow = {
  id: string
  clientId: string
  /** Null = public client, no secret required. */
  clientSecretHash: string | null
}

function toRow(raw: any): McpOauthClientRow | null {
  if (!raw) return null
  return {
    id: String(raw.id),
    clientId: String(raw.client_id),
    clientSecretHash: (raw.client_secret_hash as string) || null,
  }
}

/**
 * Resolve the client that a request claims to be.
 *
 * This is the correct OAuth semantic — client_id *is* the identifier — and it is
 * what lets a demo workspace and a production workspace hold separate
 * credentials against the same connector URL. Returns null for unknown and for
 * revoked, so the caller answers both with `invalid_client` and leaks nothing
 * about which of the two it was.
 */
export async function findMcpOauthClientById(
  db: SupabaseClient,
  clientId: string | null | undefined,
): Promise<McpOauthClientRow | null> {
  const id = String(clientId || '').trim()
  if (!id) return null

  const { data } = await db
    .from(TABLE)
    .select(COLUMNS)
    .eq('client_id', id)
    .is('revoked_at', null)
    .limit(1)

  return toRow(data?.[0])
}

/**
 * Any live client, newest first.
 *
 * Only for "is OAuth configured on this deployment" — the discovery 404 gate and
 * the /mcp 401 gate. Never use this to authenticate: with more than one
 * workspace registered it returns an arbitrary one.
 */
export async function findAnyMcpOauthClient(
  db: SupabaseClient,
): Promise<McpOauthClientRow | null> {
  const { data } = await db
    .from(TABLE)
    .select(COLUMNS)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)

  return toRow(data?.[0])
}
