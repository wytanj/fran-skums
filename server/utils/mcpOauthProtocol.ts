/**
 * Pure OAuth 2.1 protocol logic for the remote MCP connector.
 *
 * Split from mcpOauth.ts on purpose: everything here depends only on
 * node:crypto, so the parts that decide whether a request is legitimate — PKCE
 * verification, redirect_uri allowlisting, resource matching, scope negotiation
 * — are unit-testable without Nitro, Supabase or an H3 event. mcpOauth.ts adds
 * the request-bound and database-bound layer on top and re-exports these.
 *
 * @see server/utils/mcpOauth.ts
 * @see tests/mcp-oauth.test.mjs
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** Distinguishes an OAuth bearer from an sk_live_ API key without a DB round trip. */
export const MCP_ACCESS_TOKEN_PREFIX = 'mcp_at_'
export const MCP_REFRESH_TOKEN_PREFIX = 'mcp_rt_'
export const MCP_CODE_PREFIX = 'mcp_code_'

/** Short by design: the code is exposed in a redirect URL and browser history. */
export const CODE_TTL_MS = 60_000
/**
 * One hour. Short enough that a role change shows up quickly even in the audit
 * `scope` column, long enough that Claude is not refreshing mid-conversation.
 * Enforcement re-derives scopes per request regardless, so this is not the
 * mechanism that bounds a demoted user's access.
 */
export const ACCESS_TTL_MS = 60 * 60 * 1000
/** 60 days, rotated on every use. */
export const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000

/**
 * The only scopes we publish. Permissions do not come from here — they come from
 * the signed-in user's workspace role. `mcp` means "act as me"; `offline_access`
 * asks for a refresh token.
 */
export const MCP_OAUTH_SCOPES = ['mcp', 'offline_access']

/** Claude.ai web / Desktop / mobile / Cowork all use this single callback. */
export const CLAUDE_REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback'

/** Thrown with an RFC 6749 error code so the token endpoint can pass it through. */
export class OauthError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'OauthError'
    this.code = code
    this.status = status
  }
}

export function hashMcpToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function isMcpOauthAccessToken(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && raw.startsWith(MCP_ACCESS_TOKEN_PREFIX)
}

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/**
 * PKCE S256 check (RFC 7636). Claude sends a code_challenge on every
 * authorization request regardless of how the client was registered, so this is
 * never optional. The 43..128 bound is the spec's verifier length.
 */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false
  if (verifier.length < 43 || verifier.length > 128) return false
  const computed = createHash('sha256').update(verifier).digest('base64url')
  return constantTimeEquals(computed, challenge)
}

/** Client id prefix. Not secret — it is half of a public identifier pair. */
export const MCP_CLIENT_ID_PREFIX = 'fran-mcp-'

/**
 * Mint a client id/secret pair for the Claude connector.
 *
 * The id is recognisable so an admin can tell at a glance which field it belongs
 * in; the secret is opaque. Both are compared literally by our own token
 * endpoint, so the only requirement is that the secret be unguessable.
 */
export function generateClientCredentials(): {
  clientId: string
  clientSecret: string
  secretPrefix: string
} {
  const clientId = `${MCP_CLIENT_ID_PREFIX}${randomBytes(6).toString('hex')}`
  const clientSecret = randomBytes(32).toString('base64url')
  return { clientId, clientSecret, secretPrefix: clientSecret.slice(0, 6) }
}

/**
 * Constant-time check of a presented client secret against its stored hash.
 * A null hash means the client was registered as public — no secret to present,
 * and presenting one is not an error.
 */
export function verifyClientSecretHash(
  provided: string | null | undefined,
  storedHash: string | null | undefined,
): boolean {
  if (!storedHash) return true
  if (!provided) return false
  return constantTimeEquals(hashMcpToken(provided), storedHash)
}

export function normaliseResource(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase()
}

/**
 * Compare an RFC 8707 resource indicator against ours.
 *
 * Absent counts as a match: Anthropic notes some identity-provider
 * configurations cannot forward a resource parameter, and rejecting those would
 * break the flow for no security gain (the token is already bound to a user and
 * a client).
 */
export function resourceMatches(
  candidate: string | null | undefined,
  expected: string,
): boolean {
  if (!candidate) return true
  return normaliseResource(candidate) === normaliseResource(expected)
}

/**
 * Negotiate scopes. Unknown values are dropped rather than rejected, and `mcp`
 * is always granted, so a client that sends no scope still gets a usable token.
 */
