import { createHash, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'

export interface ApiKeyContext {
  workspaceId: string
  keyId: string
  keyName: string
  scopes: string[]
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

  const authHeader = headers.authorization || headers.Authorization
  const bearerMatch = typeof authHeader === 'string' ? authHeader.match(/^Bearer\s+(.+)$/i) : null
  if (bearerMatch) {
    rawKey = bearerMatch[1].trim()
  }

  if (!rawKey) {
    const headerKey = headers['x-api-key'] || headers['X-API-Key']
    rawKey = typeof headerKey === 'string' ? headerKey.trim() : undefined
  }

  if (!rawKey && query.api_key) {
    rawKey = String(query.api_key).trim()
  }

  if (!rawKey) return null

  const hash = hashKey(rawKey)
  const client = getAdminClient()

  const { data, error } = await client
    .from('api_keys')
    .select('id, workspace_id, name, scopes, is_active, expires_at, total_requests')
    .eq('key_hash', hash)
    .single()

  if (error || !data) return null
  if (!data.is_active) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null

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
    scopes: data.scopes || [],
  }
}

/**
 * Checks if the API key has a given scope.
 * Empty scopes array means "all scopes" (full access).
 */
export function hasScope(ctx: ApiKeyContext, scope: string): boolean {
  if (ctx.scopes.length === 0) return true
  return ctx.scopes.includes(scope)
}

/**
 * Require API key auth. Throws 401 if not present, 403 if scope denied.
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
