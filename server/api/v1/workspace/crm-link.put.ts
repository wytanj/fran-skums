/**
 * Upsert CRM loyalty link (HQ / service). Auth: apps:write or full key.
 * Body: { crm_base_url, crm_workspace_id?, auth_mode?, service_token?, status? }
 */
import { getAdminClient } from '../../../utils/supabase'

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event)
  const { hasScope } = await import('../../../utils/apiAuth')
  if (
    !hasScope(ctx, 'credentials:write') &&
    !hasScope(ctx, 'integrations:execute') &&
    !hasScope(ctx, '*') &&
    !hasScope(ctx, 'full')
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: 'API key lacks credentials:write or integrations:execute to set CRM link',
    })
  }
  const body = await readBody(event)
  const base = String(body?.crm_base_url || '')
    .trim()
    .replace(/\/+$/, '')
  if (!base || !/^https?:\/\//i.test(base)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'crm_base_url required (http/https)',
    })
  }

  const row = {
    workspace_id: ctx.workspaceId,
    crm_base_url: base,
    crm_workspace_id: body?.crm_workspace_id || null,
    status: body?.status === 'inactive' ? 'inactive' : 'active',
    auth_mode: body?.auth_mode === 'bearer' ? 'bearer' : 'none',
    service_token:
      body?.service_token !== undefined
        ? body.service_token || null
        : undefined,
    updated_at: new Date().toISOString(),
  }

  const client = getAdminClient()
  // Don't null out token if not provided
  const payload: Record<string, unknown> = { ...row }
  if (payload.service_token === undefined) delete payload.service_token

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
