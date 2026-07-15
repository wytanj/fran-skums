import { serverSupabaseUser } from '#supabase/server'
import { recordAudit } from '../../../../utils/audit'

/**
 * Soft-revoke an API key (A2). Owner/admin only.
 * Sets is_active=false, revoked_at, revoked_by.
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  const uid = (user as any)?.id || (user as any)?.sub
  if (!uid) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const keyId = getRouterParam(event, 'id')
  if (!keyId) {
    throw createError({ statusCode: 400, statusMessage: 'key id required' })
  }

  const client = getServiceClient()
  const body = await readBody(event).catch(() => ({}))
  const workspaceId = body?.workspace_id ? String(body.workspace_id) : null

  const { data: key, error: loadErr } = await client
    .from('api_keys')
    .select('id, workspace_id, name, is_active, revoked_at')
    .eq('id', keyId)
    .maybeSingle()

  if (loadErr) throw createError({ statusCode: 500, statusMessage: loadErr.message })
  if (!key) throw createError({ statusCode: 404, statusMessage: 'API key not found' })
  if (workspaceId && key.workspace_id !== workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'Workspace mismatch' })
  }

  const { data: workspace } = await client
    .from('workspaces')
    .select('id, owner_id, organization_id')
    .eq('id', key.workspace_id)
    .maybeSingle()

  const { data: membership } = await client
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', key.workspace_id)
    .eq('user_id', uid)
    .maybeSingle()

  let orgAdmin = false
  if (workspace?.organization_id) {
    const { data: om } = await client
      .from('organization_members')
      .select('role')
      .eq('organization_id', workspace.organization_id)
      .eq('user_id', uid)
      .in('role', ['owner', 'admin'])
      .maybeSingle()
    orgAdmin = Boolean(om)
  }

  const isAdmin =
    workspace?.owner_id === uid ||
    orgAdmin ||
    membership?.role === 'owner' ||
    membership?.role === 'admin'

  if (!isAdmin) {
    throw createError({ statusCode: 403, statusMessage: 'Only workspace owner/admin can revoke API keys' })
  }

  const now = new Date().toISOString()
  const update: Record<string, unknown> = {
    is_active: false,
    updated_at: now,
  }
  // Soft-revoke columns (063)
  update.revoked_at = now
  update.revoked_by = uid

  let { data: updated, error } = await client
    .from('api_keys')
    .update(update)
    .eq('id', keyId)
    .select('id, name, is_active, revoked_at, key_prefix')
    .single()

  if (error && /revoked_at|revoked_by|column/i.test(error.message)) {
    const retry = await client
      .from('api_keys')
      .update({ is_active: false, updated_at: now })
      .eq('id', keyId)
      .select('id, name, is_active, key_prefix')
      .single()
    updated = retry.data as any
    error = retry.error
  }

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  try {
    await recordAudit(client, {
      workspace_id: key.workspace_id,
      entity_type: 'api_key',
      entity_id: keyId,
      event_type: 'api_key.revoked',
      operation: 'UPDATE',
      channel: 'ui',
      actor_user_id: uid,
      before_data: { is_active: key.is_active, name: key.name },
      after_data: { is_active: false, revoked_at: now },
      metadata: { reason: 'manual_revoke', key_name: key.name },
    })
  } catch {
    /* non-fatal */
  }

  return {
    ok: true,
    key: updated,
    message: 'API key revoked. MCP and API clients using it will lose access immediately.',
  }
})
