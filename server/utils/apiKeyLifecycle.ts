/**
 * A2.4 — API key lifecycle when members change role or leave.
 * Recap scopes to new role package, or soft-revoke when empty / removed.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAudit } from './audit'
import {
  applyCloudMcpCeiling,
  defaultMcpPackageForRole,
  expandScopePackage,
} from './scopes'

export type LifecycleReason =
  | 'member_removed'
  | 'role_changed'
  | 'manual_revoke'
  | 'key_created'

function softRevokePatch(actorUserId: string | null) {
  const now = new Date().toISOString()
  return {
    is_active: false,
    revoked_at: now,
    revoked_by: actorUserId,
    updated_at: now,
  }
}

/**
 * Soft-revoke all active keys bound to (or created by, if unbound) a user.
 */
export async function revokeBoundApiKeys(
  client: SupabaseClient,
  opts: {
    workspaceId: string
    userId: string
    actorUserId?: string | null
    reason: LifecycleReason
    metadata?: Record<string, unknown>
  },
): Promise<{ revoked: string[]; count: number }> {
  const { data: keys, error } = await client
    .from('api_keys')
    .select('id, name, scopes, key_kind, bound_user_id, created_by, is_active, revoked_at')
    .eq('workspace_id', opts.workspaceId)
    .eq('is_active', true)
    .is('revoked_at', null)

  if (error) throw new Error(error.message)

  const targets = (keys || []).filter((k) => {
    if (k.bound_user_id === opts.userId) return true
    // Legacy keys with no bind: treat created_by as owner of the key
    if (!k.bound_user_id && k.created_by === opts.userId) return true
    return false
  })

  const revoked: string[] = []
  for (const key of targets) {
    const patch = softRevokePatch(opts.actorUserId || null)
    let { error: upErr } = await client.from('api_keys').update(patch).eq('id', key.id)
    if (upErr && /revoked_at|revoked_by|column/i.test(upErr.message)) {
      const retry = await client
        .from('api_keys')
        .update({ is_active: false, updated_at: patch.updated_at })
        .eq('id', key.id)
      upErr = retry.error
    }
    if (upErr) {
      console.error('[apiKeyLifecycle] revoke failed', key.id, upErr.message)
      continue
    }
    revoked.push(key.id)
    await recordAudit(client, {
      workspace_id: opts.workspaceId,
      entity_type: 'api_key',
      entity_id: key.id,
      event_type: 'api_key.revoked',
      operation: 'UPDATE',
      channel: 'ui',
      actor_user_id: opts.actorUserId || null,
      actor_kind: 'user',
      before_data: { is_active: true, name: key.name, scopes: key.scopes },
      after_data: { is_active: false, revoked: true },
      metadata: {
        reason: opts.reason,
        bound_user_id: opts.userId,
        key_name: key.name,
        ...(opts.metadata || {}),
      },
    })
  }

  return { revoked, count: revoked.length }
}

/**
 * After role change: shrink key packages to match new role; revoke if nothing left.
 * Does not elevate keys when promoting (admin already has ops_safe capability via re-auth).
 */
