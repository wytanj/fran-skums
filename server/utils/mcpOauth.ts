/**
 * Per-user OAuth 2.1 for the remote MCP endpoint (Claude Enterprise connector).
 *
 * Shape of the problem: Claude stores one connector config per organisation —
 * one URL, one optional OAuth client id/secret. Under the API-key-in-URL scheme
 * that means one key shared by every employee, so everyone gets identical MCP
 * power regardless of their web role, and there is no second field to give Fern
 * a different URL than Jeremy.
 *
 * OAuth fixes that because the shared part (client id/secret) only identifies
 * Claude as an application; the credential that grants data access is an access
 * token minted per employee after they sign in to Fran. Anthropic does not
 * support a client_credentials grant at all — "every connection requires user
 * consent" — so authorization_code + PKCE is the only available path.
 *
 * This module is the request-bound and database-bound layer. The protocol rules
 * live in mcpOauthProtocol.ts so they can be tested without Nitro.
 *
 * @see server/utils/mcpOauthProtocol.ts
 * @see core/db/082_mcp_oauth.sql
 * @see docs/MCP_OAUTH_DESIGN.md
 */
import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveEffectiveScopesForApiKey } from './effectiveScopes'
import { defaultMcpPackageForRole } from './scopes'
import { resolveCloudMcpScopes } from '../../mcp/src/context.mjs'
import {
  ACCESS_TTL_MS,
  CLAUDE_REDIRECT_URI,
  CODE_TTL_MS,
  MCP_ACCESS_TOKEN_PREFIX,
  MCP_CODE_PREFIX,
  MCP_OAUTH_SCOPES,
  MCP_REFRESH_TOKEN_PREFIX,
  OauthError,
  REFRESH_TTL_MS,
  type AuthorizeParams,
  authorizationServerMetadataFor,
  checkAuthorizeParams,
  generateClientCredentials,
  grantIncludesOfflineAccess,
  hashMcpToken,
  isMcpOauthAccessToken,
  protectedResourceMetadataFor,
  resourceMatches,
  unauthorizedHeaderFor,
  verifyClientSecretHash,
  verifyPkceS256,
} from './mcpOauthProtocol'

export {
  MCP_ACCESS_TOKEN_PREFIX,
  MCP_OAUTH_SCOPES,
  MCP_REFRESH_TOKEN_PREFIX,
  OauthError,
  generateClientCredentials,
  hashMcpToken,
  isMcpOauthAccessToken,
  resourceMatches,
  verifyClientSecretHash,
  verifyPkceS256,
}
export type { AuthorizeParams }

export type McpOauthClient = {
  /** Row id when registered in the database; null for the env-var fallback. */
  id: string | null
  clientId: string
  /** SHA-256 of the secret. Null = public client (no secret required). */
  clientSecretHash: string | null
  redirectUris: string[]
  /** Where the credentials came from. Surfaced in Settings so it is not a mystery. */
  source: 'database' | 'env'
}

export type McpOauthTokenGrant = {
  accessToken: string
  refreshToken: string | null
  expiresInSeconds: number
  scope: string
}

export type McpOauthIdentity = {
  tokenId: string
  workspaceId: string
  userId: string
  clientId: string
  scope: string | null
}

