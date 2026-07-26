/**
 * SKUMS → Fran CRM loyalty facade.
 * POS authenticates with workspace API key; this module loads workspace_crm_links
 * (or env fallback) and forwards to CRM. SKUMS does not own points ledger.
 */
import type { H3Event } from 'h3'
import type { ApiKeyContext } from './apiAuth'
import { getAdminClient } from './supabase'

export type CrmLinkRow = {
  workspace_id: string
  crm_base_url: string
  crm_workspace_id: string | null
  status: string
  auth_mode: string
  service_token: string | null
  last_health_at: string | null
  last_health_status: string | null
  last_error: string | null
  metadata: Record<string, unknown>
}

export type PosCapabilities = {
  as_of: string
  workspace_id: string
  skums: { ok: true; scopes: string[] }
  loyalty: {
    ok: boolean
    status: 'linked' | 'missing' | 'inactive' | 'error' | 'degraded'
    crm_base_url_host: string | null
    crm_workspace_id: string | null
    auth_mode: string | null
    message: string
    last_health_status: string | null
  }
  /** Convenience: member FWB path needs both */
  ready_for_member_loyalty: boolean
  architecture: 'skums_facade'
}

function normalizeBaseUrl(url: string) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '')
}

function hostOf(url: string | null) {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Resolve CRM link: DB row for workspace, else global env (dev single-tenant).
 */
export async function resolveCrmLink(workspaceId: string): Promise<CrmLinkRow | null> {
  const client = getAdminClient()
  const { data, error } = await client
    .from('workspace_crm_links')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!error && data) {
    return data as CrmLinkRow
  }

  // Env fallback for local / single-workspace deploy
  const envUrl = process.env.FRAN_CRM_BASE_URL || process.env.NUXT_FRAN_CRM_BASE_URL
  if (envUrl) {
    return {
      workspace_id: workspaceId,
      crm_base_url: normalizeBaseUrl(envUrl),
      crm_workspace_id:
        process.env.FRAN_CRM_WORKSPACE_ID ||
        process.env.NUXT_FRAN_CRM_WORKSPACE_ID ||
        '11111111-1111-4111-8111-111111111111',
      status: 'active',
      auth_mode: process.env.FRAN_CRM_SERVICE_TOKEN ? 'bearer' : 'none',
      service_token: process.env.FRAN_CRM_SERVICE_TOKEN || null,
      last_health_at: null,
      last_health_status: null,
      last_error: null,
      metadata: { source: 'env' },
    }
  }

  return null
}

export async function buildPosCapabilities(ctx: ApiKeyContext): Promise<PosCapabilities> {
  const link = await resolveCrmLink(ctx.workspaceId)
  let loyalty: PosCapabilities['loyalty']

  if (!link) {
    loyalty = {
      ok: false,
      status: 'missing',
      crm_base_url_host: null,
      crm_workspace_id: null,
      auth_mode: null,
      message:
        'No Fran CRM link for this workspace. HQ: set workspace_crm_links or FRAN_CRM_BASE_URL. POS holds only the SKUMS key.',
      last_health_status: null,
    }
  } else if (link.status !== 'active') {
    loyalty = {
      ok: false,
      status: link.status === 'error' ? 'error' : 'inactive',
      crm_base_url_host: hostOf(link.crm_base_url),
      crm_workspace_id: link.crm_workspace_id,
      auth_mode: link.auth_mode,
      message: link.last_error || `CRM link status=${link.status}`,
      last_health_status: link.last_health_status,
    }
  } else {
    loyalty = {
      ok: true,
      status: 'linked',
      crm_base_url_host: hostOf(link.crm_base_url),
      crm_workspace_id: link.crm_workspace_id,
      auth_mode: link.auth_mode,
      message: 'Loyalty facade available via SKUMS → CRM',
      last_health_status: link.last_health_status,
    }
  }

  return {
    as_of: new Date().toISOString(),
    workspace_id: ctx.workspaceId,
    skums: { ok: true, scopes: ctx.scopes || [] },
    loyalty,
    ready_for_member_loyalty: loyalty.ok,
    architecture: 'skums_facade',
  }
}