export async function recapBoundApiKeys(
  client: SupabaseClient,
  opts: {
    workspaceId: string
    userId: string
    newRole: string
    previousRole?: string | null
    actorUserId?: string | null
  },
): Promise<{ recapped: string[]; revoked: string[] }> {
  const pkg = defaultMcpPackageForRole(opts.newRole)
  let newScopes = expandScopePackage(pkg)
  // MCP connector keys always under cloud-safe ceiling when stored
  newScopes = applyCloudMcpCeiling(newScopes)

  const { data: keys, error } = await client
    .from('api_keys')
    .select('id, name, scopes, key_kind, max_package, bound_user_id, created_by, is_active, revoked_at')
    .eq('workspace_id', opts.workspaceId)
    .eq('is_active', true)
    .is('revoked_at', null)

  if (error) throw new Error(error.message)

  const targets = (keys || []).filter((k) => {
    if (k.bound_user_id === opts.userId) return true
    if (!k.bound_user_id && k.created_by === opts.userId) return true
    return false
  })

  const recapped: string[] = []
  const revoked: string[] = []

  for (const key of targets) {
    const isMcp =
      key.key_kind === 'mcp_connector' ||
      key.key_kind === 'mcp' ||
      (Array.isArray(key.scopes) && key.scopes.some((s: string) => String(s).startsWith('mcp:')))

    // Demote to viewer with no write: revoke POS write keys / empty scope keys
    if (!newScopes.length || (opts.newRole === 'viewer' && isMcp && !newScopes.includes('store_ops:write'))) {
      // viewer mcp package still has reads — keep with viewer package
    }

    if (!newScopes.length) {
      const patch = softRevokePatch(opts.actorUserId || null)
      await client.from('api_keys').update(patch).eq('id', key.id)
      revoked.push(key.id)
      await recordAudit(client, {
        workspace_id: opts.workspaceId,
        entity_type: 'api_key',
        entity_id: key.id,
        event_type: 'api_key.revoked',
        operation: 'UPDATE',
        channel: 'ui',
        actor_user_id: opts.actorUserId || null,
        before_data: { scopes: key.scopes, max_package: key.max_package },
        after_data: { is_active: false },
        metadata: {
          reason: 'role_changed',
          previous_role: opts.previousRole,
          new_role: opts.newRole,
          key_name: key.name,
        },
      })
      continue
    }

    // Intersect existing key scopes with new role package (never expand beyond new role)
    const existing = Array.isArray(key.scopes) ? key.scopes.map(String) : []
    const existingExpanded = existing.length
      ? [...new Set(existing.flatMap((s) => expandScopePackage(s)))]
      : newScopes
    const capped = existingExpanded.filter((s) => newScopes.includes(s))
    const finalScopes = capped.length ? applyCloudMcpCeiling(capped) : newScopes

    const update: Record<string, unknown> = {
      scopes: finalScopes,
      max_package: isMcp ? pkg : key.max_package,
      updated_at: new Date().toISOString(),
    }
    // Bind if missing
    if (!key.bound_user_id) update.bound_user_id = opts.userId

    let { error: upErr } = await client.from('api_keys').update(update).eq('id', key.id)
    if (upErr && /bound_user|max_package|column/i.test(upErr.message)) {
      const retry = await client
        .from('api_keys')
        .update({ scopes: finalScopes, updated_at: update.updated_at })
        .eq('id', key.id)
      upErr = retry.error
    }
    if (upErr) {
      console.error('[apiKeyLifecycle] recap failed', key.id, upErr.message)
      continue
    }
    recapped.push(key.id)
    await recordAudit(client, {
      workspace_id: opts.workspaceId,
      entity_type: 'api_key',
      entity_id: key.id,
      event_type: 'api_key.recapped',
      operation: 'UPDATE',
      channel: 'ui',
      actor_user_id: opts.actorUserId || null,
      before_data: { scopes: key.scopes, max_package: key.max_package },
      after_data: { scopes: finalScopes, max_package: update.max_package },
      metadata: {
        reason: 'role_changed',
        previous_role: opts.previousRole,
        new_role: opts.newRole,
        package: pkg,
        key_name: key.name,
      },
    })
  }

  return { recapped, revoked }
}

export async function auditApiKeyCreated(
  client: SupabaseClient,
  opts: {
    workspaceId: string
    keyId: string
    actorUserId?: string | null
    after: Record<string, unknown>
  },
) {
  await recordAudit(client, {
    workspace_id: opts.workspaceId,
    entity_type: 'api_key',
    entity_id: opts.keyId,
    event_type: 'api_key.created',
    operation: 'INSERT',
    channel: 'ui',
    actor_user_id: opts.actorUserId || null,
    after_data: opts.after,
    metadata: { key_name: opts.after.name, key_kind: opts.after.key_kind },
  })
}
