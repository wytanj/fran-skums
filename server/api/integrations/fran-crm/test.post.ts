/**
 * HQ UI: health-check CRM link (session auth).
 * Hits CRM active policy format=pos via facade proxy.
 */
import { serverSupabaseUser } from '#supabase/server'
import { proxyLoyaltyToCrm, resolveCrmLink } from '../../../utils/crmLoyaltyFacade'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  const uid = (user as any)?.id || (user as any)?.sub
  if (!uid) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event)
  const workspaceId = String(body?.workspace_id || '').trim()
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  const client = getServiceClient()
  const { data: workspace } = await client
    .from('workspaces')
    .select('id, owner_id')
    .eq('id', workspaceId)
    .maybeSingle()
  if (!workspace) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })

  if (workspace.owner_id !== uid) {
    const { data: membership } = await client
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', uid)
      .maybeSingle()
    if (!membership) {
      throw createError({ statusCode: 403, statusMessage: 'Not a workspace member' })
    }
  }

  const link = await resolveCrmLink(workspaceId)
  if (!link) {
    throw createError({
      statusCode: 503,
      statusMessage: 'loyalty_not_configured',
      message: 'No CRM link for this workspace',
    })
  }

  const { data } = await proxyLoyaltyToCrm(workspaceId, {
    method: 'GET',
    path: '/api/fran/loyalty/policy-versions/active',
    query: {
      workspaceId: link.crm_workspace_id || undefined,
      programKey: 'fran-v2',
      format: 'pos',
    },
  })

  const policyVersionId =
    (data as any)?.policyVersionId || (data as any)?.posPolicyBundle?.policyVersionId || null

  return {
    ok: true,
    workspace_id: workspaceId,
    crm_host: (() => {
      try {
        return new URL(link.crm_base_url).host
      } catch {
        return link.crm_base_url
      }
    })(),
    policyVersionId,
    message: policyVersionId
      ? 'CRM policy endpoint OK (format=pos)'
      : 'CRM responded but policyVersionId missing',
  }
})
