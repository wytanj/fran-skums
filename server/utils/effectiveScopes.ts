/**
 * A2 — Effective scopes: key ∩ bound user web power ∩ cloud ceiling.
 * @see docs/MCP_USER_PERMISSION_DESIGN.md
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applyCloudMcpCeiling,
  bridgeWebScopesToMcp,
  computeEffectiveScopes,
  defaultMcpPackageForRole,
  expandKeyScopes,
  expandScopePackage,
  type ScopeCheckOptions,
} from './scopes'
import { resolveScopesForUser } from './scopeAuth'

export interface ApiKeyRowForScopes {
  id: string
  workspace_id: string
  name: string
  scopes: string[] | null
  is_active?: boolean
  expires_at?: string | null
  created_by?: string | null
  bound_user_id?: string | null
  key_kind?: string | null
  max_package?: string | null
  revoked_at?: string | null
}

export interface EffectiveKeyScopesResult {
  scopes: string[]
  keyScopesExpanded: string[]
  userWebScopes: string[]
  boundUserId: string | null
  boundUserRole: string | null
  maxPackage: string | null
  cloud: boolean
  deniedReason?: string
}

/**
 * Resolve effective scopes for an API key row (service client).
 */
export async function resolveEffectiveScopesForApiKey(
  client: SupabaseClient,
  key: ApiKeyRowForScopes,
  opts: { cloud?: boolean } = {},
): Promise<EffectiveKeyScopesResult> {
  const cloud = opts.cloud === true

  if (key.revoked_at || key.is_active === false) {
    return {
      scopes: [],
      keyScopesExpanded: [],
      userWebScopes: [],
      boundUserId: null,
      boundUserRole: null,
      maxPackage: key.max_package || null,
      cloud,
      deniedReason: 'key_revoked_or_inactive',
    }
  }

  const boundUserId = key.bound_user_id || key.created_by || null
  let userWebScopes: string[] = []
  let boundUserRole: string | null = null

  if (boundUserId) {
    const { data: membership } = await client
      .from('workspace_members')
      .select('role, permission_schema_id')
      .eq('workspace_id', key.workspace_id)
      .eq('user_id', boundUserId)
      .maybeSingle()

    if (!membership) {
      // Also allow workspace owner without membership row
      const { data: ws } = await client
        .from('workspaces')
        .select('owner_id')
        .eq('id', key.workspace_id)
        .maybeSingle()
      if (ws?.owner_id === boundUserId) {
        boundUserRole = 'owner'
        // Owner: treat as full web power for cap (bridge will expand)
        userWebScopes = [
          'products:read',
          'products:write',
          'brands:read',
          'categories:read',
          'inventory:read',
          'inventory:write',
          'store_ops:read',
          'store_ops:write',
          'store_ops:approve',
          'store_ops:verify',
          'store_ops:execute_3pl',
          'actions:read',
          'actions:write',
          'actions:submit',
          'actions:approve',
          'intel:read',
          'intel:write',
          'api:read',
          'api:write',
          'forecasting:read',
          'forecasting:write',
          'pos:read',
          'pos:write',
        ]
      } else {
        return {
          scopes: [],
          keyScopesExpanded: expandKeyScopes(key.scopes),
          userWebScopes: [],
          boundUserId,
          boundUserRole: null,
          maxPackage: key.max_package || null,
          cloud,
          deniedReason: 'bound_user_not_a_member',
        }
      }
    } else {
      boundUserRole = membership.role
      const resolved = await resolveScopesForUser(client, key.workspace_id, boundUserId)
      userWebScopes = resolved.scopes
      // Elevate owner/admin like scopeAuth.requireScope (web parity)
      if (membership.role === 'owner' || membership.role === 'admin') {
        for (const s of [
          'store_ops:read',
          'store_ops:write',
          'store_ops:approve',
          'store_ops:verify',
          'store_ops:execute_3pl',
          'store_ops:inbound',
          'inventory:read',
          'inventory:write',
          'products:read',
          'products:write',
          'actions:read',
          'actions:write',
          'actions:submit',
          'actions:approve',
          'intel:read',
          'intel:write',
          'api:read',
          'api:write',
          'pos:read',
          'pos:write',
          'forecasting:read',
          'forecasting:write',
        ]) {
          if (!userWebScopes.includes(s)) userWebScopes.push(s)
        }
      }
    }
  } else {
    // Unbound key: no user cap (legacy) — still apply cloud ceiling for MCP
    userWebScopes = ['*']
  }

  const scopes = computeEffectiveScopes({
    keyScopes: key.scopes || [],
    maxPackage: key.max_package,
    userWebScopes,
    cloud,
    keyKind: key.key_kind,
  })

  return {
    scopes,
    keyScopesExpanded: expandKeyScopes(key.scopes),
    userWebScopes: userWebScopes.includes('*') ? ['*'] : userWebScopes,
    boundUserId,
    boundUserRole,
    maxPackage: key.max_package || null,
    cloud,
  }
}

/**
 * Session user effective scopes for Catalog AI (no key).
 */
export async function resolveEffectiveScopesForSession(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<{ scopes: string[]; role: string | null }> {
  const { data: membership } = await client
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()

  const { data: ws } = await client
    .from('workspaces')
    .select('owner_id')
    .eq('id', workspaceId)
    .maybeSingle()

  const role =
    membership?.role ||
    (ws?.owner_id === userId ? 'owner' : null)

  const resolved = await resolveScopesForUser(client, workspaceId, userId)
  let scopes = [...resolved.scopes]
  if (role === 'owner' || role === 'admin') {
    for (const s of bridgeWebScopesToMcp([
      'products:read',
      'products:write',
      'inventory:read',
      'inventory:write',
      'store_ops:read',
      'store_ops:write',
      'store_ops:approve',
      'actions:read',
      'actions:write',
      'actions:submit',
      'actions:approve',
      'intel:read',
      'api:read',
      'api:write',
      'forecasting:read',
    ])) {
      if (!scopes.includes(s)) scopes.push(s)
    }
  }
  return { scopes, role }
}

/**
 * Cap requested key scopes by creator's web power when creating a key.
 */
export function capScopesByCreator(
  requested: string[],
  creatorWebScopes: string[],
  opts: { cloudPackage?: boolean } = {},
): string[] {
  let expanded = expandKeyScopes(requested)
  if (!expanded.length && opts.cloudPackage) {
    expanded = expandScopePackage('mcp:safe')
  }
  const creatorMcp = bridgeWebScopesToMcp(creatorWebScopes)
  let capped =
    creatorWebScopes.includes('*') || creatorMcp.includes('*')
      ? expanded
      : expanded.filter((s) => creatorMcp.includes(s) || creatorWebScopes.includes(s))
  if (opts.cloudPackage) {
    capped = applyCloudMcpCeiling(capped)
  }
  return capped
}

export { defaultMcpPackageForRole, applyCloudMcpCeiling, expandScopePackage }