/** Registered redirect URIs. Env var is an escape hatch for local tunnels. */
function registeredRedirectUris(): string[] {
  const extra = String(process.env.MCP_OAUTH_EXTRA_REDIRECT_URIS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [CLAUDE_REDIRECT_URI, ...extra]
}

/** Env-var fallback, kept so existing deployments and local dev need no change. */
function envMcpOauthClient(): McpOauthClient | null {
  const config = useRuntimeConfig()
  const clientId = String(
    (config as any).mcpOauthClientId || process.env.MCP_OAUTH_CLIENT_ID || '',
  ).trim()
  if (!clientId) return null

  const clientSecret = String(
    (config as any).mcpOauthClientSecret || process.env.MCP_OAUTH_CLIENT_SECRET || '',
  ).trim()

  return {
    id: null,
    clientId,
    // Hashed on the fly so verification is uniform across both sources.
    clientSecretHash: clientSecret ? hashMcpToken(clientSecret) : null,
    redirectUris: registeredRedirectUris(),
    source: 'env',
  }
}

/**
 * The registered client. Database first, env var as fallback.
 *
 * One client for the whole deployment — every Claude organisation that adds the
 * connector pastes the same pair, which is safe because the pair grants nothing
 * on its own. Returns null when neither source has one, and every caller treats
 * that as "OAuth is off", which is what keeps this inert until it is set up.
 *
 * Database first so rotating a leaked secret is a button in Settings rather than
 * a Vercel edit plus a redeploy.
 */
export async function mcpOauthClient(
  db?: SupabaseClient,
): Promise<McpOauthClient | null> {
  try {
    const client = db || getAdminClient()
    const { data } = await client
      .from('mcp_oauth_clients')
      .select('id, client_id, client_secret_hash')
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)

    const row = data?.[0]
    if (row) {
      return {
        id: row.id as string,
        clientId: row.client_id as string,
        clientSecretHash: (row.client_secret_hash as string) || null,
        redirectUris: registeredRedirectUris(),
        source: 'database',
      }
    }
  } catch {
    // No service key, table not migrated yet, or the DB is unreachable. Fall back
    // rather than taking the MCP endpoint down with us.
  }
  return envMcpOauthClient()
}

/** Note the client was used, for the "last used" line in Settings. */
export function touchMcpOauthClient(db: SupabaseClient, client: McpOauthClient): void {
  if (!client.id) return
  db.from('mcp_oauth_clients')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', client.id)
    .then(() => {})
}

/**
 * Create the client, or replace the secret on the existing one.
 *
 * Rotation keeps the same `client_id` and replaces only the secret, so the admin
 * updates one field in Claude instead of re-adding the connector. Live access
 * tokens are unaffected; refreshes fail until Claude has the new secret, which is
 * the intended behaviour when you are rotating because a secret leaked.
 *
 * Returns the raw secret — the only time it exists outside this function.
 */
export async function createOrRotateMcpOauthClient(
  db: SupabaseClient,
  input: { workspaceId: string; userId: string | null; label?: string | null },
): Promise<{ clientId: string; clientSecret: string; rotated: boolean }> {
  const generated = generateClientCredentials()

  const { data: existing } = await db
    .from('mcp_oauth_clients')
    .select('id, client_id')
    .eq('workspace_id', input.workspaceId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)

  const current = existing?.[0]
  if (current) {
    const { error } = await db
      .from('mcp_oauth_clients')
      .update({
        client_secret_hash: hashMcpToken(generated.clientSecret),
        secret_prefix: generated.secretPrefix,
        rotated_at: new Date().toISOString(),
        label: input.label ?? undefined,
      })
      .eq('id', current.id)
    if (error) throw new Error(`could not rotate client secret: ${error.message}`)
    return {
      clientId: current.client_id as string,
      clientSecret: generated.clientSecret,
      rotated: true,
    }
  }

  const { error } = await db.from('mcp_oauth_clients').insert({
    workspace_id: input.workspaceId,
    client_id: generated.clientId,
    client_secret_hash: hashMcpToken(generated.clientSecret),
    secret_prefix: generated.secretPrefix,
    label: input.label || 'Claude connector',
    created_by: input.userId,
  })
  if (error) throw new Error(`could not create client: ${error.message}`)

  return { clientId: generated.clientId, clientSecret: generated.clientSecret, rotated: false }
}

/**
 * Revoke the client. New authorizations and refreshes stop immediately; access
 * tokens already issued keep working until they expire (≤1h) unless you also
 * revoke tokens.
 */
export async function revokeMcpOauthClient(
  db: SupabaseClient,
  workspaceId: string,
  reason = 'revoked_by_admin',
): Promise<boolean> {
  const { data } = await db
    .from('mcp_oauth_clients')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq('workspace_id', workspaceId)
    .is('revoked_at', null)
    .select('id')
  return Boolean(data?.length)
}

