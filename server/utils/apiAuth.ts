import { createHash, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'

export interface ApiKeyContext {
  workspaceId: string
  keyId: string
  keyName: string
  /** Effective scopes (key ∩ bound user ∩ ceilings) */
  scopes: string[]
  boundUserId?: string | null
  boundUserRole?: string | null
  keyKind?: string | null
  maxPackage?: string | null
  /** Raw scopes stored on the key row before effective resolution */
  rawScopes?: string[]
}

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `sk_live_${randomBytes(32).toString('base64url')}`
  const hash = hashKey(raw)
  const prefix = raw.substring(0, 12)
  return { raw, hash, prefix }
}

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Extracts and validates an API key from the request.
 * Looks in: Authorization: Bearer <key>, X-API-Key header, or ?api_key query param.
 * Returns the workspace context if valid, or null.
 */
export async function authenticateApiKey(event: H3Event): Promise<ApiKeyContext | null> {
  const headers = getHeaders(event)
  const query = getQuery(event)

  let rawKey: string | undefined

  // Path/query inject from MCP handler (most reliable for Claude URL keys)
  const ctxKey = (event.context as any)?.mcpApiKey
  if (typeof ctxKey === 'string' && ctxKey.trim()) {
    rawKey = ctxKey.trim()
  }

  if (!rawKey) {
    const authHeader = headers.authorization || headers.Authorization
    const bearerMatch = typeof authHeader === 'string' ? authHeader.match(/^Bearer\s+(.+)$/i) : null
    if (bearerMatch) {
      rawKey = bearerMatch[1].trim()
    }
  }

  if (!rawKey) {
    const headerKey = headers['x-api-key'] || headers['X-API-Key']
    rawKey = typeof headerKey === 'string' ? headerKey.trim() : undefined
  }

  // Query / URL-embedded keys (Claude personal connector has no Bearer field —
  // users paste https://…/mcp?api_key=sk_live_… or /mcp/c/sk_live_… or ?api=)
  if (!rawKey) {
    const q =
      query.api_key
      || query.api
      || query.key
      || query.access_token
      || query.token
      || query.authorization
    if (q) rawKey = String(q).replace(/^Bearer\s+/i, '').trim()
  }

  if (!rawKey) return null

  // Strip accidental brackets / whitespace from pasted keys: [sk_live_…]
  rawKey = rawKey.replace(/^\[|\]$/g, '').replace(/\s+/g, '').trim()
  if (!rawKey) return null

  const hash = hashKey(rawKey)
  const client = getAdminClient()

  const { data, error } = await client
    .from('api_keys')
    .select(
      'id, workspace_id, name, scopes, is_active, expires_at, total_requests, created_by, bound_user_id, key_kind, max_package, revoked_at',
    )
    .eq('key_hash', hash)
    .single()

  if (error || !data) return null
  if (!data.is_active) return null
  if (data.revoked_at) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null

  // A2: effective scopes = key ∩ bound user web power (cloud ceiling applied in MCP layer)
  const { resolveEffectiveScopesForApiKey } = await import('./effectiveScopes')
  const effective = await resolveEffectiveScopesForApiKey(client, data as any, { cloud: false })
  if (effective.deniedReason === 'bound_user_not_a_member') return null
  if (effective.deniedReason === 'key_revoked_or_inactive') return null

  // Update usage stats (fire and forget)
  client
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString(), total_requests: data.total_requests + 1 })
    .eq('id', data.id)
    .then(() => {})

  return {
    workspaceId: data.workspace_id,
    keyId: data.id,
    keyName: data.name,
    scopes: effective.scopes,
    rawScopes: data.scopes || [],
    boundUserId: effective.boundUserId,
    boundUserRole: effective.boundUserRole,
    keyKind: data.key_kind || 'general',
    maxPackage: data.max_package || null,
  }
}

/**
 * Checks if the API key has a given scope.
 * Phase P: empty scopes[] means **no** access (not full). Use explicit packages
 * (pos_connector, mcp:ops_safe, …) or ['*'] for unrestricted service keys.
 * @see server/utils/scopes.ts
 */
export function hasScope(ctx: ApiKeyContext, scope: string): boolean {
  if (ctx.scopes.length === 0) return false
  if (ctx.scopes.includes('*') || ctx.scopes.includes('full')) return true
  return ctx.scopes.includes(scope)
}

/**
 * Require API key auth. Throws 401 if not present, 403 if scope denied.
 * Prefer requireApiKeyScope / requireScope from scopeAuth for multi-scope checks.
 */
export async function requireApiKey(event: H3Event, requiredScope?: string): Promise<ApiKeyContext> {
  const ctx = await authenticateApiKey(event)
  if (!ctx) {
    throw createError({ statusCode: 401, statusMessage: 'API key required. Pass via Authorization: Bearer <key> or X-API-Key header.' })
  }
  if (requiredScope && !hasScope(ctx, requiredScope)) {
    throw createError({ statusCode: 403, statusMessage: `API key lacks required scope: ${requiredScope}` })
  }
  return ctx
}
