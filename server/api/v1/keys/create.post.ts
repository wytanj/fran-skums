import { serverSupabaseUser } from '#supabase/server'

/**
 * UI-facing endpoint for creating API keys.
 * Authenticates via Supabase session cookie (not API key).
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

  const scopes = Array.isArray(body.scopes) ? body.scopes.map((scope: unknown) => String(scope)) : []
  const isPosOnlyKey = scopes.length > 0 && scopes.every((scope: string) => ['pos:read', 'pos:write'].includes(scope))

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
        : 'Workspace admin access required',
    })
  }

  const { raw, hash, prefix } = generateApiKey()

  const { data, error } = await client
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

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  setResponseStatus(event, 201)
  return {
    ...data,
    key: raw,
  }
})