/** Metadata for Settings. Never returns the secret or its hash. */
export async function describeMcpOauthClient(
  db: SupabaseClient,
  workspaceId: string,
): Promise<{
  configured: boolean
  source: 'database' | 'env' | null
  client_id: string | null
  secret_prefix: string | null
  has_secret: boolean
  label: string | null
  created_at: string | null
  rotated_at: string | null
  last_used_at: string | null
}> {
  const { data } = await db
    .from('mcp_oauth_clients')
    .select('client_id, secret_prefix, client_secret_hash, label, created_at, rotated_at, last_used_at')
    .eq('workspace_id', workspaceId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)

  const row = data?.[0]
  if (row) {
    return {
      configured: true,
      source: 'database',
      client_id: row.client_id as string,
      secret_prefix: (row.secret_prefix as string) || null,
      has_secret: Boolean(row.client_secret_hash),
      label: (row.label as string) || null,
      created_at: (row.created_at as string) || null,
      rotated_at: (row.rotated_at as string) || null,
      last_used_at: (row.last_used_at as string) || null,
    }
  }

  // Nothing in the database — report the env fallback so Settings can explain
  // why the connector works without a row here.
  const env = envMcpOauthClient()
  return {
    configured: Boolean(env),
    source: env ? 'env' : null,
    client_id: env?.clientId || null,
    secret_prefix: null,
    has_secret: Boolean(env?.clientSecretHash),
    label: env ? 'Environment variables' : null,
    created_at: null,
    rotated_at: null,
    last_used_at: null,
  }
}

/** Who currently has a live Claude connection, for the Settings list. */
export async function listMcpOauthConnections(
  db: SupabaseClient,
  workspaceId: string,
): Promise<
  Array<{
    user_id: string
    full_name: string | null
    email: string | null
    created_at: string | null
    last_used_at: string | null
    expires_at: string | null
  }>
