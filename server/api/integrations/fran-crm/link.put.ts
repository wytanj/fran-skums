/**
 * HQ UI: upsert workspace CRM loyalty link (session auth, admin/owner only).
 */
import { serverSupabaseUser } from '#supabase/server'

async function requireWorkspaceAdmin(workspaceId: string, userId: string) {
  const client = getServiceClient()
  const { data: workspace } = await client
    .from('workspaces')
    .select('id, owner_id')
    .eq('id', workspaceId)
    .maybeSingle()
  if (!workspace) {
    throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  }
  if (workspace.owner_id === userId) return { role: 'owner', client }

  const { data: membership } = await client
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()

  const role = (membership?.role || '').toLowerCase()
  if (!membership || !['owner', 'admin'].includes(role)) {
    throw createError({ statusCode: 403, statusMessage: 'Owner or admin required to set CRM link' })
  }
  return { role, client }
}

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  const uid = (user as any)?.id || (user as any)?.sub
  if (!uid) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event)
  const workspaceId = String(body?.workspace_id || '').trim()
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  const { client } = await requireWorkspaceAdmin(workspaceId, uid)

  // Clear link
  if (body?.clear === true || body?.status === 'inactive' && !body?.crm_base_url) {
    await client.from('workspace_crm_links').delete().eq('workspace_id', workspaceId)
    return { ok: true, cleared: true, workspace_id: workspaceId }
  }

  const base = String(body?.crm_base_url || '')
    .trim()
    .replace(/\/+$/, '')
  if (!base || !/^https?:\/\//i.test(base)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'crm_base_url required (http:// or https://)',
    })
  }

  const payload: Record<string, unknown> = {
    workspace_id: workspaceId,
    crm_base_url: base,
    crm_workspace_id: body?.crm_workspace_id || null,
    status: body?.status === 'inactive' ? 'inactive' : 'active',
    auth_mode: body?.auth_mode === 'bearer' ? 'bearer' : 'none',
    created_by: uid,
    updated_at: new Date().toISOString(),
    metadata: { source: 'hq_ui', updated_by: uid },
  }

  // Only update token if explicitly provided (empty string clears)
  if (body?.service_token !== undefined) {
    payload.service_token = body.service_token ? String(body.service_token) : null
  }

  const { data, error } = await client
    .from('workspace_crm_links')
    .upsert(payload, { onConflict: 'workspace_id' })
    .select(
      'workspace_id, crm_base_url, crm_workspace_id, status, auth_mode, last_health_at, last_health_status, last_error',
    )
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { ok: true, link: data }
})
