import { serverSupabaseUser } from '#supabase/server'
import {
  capScopesByCreator,
  defaultMcpPackageForRole,
  resolveEffectiveScopesForSession,
} from '../../../utils/effectiveScopes'
import { expandScopePackage } from '../../../utils/scopes'

/**
 * UI-facing endpoint for creating API keys.
 * Authenticates via Supabase session cookie (not API key).
 * A2: caps scopes by creator web power; binds to user for MCP.
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  const uid = (user as any)?.id || (user as any)?.sub
  if (!uid) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const client = getServiceClient()
  const body = await readBody(event)

  if (!body.workspace_id || !body.name) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id and name are required' })
  }

  let scopes = Array.isArray(body.scopes) ? body.scopes.map((scope: unknown) => String(scope)) : []
  const keyKind = String(body.key_kind || body.kind || 'general')
  const isPosOnlyKey =
    keyKind === 'pos' ||
    (scopes.length > 0 && scopes.every((scope: string) => ['pos:read', 'pos:write'].includes(scope)))
  const isMcpKey =
    keyKind === 'mcp_connector' ||
    keyKind === 'mcp' ||
    scopes.some((s) => s.startsWith('mcp:') || s === 'mcp:safe')

  const { data: workspace, error: workspaceError } = await client
    .from('workspaces')
    .select('id, owner_id, organization_id')
    .eq('id', body.workspace_id)
    .maybeSingle()

  if (workspaceError) {
    throw createError({ statusCode: 500, statusMessage: workspaceError.message })
  }

  if (!workspace) {
    throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  }

  const { data: membership, error: membershipError } = await client
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', body.workspace_id)
    .eq('user_id', uid)
    .maybeSingle()

  if (membershipError) {
    throw createError({ statusCode: 500, statusMessage: membershipError.message })
  }

  let orgAdmin = false
  if (workspace.organization_id) {
    const { data: orgMembership, error: orgMembershipError } = await client
      .from('organization_members')
      .select('role')
      .eq('organization_id', workspace.organization_id)
      .eq('user_id', uid)
      .in('role', ['owner', 'admin'])
      .maybeSingle()

    if (orgMembershipError) {
      throw createError({ statusCode: 500, statusMessage: orgMembershipError.message })
    }
    orgAdmin = Boolean(orgMembership)
  }

  const directRole = membership?.role || null
  const isWorkspaceOwner = workspace.owner_id === uid
  const isWorkspaceAdmin = isWorkspaceOwner || orgAdmin || directRole === 'owner' || directRole === 'admin'
  const canCreatePosConnector = isWorkspaceAdmin || directRole === 'member'

  if (!isWorkspaceAdmin && !(isPosOnlyKey && canCreatePosConnector)) {
    throw createError({
      statusCode: 403,
      statusMessage: isPosOnlyKey
        ? 'Workspace access required to create a POS connector key'
        : 'Workspace admin access required (api:write / owner/admin)',
    })
  }

  // A2: bind user + package
  const boundUserId = body.bound_user_id ? String(body.bound_user_id) : uid
  let maxPackage =
    body.max_package != null
      ? String(body.max_package)
      : isMcpKey
        ? defaultMcpPackageForRole(isWorkspaceAdmin ? 'owner' : directRole)
        : isPosOnlyKey
          ? 'pos_connector'
          : null

  if (isMcpKey && !scopes.length) {
    scopes = expandScopePackage(maxPackage || 'mcp:safe')
  }
  if (isPosOnlyKey && !scopes.length) {
    scopes = expandScopePackage('pos_connector')
  }

  // Cap requested scopes by creator's web power
  const creator = await resolveEffectiveScopesForSession(client, body.workspace_id, uid)
  scopes = capScopesByCreator(scopes, creator.scopes.includes('*') ? ['*'] : creator.scopes, {
    cloudPackage: isMcpKey,
  })

  // If binding to another user, also cap by their power
  if (boundUserId && boundUserId !== uid) {
    const bound = await resolveEffectiveScopesForSession(client, body.workspace_id, boundUserId)
    if (!bound.role && bound.scopes.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'bound_user_id is not a workspace member' })
    }
    scopes = capScopesByCreator(scopes, bound.scopes.length ? bound.scopes : ['*'], {
      cloudPackage: isMcpKey,
    })
    if (isMcpKey) {
      maxPackage = defaultMcpPackageForRole(bound.role)
    }
  }

  if (!scopes.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No scopes remain after applying your web login permissions. Raise your role or pick a smaller package.',
    })
  }

  const { raw, hash, prefix } = generateApiKey()

  const insertRow: Record<string, unknown> = {
    workspace_id: body.workspace_id,
    name: body.name,
    description: body.description || null,
    key_prefix: prefix,
    key_hash: hash,
    scopes,
    rate_limit_rpm: body.rate_limit_rpm || 60,
    expires_at: body.expires_at || null,
    created_by: uid,
    bound_user_id: boundUserId,
    key_kind: isPosOnlyKey ? 'pos' : isMcpKey ? 'mcp_connector' : keyKind || 'general',
    max_package: maxPackage,
  }

  const { data, error } = await client
    .from('api_keys')
    .insert(insertRow)
    .select(
      'id, name, key_prefix, scopes, rate_limit_rpm, is_active, created_at, expires_at, bound_user_id, key_kind, max_package',
    )
    .single()

  if (error) {
    // Migration 063 may not be applied yet — retry without new columns
    if (/bound_user_id|key_kind|max_package|column/i.test(error.message)) {
      const { data: legacy, error: legErr } = await client
        .from('api_keys')
        .insert({
          workspace_id: body.workspace_id,
          name: body.name,
          description: body.description || null,
          key_prefix: prefix,
          key_hash: hash,
          scopes,
          rate_limit_rpm: body.rate_limit_rpm || 60,
          expires_at: body.expires_at || null,
          created_by: uid,
        })
        .select('id, name, key_prefix, scopes, rate_limit_rpm, is_active, created_at, expires_at')
        .single()
      if (legErr) throw createError({ statusCode: 500, statusMessage: legErr.message })
      setResponseStatus(event, 201)
      return { ...legacy, key: raw, note: 'Apply migration 063 for bound_user / soft revoke columns' }
    }
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  setResponseStatus(event, 201)
  return {
    ...data,
    key: raw,
  }
})