> {
  const { data } = await db
    .from('mcp_oauth_tokens')
    .select('user_id, created_at, last_used_at, expires_at, profiles(full_name)')
    .eq('workspace_id', workspaceId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  // One live connection per person, newest first (rotation leaves older rows revoked).
  const byUser = new Map<string, any>()
  for (const row of data || []) {
    if (!byUser.has(row.user_id as string)) byUser.set(row.user_id as string, row)
  }

  // profiles has no email column — it lives in auth.users, reachable only via
  // the admin API. Best effort: a failure here costs a label, not the feature.
  const emails = new Map<string, string>()
  try {
    const { data: users } = await (db as any).auth.admin.listUsers({ page: 1, perPage: 200 })
    for (const u of users?.users || []) {
      if (u?.id && u?.email) emails.set(u.id, u.email)
    }
  } catch {
    /* leave emails blank */
  }

  return [...byUser.values()].map((row) => ({
    user_id: row.user_id as string,
    full_name: (row.profiles?.full_name as string) || null,
    email: emails.get(row.user_id as string) || null,
    created_at: (row.created_at as string) || null,
    last_used_at: (row.last_used_at as string) || null,
    expires_at: (row.expires_at as string) || null,
  }))
}

/** Disconnect everyone. The "reset" button — each person must click Connect again. */
export async function revokeAllMcpOauthTokens(
  db: SupabaseClient,
  workspaceId: string,
  reason = 'revoked_by_admin',
): Promise<number> {
  const { data } = await db
    .from('mcp_oauth_tokens')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq('workspace_id', workspaceId)
    .is('revoked_at', null)
    .select('id')
  return data?.length || 0
}

/** Absolute origin of this deployment, as Claude sees it. */
export function mcpOauthIssuer(event: H3Event): string {
  const explicit = String(process.env.MCP_OAUTH_ISSUER || '').trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  const host = getHeader(event, 'x-forwarded-host') || getHeader(event, 'host') || ''
  const proto = String(getHeader(event, 'x-forwarded-proto') || 'https').split(',')[0]
  if (host) return `${proto}://${host}`.replace(/\/+$/, '')

  const config = useRuntimeConfig()
  const site = String((config.public as any)?.siteUrl || 'https://fran-skums.vercel.app')
  return site.replace(/\/+$/, '')
}

/**
 * The protected resource. Must match the URL the admin typed into Claude exactly
 * — Anthropic compares them literally, path included.
 */
export function mcpResourceUrl(event: H3Event): string {
  return `${mcpOauthIssuer(event)}/mcp`
}

export function protectedResourceMetadata(event: H3Event) {
  return protectedResourceMetadataFor(mcpOauthIssuer(event))
}

export async function authorizationServerMetadata(event: H3Event) {
  const client = await mcpOauthClient()
  return authorizationServerMetadataFor(
    mcpOauthIssuer(event),
    Boolean(client?.clientSecretHash),
  )
}

export function mcpUnauthorizedHeader(event: H3Event): string {
  return unauthorizedHeaderFor(mcpOauthIssuer(event))
}

/** H3 wrapper around checkAuthorizeParams — throws so handlers can stay linear. */
export async function validateAuthorizeRequest(
  event: H3Event,
  query: Record<string, any>,
): Promise<AuthorizeParams> {
  const client = await mcpOauthClient()
  if (!client) {
    throw createError({
      statusCode: 503,
      statusMessage: 'MCP OAuth is not configured on this deployment.',
    })
  }

  const result = checkAuthorizeParams(query, {
    clientId: client.clientId,
    redirectUris: client.redirectUris,
    resource: mcpResourceUrl(event),
  })
  if (!result.ok) {
    throw createError({ statusCode: result.status, statusMessage: result.message })
  }
  return result.params
}

// ---------------------------------------------------------------------------
// Identity → workspace → scopes
// ---------------------------------------------------------------------------

/**
 * Resolve which workspace an employee connects to.
 *
 * Opinionated: one workspace. If someone belongs to several we take the oldest
 * membership and flag the ambiguity so the consent screen can name it, rather
 * than silently guessing.
 */
export async function resolveWorkspaceForUser(
  client: SupabaseClient,
  userId: string,
): Promise<{ workspaceId: string | null; workspaceName: string | null; ambiguous: boolean }> {
  const { data: memberships } = await client
    .from('workspace_members')
    .select('workspace_id, created_at, workspaces(name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (memberships?.length) {
    return {
      workspaceId: memberships[0].workspace_id as string,
      workspaceName: ((memberships[0] as any).workspaces?.name as string) || null,
      ambiguous: memberships.length > 1,
    }
  }

  // Owner without a membership row — mirrors resolveEffectiveScopesForApiKey.
  const { data: owned } = await client
    .from('workspaces')
    .select('id, name')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })

  if (owned?.length) {
    return {
      workspaceId: owned[0].id as string,
      workspaceName: (owned[0].name as string) || null,
      ambiguous: owned.length > 1,
    }
  }

  return { workspaceId: null, workspaceName: null, ambiguous: false }
}

/**
 * MCP scopes for an OAuth-authenticated employee.
 *
 * Runs the existing A2 pipeline unchanged by handing resolveEffectiveScopesForApiKey
 * a synthetic key row bound to this user. That is deliberate: an OAuth connection
 * should behave exactly like the key an admin *would* have issued for this
 * person's role, so there is one permission model to reason about and no second
 * implementation to drift. The synthetic key carries the default package for the
 * role, so live membership is what actually caps power.
 *
 * Fails closed — a non-member resolves to [] via bound_user_not_a_member.
 */