export function negotiateScopes(requestedScope: string | null | undefined): string {
  const requested = String(requestedScope || '')
    .split(/\s+/)
    .filter(Boolean)
  const granted = MCP_OAUTH_SCOPES.filter((s) => requested.includes(s))
  if (!granted.includes('mcp')) granted.unshift('mcp')
  return granted.join(' ')
}

export function grantIncludesOfflineAccess(scope: string | null | undefined): boolean {
  return String(scope || '')
    .split(/\s+/)
    .includes('offline_access')
}

export type AuthorizeParams = {
  clientId: string
  redirectUri: string
  state: string | null
  codeChallenge: string
  scope: string
  resource: string
}

export type AuthorizeCheck =
  | { ok: true; params: AuthorizeParams }
  | { ok: false; status: number; message: string }

/**
 * Validate an /oauth/authorize query.
 *
 * redirect_uri is checked against an exact allowlist — that check is what stops
 * an attacker pointing a legitimate-looking authorize URL at their own
 * collector. Everything else is reported as a plain error rather than bounced
 * back to the client: Claude always sends well-formed requests, so a failure
 * here means a misconfiguration worth showing to the person on the screen.
 */
export function checkAuthorizeParams(
  query: Record<string, unknown>,
  expected: { clientId: string; redirectUris: string[]; resource: string },
): AuthorizeCheck {
  const clientId = String(query.client_id ?? '').trim()
  if (!clientId || clientId !== expected.clientId) {
    return {
      ok: false,
      status: 400,
      message:
        'Unknown client_id. Check the OAuth Client ID in the Claude connector settings.',
    }
  }

  const redirectUri = String(query.redirect_uri ?? '').trim()
  if (!redirectUri || !expected.redirectUris.includes(redirectUri)) {
    return {
      ok: false,
      status: 400,
      message: `redirect_uri is not registered: ${redirectUri || '(missing)'}`,
    }
  }

  const responseType = String(query.response_type ?? 'code').trim()
  if (responseType !== 'code') {
    return { ok: false, status: 400, message: 'Only response_type=code is supported.' }
  }

  if (String(query.code_challenge_method ?? '').trim() !== 'S256') {
    return { ok: false, status: 400, message: 'code_challenge_method must be S256.' }
  }

  const codeChallenge = String(query.code_challenge ?? '').trim()
  if (!codeChallenge) {
    return { ok: false, status: 400, message: 'code_challenge is required (PKCE).' }
  }

  const resource = query.resource ? String(query.resource).trim() : null
  if (!resourceMatches(resource, expected.resource)) {
    return {
      ok: false,
      status: 400,
      message: `resource must be ${expected.resource} (got ${resource}).`,
    }
  }

  return {
    ok: true,
    params: {
      clientId,
      redirectUri,
      state: query.state ? String(query.state) : null,
      codeChallenge,
      scope: negotiateScopes(query.scope as string | undefined),
      resource: resource || expected.resource,
    },
  }
}

// ---------------------------------------------------------------------------
// Discovery documents
// ---------------------------------------------------------------------------

/** RFC 9728 protected resource metadata — Claude's entry point. */
export function protectedResourceMetadataFor(issuer: string) {
  return {
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    scopes_supported: MCP_OAUTH_SCOPES,
    bearer_methods_supported: ['header'],
    resource_documentation: `${issuer}/help/connect-claude`,
  }
}

/** RFC 8414 authorization server metadata. */
export function authorizationServerMetadataFor(issuer: string, hasClientSecret: boolean) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    // No registration_endpoint: Dynamic Client Registration is deliberately not
    // supported. The admin pastes a pre-registered client id/secret into
    // Claude's Advanced settings, which avoids a new client row per connection
    // and is also the prerequisite for Enterprise Managed Auth later — DCR is
    // incompatible with EMA because the IdP stamps a fixed client_id into every
    // assertion.
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: hasClientSecret
      ? ['client_secret_post', 'client_secret_basic']
      : ['none'],
    scopes_supported: MCP_OAUTH_SCOPES,
    service_documentation: `${issuer}/help/connect-claude`,
  }
}

/**
 * The 401 header that starts the whole flow. Anthropic will not read
 * WWW-Authenticate off a 200 response, so the status matters as much as this.
 * Scheme, space, then comma-separated auth-params (RFC 9110 §11.6.1).
 */
export function unauthorizedHeaderFor(issuer: string): string {
  const params = [
    `resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"`,
    `scope="${MCP_OAUTH_SCOPES.join(' ')}"`,
  ]
  return `Bearer ${params.join(', ')}`
}