export async function recordCrmHealth(
  workspaceId: string,
  status: 'ok' | 'error',
  errorMessage?: string | null,
) {
  const client = getAdminClient()
  // Best-effort; table may not exist pre-migrate or env-only link
  try {
    await client
      .from('workspace_crm_links')
      .update({
        last_health_at: new Date().toISOString(),
        last_health_status: status,
        last_error: status === 'error' ? (errorMessage || 'error').slice(0, 500) : null,
      })
      .eq('workspace_id', workspaceId)
  } catch {
    /* ignore */
  }
}

export type ProxyOptions = {
  method?: string
  path: string
  query?: Record<string, string | undefined>
  body?: unknown
  /** Inject workspaceId into JSON body when POS omits it */
  injectWorkspace?: boolean
}

/**
 * Forward a request to linked CRM. Throws createError on missing link or upstream failure.
 */
export async function proxyLoyaltyToCrm(
  workspaceId: string,
  opts: ProxyOptions,
): Promise<{ status: number; data: unknown }> {
  const link = await resolveCrmLink(workspaceId)
  if (!link || link.status === 'inactive') {
    throw createError({
      statusCode: 503,
      statusMessage: 'loyalty_not_configured',
      message:
        'Fran CRM is not linked for this SKUMS workspace. Configure workspace_crm_links or FRAN_CRM_BASE_URL.',
      data: { code: 'loyalty_not_configured' },
    })
  }

  const base = normalizeBaseUrl(link.crm_base_url)
  const qs = new URLSearchParams()
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== '') qs.set(k, v)
    }
  }
  // Ensure CRM sees a workspace when required
  if (link.crm_workspace_id && !qs.has('workspaceId')) {
    qs.set('workspaceId', link.crm_workspace_id)
  }

  const path = opts.path.startsWith('/') ? opts.path : `/${opts.path}`
  const url = `${base}${path}${qs.toString() ? `?${qs}` : ''}`

  let body = opts.body
  if (opts.injectWorkspace && body && typeof body === 'object' && !Array.isArray(body)) {
    const b = { ...(body as Record<string, unknown>) }
    if (!b.workspaceId && link.crm_workspace_id) b.workspaceId = link.crm_workspace_id
    body = b
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-pos-client': 'fran-pos',
    'x-skums-workspace-id': workspaceId,
    'x-skums-facade': 'loyalty',
  }
  if (link.auth_mode === 'bearer' && link.service_token) {
    headers.authorization = `Bearer ${link.service_token}`
  }

  const method = (opts.method || 'GET').toUpperCase()
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body ?? {}),
    })
  } catch (e: any) {
    await recordCrmHealth(workspaceId, 'error', e?.message || 'fetch failed')
    throw createError({
      statusCode: 502,
      statusMessage: 'loyalty_upstream_unreachable',
      message: `Fran CRM unreachable at ${hostOf(base)}: ${e?.message || 'network error'}`,
      data: { code: 'loyalty_upstream_unreachable' },
    })
  }

  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text.slice(0, 2000) }
    }
  }

  if (!response.ok) {
    await recordCrmHealth(workspaceId, 'error', `HTTP ${response.status}`)
    throw createError({
      statusCode: response.status >= 400 && response.status < 600 ? response.status : 502,
      statusMessage: 'loyalty_upstream_error',
      message:
        (data as any)?.statusMessage ||
        (data as any)?.message ||
        `Fran CRM returned HTTP ${response.status}`,
      data: { code: 'loyalty_upstream_error', upstream: data },
    })
  }

  await recordCrmHealth(workspaceId, 'ok', null)
  return { status: response.status, data }
}

/** Convenience: require pos scope + return capabilities. */
export async function requirePosLoyaltyContext(event: H3Event, scope: 'pos:read' | 'pos:write' = 'pos:read') {
  const ctx = await requireApiKey(event, scope)
  return ctx
}
