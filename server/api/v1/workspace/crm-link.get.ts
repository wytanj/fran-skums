/**
 * Read CRM loyalty link for workspace (no service_token in response).
 * Auth: API key with apps:read OR authenticated admin (via API key for POS setup tools).
 */
import { resolveCrmLink } from '../../../utils/crmLoyaltyFacade'

export default defineEventHandler(async (event) => {
  // Allow pos:read so POS can show loyalty status without admin key
  let ctx
  try {
    ctx = await requireApiKey(event, 'pos:read')
  } catch {
    ctx = await requireApiKey(event, 'apps:read')
  }

  const link = await resolveCrmLink(ctx.workspaceId)
  if (!link) {
    return {
      linked: false,
      workspace_id: ctx.workspaceId,
      message: 'No CRM link (workspace_crm_links or FRAN_CRM_BASE_URL)',
    }
  }

  let host: string | null = null
  try {
    host = new URL(link.crm_base_url).host
  } catch {
    host = link.crm_base_url
  }

  return {
    linked: link.status === 'active',
    workspace_id: ctx.workspaceId,
    crm_base_url_host: host,
    crm_workspace_id: link.crm_workspace_id,
    status: link.status,
    auth_mode: link.auth_mode,
    last_health_at: link.last_health_at,
    last_health_status: link.last_health_status,
    last_error: link.last_error,
    // never return service_token
  }
})
