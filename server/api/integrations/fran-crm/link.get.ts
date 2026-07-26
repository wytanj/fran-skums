/**
 * HQ UI: read workspace CRM loyalty link (session auth).
 * Never returns service_token.
 */
import { serverSupabaseUser } from '#supabase/server'
import { resolveCrmLink } from '../../../utils/crmLoyaltyFacade'

async function requireWorkspaceMember(workspaceId: string, userId: string) {
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

  if (!membership) {
    throw createError({ statusCode: 403, statusMessage: 'Not a workspace member' })
  }
  return { role: membership.role as string, client }
}

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  const uid = (user as any)?.id || (user as any)?.sub
  if (!uid) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const query = getQuery(event)
  const workspaceId = String(query.workspace_id || '').trim()
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  await requireWorkspaceMember(workspaceId, uid)
  const link = await resolveCrmLink(workspaceId)

  if (!link) {
    return {
      linked: false,
      workspace_id: workspaceId,
      source: null,
      message: 'No CRM link. Set base URL below or FRAN_CRM_BASE_URL on the server.',
    }
  }

  let host: string | null = null
  try {
    host = new URL(link.crm_base_url).host
  } catch {
    host = link.crm_base_url
  }

  const source = (link.metadata as any)?.source === 'env' ? 'env' : 'database'

  return {
    linked: link.status === 'active',
    workspace_id: workspaceId,
    source,
    crm_base_url: source === 'env' ? link.crm_base_url : link.crm_base_url,
    crm_base_url_host: host,
    crm_workspace_id: link.crm_workspace_id,
    status: link.status,
    auth_mode: link.auth_mode,
    has_service_token: Boolean(link.service_token),
    last_health_at: link.last_health_at,
    last_health_status: link.last_health_status,
    last_error: link.last_error,
    // never return service_token
  }
})