export async function resolveMcpScopesForUser(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<{ scopes: string[]; role: string | null; deniedReason?: string }> {
  const { data: membership } = await client
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()

  let role = (membership?.role as string) || null
  if (!role) {
    const { data: ws } = await client
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .maybeSingle()
    if (ws?.owner_id === userId) role = 'owner'
  }

  const effective = await resolveEffectiveScopesForApiKey(
    client,
    {
      id: `oauth:${userId}`,
      workspace_id: workspaceId,
      name: 'mcp-oauth',
      scopes: [defaultMcpPackageForRole(role)],
      is_active: true,
      bound_user_id: userId,
      key_kind: 'mcp_connector',
      max_package: null,
      revoked_at: null,
    },
    { cloud: true },
  )

  if (effective.deniedReason) {
    return { scopes: [], role, deniedReason: effective.deniedReason }
  }

  const scopes = resolveCloudMcpScopes(
    effective.scopes?.length ? effective.scopes : ['mcp:viewer'],
  )
  return { scopes, role: effective.boundUserRole || role }
}

// ---------------------------------------------------------------------------
// Authorization code
// ---------------------------------------------------------------------------

export async function mintAuthorizationCode(
  client: SupabaseClient,
  input: {
    workspaceId: string
    userId: string
    clientId: string
    redirectUri: string
    codeChallenge: string
    resource: string | null
    scope: string
  },
): Promise<string> {
  const raw = `${MCP_CODE_PREFIX}${randomBytes(32).toString('base64url')}`
  const { error } = await client.from('mcp_oauth_codes').insert({
    code_hash: hashMcpToken(raw),
    workspace_id: input.workspaceId,
    user_id: input.userId,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    resource: input.resource,
    scope: input.scope,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (error) throw new OauthError('server_error', `could not persist code: ${error.message}`, 500)
  return raw
}

async function issueTokens(
  client: SupabaseClient,
  input: {
    workspaceId: string
    userId: string
    clientId: string
    resource: string | null
    scope: string
    withRefresh: boolean
    rotatedFrom?: string | null
  },
): Promise<McpOauthTokenGrant> {
  const accessToken = `${MCP_ACCESS_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
  const refreshToken = input.withRefresh
    ? `${MCP_REFRESH_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
    : null

  const { error } = await client.from('mcp_oauth_tokens').insert({
    access_token_hash: hashMcpToken(accessToken),
    refresh_token_hash: refreshToken ? hashMcpToken(refreshToken) : null,
    workspace_id: input.workspaceId,
    user_id: input.userId,
    client_id: input.clientId,
    resource: input.resource,
    scope: input.scope,
    expires_at: new Date(Date.now() + ACCESS_TTL_MS).toISOString(),
    refresh_expires_at: refreshToken
      ? new Date(Date.now() + REFRESH_TTL_MS).toISOString()
      : null,
    rotated_from: input.rotatedFrom || null,
  })
  if (error) throw new OauthError('server_error', `could not persist token: ${error.message}`, 500)

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: Math.floor(ACCESS_TTL_MS / 1000),
    scope: input.scope,
  }
}

export async function exchangeAuthorizationCode(
  client: SupabaseClient,
  input: {
    code: string
    clientId: string
    redirectUri: string
    codeVerifier: string
    resource: string | null
  },
): Promise<McpOauthTokenGrant> {
  const { data: row } = await client
    .from('mcp_oauth_codes')
    .select('*')
    .eq('code_hash', hashMcpToken(input.code))
    .maybeSingle()

  if (!row) throw new OauthError('invalid_grant', 'authorization code not recognised')

  // Single use (RFC 6749 §4.1.2). A replay means the code leaked, so burn the
  // user's whole grant rather than just refusing this one request.
  if (row.consumed_at) {
    await client
      .from('mcp_oauth_tokens')
      .update({
        revoked_at: new Date().toISOString(),
        revoked_reason: 'authorization_code_replayed',
      })
      .eq('user_id', row.user_id)
      .eq('workspace_id', row.workspace_id)
      .is('revoked_at', null)
    throw new OauthError('invalid_grant', 'authorization code already used')
  }

  if (new Date(row.expires_at) < new Date()) {
    throw new OauthError('invalid_grant', 'authorization code expired')
  }
  if (row.client_id !== input.clientId) {
    throw new OauthError('invalid_grant', 'authorization code was issued to another client')
  }
  if (row.redirect_uri !== input.redirectUri) {
    throw new OauthError('invalid_grant', 'redirect_uri does not match the authorization request')
  }
  if (row.code_challenge_method !== 'S256') {
    throw new OauthError('invalid_grant', 'unsupported code_challenge_method')
  }
  if (!verifyPkceS256(input.codeVerifier, row.code_challenge)) {
    throw new OauthError('invalid_grant', 'PKCE verification failed')
  }
  if (!resourceMatches(input.resource, row.resource || '')) {
    throw new OauthError('invalid_target', 'resource does not match the authorization request')
  }

  // Mark consumed before minting so a concurrent replay loses the race.
  const { data: consumed } = await client
    .from('mcp_oauth_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle()
  if (!consumed) throw new OauthError('invalid_grant', 'authorization code already used')

  // Opportunistic cleanup — cheap, and saves needing a scheduled job.
  client
    .from('mcp_oauth_codes')
    .delete()
    .lt('expires_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .then(() => {})

  const scope = String(row.scope || 'mcp')
  return issueTokens(client, {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    clientId: row.client_id,
    resource: row.resource,
    scope,
    withRefresh: grantIncludesOfflineAccess(scope),
  })
}

export async function refreshAccessToken(
  client: SupabaseClient,
  input: { refreshToken: string; clientId: string; resource: string | null },
): Promise<McpOauthTokenGrant> {
  const { data: row } = await client
    .from('mcp_oauth_tokens')
    .select('*')
    .eq('refresh_token_hash', hashMcpToken(input.refreshToken))
    .maybeSingle()

  // RFC 6749 requires invalid_grant (not invalid_request) for a dead refresh
  // token — Claude keys its "re-run the consent flow" behaviour off that code.
  if (!row) throw new OauthError('invalid_grant', 'refresh token not recognised')
  if (row.revoked_at) throw new OauthError('invalid_grant', 'refresh token revoked')
  if (row.client_id !== input.clientId) {
    throw new OauthError('invalid_grant', 'refresh token was issued to another client')
  }
  if (row.refresh_expires_at && new Date(row.refresh_expires_at) < new Date()) {
    throw new OauthError('invalid_grant', 'refresh token expired')
  }

  // Membership is re-checked here as well as per request, so an offboarded
  // employee's connection dies at the next refresh even if nothing calls a tool.
  const check = await resolveMcpScopesForUser(client, row.workspace_id, row.user_id)
  if (!check.scopes.length) {
    await client
      .from('mcp_oauth_tokens')
      .update({
        revoked_at: new Date().toISOString(),
        revoked_reason: check.deniedReason || 'no_scopes',
      })
      .eq('id', row.id)
    throw new OauthError('invalid_grant', 'user no longer has access to this workspace')
  }

  // Rotate: the old row dies in the same step that issues its replacement.
  await client
    .from('mcp_oauth_tokens')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: 'rotated' })
    .eq('id', row.id)

  return issueTokens(client, {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    clientId: row.client_id,
    resource: row.resource,
    scope: String(row.scope || 'mcp'),
    withRefresh: true,
    rotatedFrom: row.id,
  })
}

/**
 * Look up a bearer access token. Returns null when it is not one of ours so the
 * caller can fall through to API-key auth.
 */
export async function authenticateMcpOauthToken(
  client: SupabaseClient,
  rawToken: string,
): Promise<McpOauthIdentity | null> {
  if (!isMcpOauthAccessToken(rawToken)) return null

  const { data: row } = await client
    .from('mcp_oauth_tokens')
    .select('id, workspace_id, user_id, client_id, scope, expires_at, revoked_at')
    .eq('access_token_hash', hashMcpToken(rawToken))
    .maybeSingle()

  if (!row) return null
  if (row.revoked_at) return null
  if (new Date(row.expires_at) < new Date()) return null

  client
    .from('mcp_oauth_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)
    .then(() => {})

  return {
    tokenId: row.id as string,
    workspaceId: row.workspace_id as string,
    userId: row.user_id as string,
    clientId: row.client_id as string,
    scope: (row.scope as string) || null,
  }
}

/** Revoke every live token for one employee (offboarding, "disconnect all"). */
export async function revokeMcpOauthTokensForUser(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
  reason = 'revoked_by_admin',
): Promise<number> {
  const { data } = await client
    .from('mcp_oauth_tokens')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('id')
  return data?.length || 0
}
