import type { H3Event } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createError } from 'h3'
import { serverSupabaseUser } from '#supabase/server'
import { authenticateApiKey, type ApiKeyContext } from './apiAuth'
import {
  hasScope,
  permissionsMapToScopes,
  type ScopeCheckOptions,
} from './scopes'
import { requireWorkspaceAccess, type WorkspaceAccessLevel } from './workspaceAccess'

export type ActorKind = 'api_key' | 'user_session'

export interface ScopeActorContext {
  kind: ActorKind
  workspaceId: string
  scopes: string[]
  /** API key fields when kind === api_key */
  keyId?: string
  keyName?: string
  /** User id when kind === user_session */
  userId?: string
  role?: string | null
  isWorkspaceAdmin?: boolean
  canWrite?: boolean
}

/**
 * Resolve scopes for a workspace member via get_my_permissions RPC.
 */
export async function resolveScopesForUser(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<{ scopes: string[]; permissions: Record<string, any> }> {
  // RPC uses auth.uid(); service client may not set JWT — fall back to membership schema load
  const { data: rpcData, error: rpcError } = await client.rpc('get_my_permissions', {
    p_workspace_id: workspaceId,
  })

  if (!rpcError && rpcData && typeof rpcData === 'object' && Object.keys(rpcData).length > 0) {
    const permissions = rpcData as Record<string, any>
    return { scopes: [...permissionsMapToScopes(permissions)], permissions }
  }

  const { data: membership } = await client
    .from('workspace_members')
    .select('role, permission_schema_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!membership) {
    return { scopes: [], permissions: {} }
  }

  let schemaId = membership.permission_schema_id as string | null
  if (!schemaId) {
    const { data: defaultSchema } = await client
      .from('permission_schemas')
      .select('id, permissions')
      .is('workspace_id', null)
      .eq('slug', membership.role)
      .eq('is_default', true)
      .maybeSingle()
    if (defaultSchema?.permissions) {
      const permissions = defaultSchema.permissions as Record<string, any>
      return { scopes: [...permissionsMapToScopes(permissions)], permissions }
    }
    return { scopes: [], permissions: {} }
  }

  const { data: schema } = await client
    .from('permission_schemas')
    .select('permissions')
    .eq('id', schemaId)
    .maybeSingle()

  const permissions = (schema?.permissions || {}) as Record<string, any>
  return { scopes: [...permissionsMapToScopes(permissions)], permissions }
}

export function resolveScopesForApiKey(ctx: ApiKeyContext): string[] {
  return Array.isArray(ctx.scopes) ? [...ctx.scopes] : []
}

/**
 * Prefer API key when present; otherwise authenticated user session.
 * Checks required scope(s) against resolved grants.
 */
export async function requireScope(
  event: H3Event,
  required: string | string[],
  options: ScopeCheckOptions & {
    workspaceId?: string
    accessLevel?: WorkspaceAccessLevel
    client?: SupabaseClient
  } = {},
): Promise<ScopeActorContext> {
  const needed = Array.isArray(required) ? required : [required]
  const apiKey = await authenticateApiKey(event)
  if (apiKey) {
    if (options.workspaceId && apiKey.workspaceId !== options.workspaceId) {
      throw createError({ statusCode: 403, statusMessage: 'API key workspace mismatch' })
    }
    for (const scope of needed) {
      if (!hasScope(apiKey.scopes, scope, options)) {
        throw createError({
          statusCode: 403,
          statusMessage: `API key lacks required scope: ${scope}`,
        })
      }
    }
    return {
      kind: 'api_key',
      workspaceId: apiKey.workspaceId,
      scopes: resolveScopesForApiKey(apiKey),
      keyId: apiKey.keyId,
      keyName: apiKey.keyName,
    }
  }

  const client = options.client || getAdminClient()
  const workspaceId = options.workspaceId
  if (!workspaceId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'workspace_id is required when authenticating via session',
    })
  }

  const access = await requireWorkspaceAccess(
    event,
    client,
    workspaceId,
    options.accessLevel || 'member',
  )

  const user = await serverSupabaseUser(event)
  const userId = (user as any)?.id || (user as any)?.sub || access.uid
  const { scopes } = await resolveScopesForUser(client, workspaceId, userId)

  // Workspace admins/owners get elevated scopes for ops until schemas fully enforced everywhere
  const elevated = new Set(scopes)
  if (access.isWorkspaceAdmin) {
    for (const s of [
      // store ops full surface (read/write required for page loads + create request)
      'store_ops:read',
      'store_ops:write',
      'store_ops:approve',
      'store_ops:verify',
      'store_ops:execute_3pl',
      'store_ops:inbound',
      // inventory / locations
      'inventory:read',
      'inventory:write',
      'inventory:override_expiry',
      'locations:read',
      'locations:write',
      'products:read',
      // integrations
      'integrations:execute',
      'integrations:read',
      'integrations:write',
      'credentials:write',
      'apps:install',
      'apps:read',
      'pos:read',
      'pos:write',
      'pos:config',
      // agentic reports (track K)
      'reports:read',
      'reports:run',
      'reports:write',
      'reports:admin',
      'automations:webhook',
    ]) {
      elevated.add(s)
    }
  }
  // Members with write access at least get store-ops read when they have any inventory/store write
  if (access.canWrite && !access.isWorkspaceAdmin) {
    if (elevated.has('inventory:write') || elevated.has('store_ops:write') || elevated.has('store_ops:approve')) {
      elevated.add('store_ops:read')
      elevated.add('inventory:read')
    }
  }

  const granted = [...elevated]
  for (const scope of needed) {
    if (!hasScope(granted, scope, { emptyMeansFull: false })) {
      throw createError({
        statusCode: 403,
        statusMessage: `Missing required scope: ${scope}`,
      })
    }
  }

  return {
    kind: 'user_session',
    workspaceId,
    scopes: granted,
    userId,
    role: access.role,
    isWorkspaceAdmin: access.isWorkspaceAdmin,
    canWrite: access.canWrite,
  }
}

/**
 * API-key-only scope check (existing POS / headless routes).
 */
export async function requireApiKeyScope(
  event: H3Event,
  required?: string | string[],
  options: ScopeCheckOptions = {},
): Promise<ApiKeyContext> {
  const ctx = await authenticateApiKey(event)
  if (!ctx) {
    throw createError({
      statusCode: 401,
      statusMessage: 'API key required. Pass via Authorization: Bearer <key> or X-API-Key header.',
    })
  }
  if (required) {
    const needed = Array.isArray(required) ? required : [required]
    for (const scope of needed) {
      if (!hasScope(ctx.scopes, scope, options)) {
        throw createError({ statusCode: 403, statusMessage: `API key lacks required scope: ${scope}` })
      }
    }
  }
  return ctx
}
