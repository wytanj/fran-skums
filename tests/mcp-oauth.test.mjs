/**
 * Per-user OAuth for the remote MCP connector.
 *
 * The protocol module is pure, so the security-critical decisions (PKCE,
 * redirect_uri allowlisting, resource matching, scope negotiation) are tested by
 * execution. The request- and DB-bound layer pulls in Nitro auto-imports and
 * #supabase/server, which plain node cannot resolve, so its load-bearing
 * invariants are asserted against source instead — each one is a rule that, if
 * quietly dropped, would either break the Claude flow or widen access.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CLAUDE_REDIRECT_URI,
  MCP_ACCESS_TOKEN_PREFIX,
  MCP_CLIENT_ID_PREFIX,
  MCP_OAUTH_SCOPES,
  OauthError,
  authorizationServerMetadataFor,
  checkAuthorizeParams,
  generateClientCredentials,
  grantIncludesOfflineAccess,
  hashMcpToken,
  isMcpOauthAccessToken,
  negotiateScopes,
  protectedResourceMetadataFor,
  resourceMatches,
  unauthorizedHeaderFor,
  verifyClientSecretHash,
  verifyPkceS256,
} from '../server/utils/mcpOauthProtocol.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const ISSUER = 'https://fran-skums.vercel.app'
const RESOURCE = `${ISSUER}/mcp`

function challengeFor(verifier) {
  return createHash('sha256').update(verifier).digest('base64url')
}

function authorizeQuery(overrides = {}) {
  const verifier = 'v'.repeat(64)
  return {
    client_id: 'fran-mcp',
    redirect_uri: CLAUDE_REDIRECT_URI,
    response_type: 'code',
    code_challenge: challengeFor(verifier),
    code_challenge_method: 'S256',
    scope: 'mcp offline_access',
    state: 'xyz123',
    resource: RESOURCE,
    ...overrides,
  }
}

const EXPECTED = {
  clientId: 'fran-mcp',
  redirectUris: [CLAUDE_REDIRECT_URI],
  resource: RESOURCE,
}

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

test('PKCE S256 accepts the matching verifier', () => {
  const verifier = 'a'.repeat(43)
  assert.equal(verifyPkceS256(verifier, challengeFor(verifier)), true)
})

test('PKCE S256 rejects a mismatched verifier', () => {
  const verifier = 'a'.repeat(43)
  assert.equal(verifyPkceS256('b'.repeat(43), challengeFor(verifier)), false)
})

test('PKCE rejects verifiers outside the RFC 7636 length bounds', () => {
  const short = 'a'.repeat(42)
  const long = 'a'.repeat(129)
  assert.equal(verifyPkceS256(short, challengeFor(short)), false)
  assert.equal(verifyPkceS256(long, challengeFor(long)), false)
})

test('PKCE rejects empty inputs rather than treating them as a match', () => {
  assert.equal(verifyPkceS256('', ''), false)
  assert.equal(verifyPkceS256('a'.repeat(43), ''), false)
  assert.equal(verifyPkceS256('', 'challenge'), false)
})

// ---------------------------------------------------------------------------
// Resource indicator (RFC 8707)
// ---------------------------------------------------------------------------

test('resource matching ignores trailing slash and case', () => {
  assert.equal(resourceMatches(`${RESOURCE}/`, RESOURCE), true)
  assert.equal(resourceMatches(RESOURCE.toUpperCase(), RESOURCE), true)
})

test('resource matching rejects a different path', () => {
  assert.equal(resourceMatches(`${ISSUER}/mcp/c/sk_live_x`, RESOURCE), false)
  assert.equal(resourceMatches('https://evil.example.com/mcp', RESOURCE), false)
})

test('absent resource is allowed — some IdPs cannot forward it', () => {
  assert.equal(resourceMatches(null, RESOURCE), true)
  assert.equal(resourceMatches(undefined, RESOURCE), true)
  assert.equal(resourceMatches('', RESOURCE), true)
})

// ---------------------------------------------------------------------------
// Scope negotiation
// ---------------------------------------------------------------------------

test('mcp scope is always granted, even when none is requested', () => {
  assert.equal(negotiateScopes(''), 'mcp')
  assert.equal(negotiateScopes(null), 'mcp')
  assert.equal(negotiateScopes('offline_access'), 'mcp offline_access')
})

test('unknown scopes are dropped, not rejected', () => {
  assert.equal(negotiateScopes('mcp admin:everything'), 'mcp')
})

test('offline_access drives whether a refresh token is issued', () => {
  assert.equal(grantIncludesOfflineAccess('mcp offline_access'), true)
  assert.equal(grantIncludesOfflineAccess('mcp'), false)
  assert.equal(grantIncludesOfflineAccess(null), false)
})

// ---------------------------------------------------------------------------
// Token shape
// ---------------------------------------------------------------------------

test('only access tokens are claimed by the OAuth path', () => {
  assert.equal(isMcpOauthAccessToken(`${MCP_ACCESS_TOKEN_PREFIX}abc`), true)
  // Must not swallow API keys — they fall through to authenticateApiKey.
  assert.equal(isMcpOauthAccessToken('sk_live_abc'), false)
  // A refresh token is not a bearer credential for the MCP endpoint.
  assert.equal(isMcpOauthAccessToken('mcp_rt_abc'), false)
  assert.equal(isMcpOauthAccessToken(null), false)
})

test('tokens are stored as sha256, never in plaintext', () => {
  const raw = `${MCP_ACCESS_TOKEN_PREFIX}secret`
  const hashed = hashMcpToken(raw)
  assert.equal(hashed.length, 64)
  assert.ok(!hashed.includes('secret'))
  assert.equal(hashed, createHash('sha256').update(raw).digest('hex'))
})

// ---------------------------------------------------------------------------
// Client credentials
// ---------------------------------------------------------------------------

test('generated client credentials are recognisable and unguessable', () => {
  const a = generateClientCredentials()
  const b = generateClientCredentials()
  assert.ok(a.clientId.startsWith(MCP_CLIENT_ID_PREFIX))
  assert.notEqual(a.clientId, b.clientId)
  assert.notEqual(a.clientSecret, b.clientSecret)
  // 32 bytes base64url
  assert.ok(a.clientSecret.length >= 40)
  assert.ok(a.clientSecret.startsWith(a.secretPrefix))
})

test('client secret verification is hash-based, not plaintext comparison', () => {
  const { clientSecret } = generateClientCredentials()
  const stored = hashMcpToken(clientSecret)
  assert.equal(verifyClientSecretHash(clientSecret, stored), true)
  assert.equal(verifyClientSecretHash('wrong', stored), false)
  assert.equal(verifyClientSecretHash('', stored), false)
  assert.equal(verifyClientSecretHash(null, stored), false)
})

test('a public client (no stored hash) needs no secret', () => {
  // Mirrors token_endpoint_auth_methods_supported: ["none"].
  assert.equal(verifyClientSecretHash(null, null), true)
  assert.equal(verifyClientSecretHash('anything', null), true)
})

// ---------------------------------------------------------------------------
// Authorize request validation
// ---------------------------------------------------------------------------

test('a well-formed authorize request passes and preserves state', () => {
  const result = checkAuthorizeParams(authorizeQuery(), EXPECTED)
  assert.equal(result.ok, true)
  assert.equal(result.params.state, 'xyz123')
  assert.equal(result.params.scope, 'mcp offline_access')
  assert.equal(result.params.resource, RESOURCE)
})

test('an unregistered redirect_uri is refused', () => {
  const result = checkAuthorizeParams(
    authorizeQuery({ redirect_uri: 'https://evil.example.com/callback' }),
    EXPECTED,
  )
  assert.equal(result.ok, false)
  assert.equal(result.status, 400)
  assert.match(result.message, /redirect_uri is not registered/)
})

test('a missing redirect_uri is refused', () => {
  const q = authorizeQuery()
  delete q.redirect_uri
  const result = checkAuthorizeParams(q, EXPECTED)
  assert.equal(result.ok, false)
})

test('an unknown client_id is refused', () => {
  const result = checkAuthorizeParams(authorizeQuery({ client_id: 'someone-else' }), EXPECTED)
  assert.equal(result.ok, false)
  assert.match(result.message, /client_id/)
})

test('PKCE cannot be downgraded to plain or omitted', () => {
  const plain = checkAuthorizeParams(
    authorizeQuery({ code_challenge_method: 'plain' }),
    EXPECTED,
  )
  assert.equal(plain.ok, false)
  assert.match(plain.message, /S256/)

  const missingMethod = authorizeQuery()
  delete missingMethod.code_challenge_method
  assert.equal(checkAuthorizeParams(missingMethod, EXPECTED).ok, false)

  const noChallenge = checkAuthorizeParams(authorizeQuery({ code_challenge: '' }), EXPECTED)
  assert.equal(noChallenge.ok, false)
  assert.match(noChallenge.message, /PKCE/)
})

test('implicit flow is refused', () => {
  const result = checkAuthorizeParams(authorizeQuery({ response_type: 'token' }), EXPECTED)
  assert.equal(result.ok, false)
  assert.match(result.message, /response_type=code/)
})

test('a resource pointing somewhere else is refused', () => {
  const result = checkAuthorizeParams(
    authorizeQuery({ resource: 'https://evil.example.com/mcp' }),
    EXPECTED,
  )
  assert.equal(result.ok, false)
  assert.match(result.message, /resource must be/)
})

test('an omitted resource defaults to ours', () => {
  const q = authorizeQuery()
  delete q.resource
  const result = checkAuthorizeParams(q, EXPECTED)
  assert.equal(result.ok, true)
  assert.equal(result.params.resource, RESOURCE)
})

// ---------------------------------------------------------------------------
// Discovery documents
// ---------------------------------------------------------------------------

test('protected resource metadata points at this MCP URL and its own issuer', () => {
  const doc = protectedResourceMetadataFor(ISSUER)
  // Anthropic compares `resource` literally against the URL the admin typed.
  assert.equal(doc.resource, RESOURCE)
  assert.deepEqual(doc.authorization_servers, [ISSUER])
  assert.deepEqual(doc.scopes_supported, MCP_OAUTH_SCOPES)
  assert.deepEqual(doc.bearer_methods_supported, ['header'])
})

test('authorization server metadata advertises S256 and the two grants', () => {
  const doc = authorizationServerMetadataFor(ISSUER, true)
  assert.equal(doc.issuer, ISSUER)
  assert.equal(doc.authorization_endpoint, `${ISSUER}/oauth/authorize`)
  assert.equal(doc.token_endpoint, `${ISSUER}/oauth/token`)
  assert.deepEqual(doc.code_challenge_methods_supported, ['S256'])
  assert.deepEqual(doc.grant_types_supported, ['authorization_code', 'refresh_token'])
  assert.deepEqual(doc.response_types_supported, ['code'])
})

test('client_credentials is never advertised — Anthropic does not support it', () => {
  const doc = authorizationServerMetadataFor(ISSUER, true)
  assert.ok(!doc.grant_types_supported.includes('client_credentials'))
})

test('no registration_endpoint: DCR is deliberately unsupported', () => {
  // Also a prerequisite for Enterprise Managed Auth, which is incompatible with DCR.
  const doc = authorizationServerMetadataFor(ISSUER, true)
  assert.ok(!('registration_endpoint' in doc))
})

test('client auth methods follow whether a secret is configured', () => {
  assert.deepEqual(
    authorizationServerMetadataFor(ISSUER, true).token_endpoint_auth_methods_supported,
    ['client_secret_post', 'client_secret_basic'],
  )
  assert.deepEqual(
    authorizationServerMetadataFor(ISSUER, false).token_endpoint_auth_methods_supported,
    ['none'],
  )
})

test('WWW-Authenticate is well formed and points at the protected resource doc', () => {
  const header = unauthorizedHeaderFor(ISSUER)
  assert.ok(header.startsWith('Bearer '))
  assert.match(
    header,
    /resource_metadata="https:\/\/fran-skums\.vercel\.app\/\.well-known\/oauth-protected-resource\/mcp"/,
  )
  assert.match(header, /, scope="mcp offline_access"/)
})

test('OauthError carries an RFC 6749 code and a status', () => {
  const err = new OauthError('invalid_grant', 'nope')
  assert.equal(err.code, 'invalid_grant')
  assert.equal(err.status, 400)
  assert.ok(err instanceof Error)
})

// ---------------------------------------------------------------------------
// Migration 082
// ---------------------------------------------------------------------------

test('migration 082 creates both tables with hashed credentials', () => {
  const sql = read('core/db/082_mcp_oauth.sql')
  assert.match(sql, /create table if not exists public\.mcp_oauth_codes/)
  assert.match(sql, /create table if not exists public\.mcp_oauth_tokens/)
  assert.match(sql, /code_hash\s+text not null unique/)
  assert.match(sql, /access_token_hash\s+text not null unique/)
  assert.match(sql, /refresh_token_hash\s+text unique/)
})

test('migration 082 binds every credential to a user, not just a workspace', () => {
  const sql = read('core/db/082_mcp_oauth.sql')
  // This is the whole point: without user_id there is no per-person permissioning.
  const userRefs = sql.match(/user_id\s+uuid not null references public\.profiles\(id\)/g) || []
  assert.equal(userRefs.length, 2)
})

test('migration 082 supports single-use codes and refresh rotation', () => {
  const sql = read('core/db/082_mcp_oauth.sql')
  assert.match(sql, /consumed_at/)
  assert.match(sql, /rotated_from/)
  assert.match(sql, /revoked_at/)
  assert.match(sql, /revoked_reason/)
})

test('migration 082 keeps token tables out of reach of the anon key', () => {
  const sql = read('core/db/082_mcp_oauth.sql')
  assert.match(sql, /alter table public\.mcp_oauth_codes\s+enable row level security/)
  assert.match(sql, /alter table public\.mcp_oauth_tokens enable row level security/)
  // RLS on with zero policies = service role only.
  assert.ok(!/create policy/i.test(sql))
})

// ---------------------------------------------------------------------------
// Wiring invariants that cannot be executed here
// ---------------------------------------------------------------------------

test('MCP endpoint returns a real 401 with WWW-Authenticate', () => {
  const src = read('server/utils/mcpHttpHandler.ts')
  // Anthropic does not read WWW-Authenticate off a 200, so the status is what
  // bootstraps the whole flow.
  assert.match(src, /setResponseStatus\(event, 401\)/)
  assert.match(src, /setHeader\(event, 'WWW-Authenticate', mcpUnauthorizedHeader\(event\)\)/)
})

test('a bad URL API key still gets the explanatory 200, not an OAuth bounce', () => {
  const src = read('server/utils/mcpHttpHandler.ts')
  assert.match(src, /const urlKeyPresent = Boolean\(\(event\.context as any\)\?\.mcpApiKey\)/)
  assert.match(src, /if \(!urlKeyPresent && \(await anyMcpOauthClient\(\)\)\)/)
  // The legacy path survives.
  assert.match(src, /setResponseStatus\(event, 200\)/)
})

test('WWW-Authenticate is exposed to browser clients via CORS', () => {
  const src = read('server/utils/mcpHttpHandler.ts')
  assert.match(src, /Access-Control-Expose-Headers[\s\S]{0,220}WWW-Authenticate/)
})

test('OAuth tokens are checked before API keys and do not shadow them', () => {
  const src = read('server/utils/remoteMcp.ts')
  assert.match(src, /if \(isMcpOauthAccessToken\(bearer\)\)/)
  assert.match(src, /return authenticateOauthMcp\(event, bearer as string\)/)
  // Falls through for anything that is not an mcp_at_ token.
  assert.match(src, /const ctx = await authenticateApiKey\(event\)/)
})

test('scopes come from live membership, never from the stored token', () => {
  const src = read('server/utils/remoteMcp.ts')
  assert.match(src, /resolveMcpScopesForUser\(\s*client,\s*identity\.workspaceId,\s*identity\.userId,?\s*\)/)
  // A demoted user must lose power on the next request, not at token expiry.
  assert.ok(!/scopes:\s*identity\.scope/.test(src))
})

test('an OAuth request with no resolvable scopes is refused, not silently downgraded', () => {
  const src = read('server/utils/remoteMcp.ts')
  assert.match(src, /if \(!scopes\.length\)[\s\S]{0,400}statusCode: 403/)
})

test('the code is minted against the signed-in user, not the workspace', () => {
  const src = read('server/api/oauth/approve.post.ts')
  assert.match(src, /serverSupabaseUser\(event\)/)
  assert.match(src, /statusCode: 401, statusMessage: 'Sign in to Fran before authorizing\.'/)
  assert.match(src, /mintAuthorizationCode\(db, \{[\s\S]{0,200}userId,/)
})

test('approve re-checks permissions instead of trusting the consent screen', () => {
  const src = read('server/api/oauth/approve.post.ts')
  assert.match(src, /resolveMcpScopesForUser\(db, ws\.workspaceId, userId\)/)
  assert.match(src, /if \(!scopes\.length\)[\s\S]{0,300}statusCode: 403/)
})

test('token endpoint refuses client_credentials with an explanation', () => {
  const src = read('server/routes/oauth/token.post.ts')
  assert.match(src, /unsupported_grant_type/)
  assert.match(src, /client_credentials is not offered/)
})

test('token endpoint returns no-store and rotates refresh tokens', () => {
  const src = read('server/routes/oauth/token.post.ts')
  assert.match(src, /'Cache-Control', 'no-store'/)
  assert.match(src, /grant\.refreshToken \|\| undefined/)
})

test('discovery documents 404 when no client is registered', () => {
  const src = read('server/middleware/mcpOauthMetadata.ts')
  // Shipping this code before credentials exist must not advertise a broken
  // OAuth server — Claude would fail mid-flow instead of falling back.
  assert.match(src, /if \(!\(await anyMcpOauthClient\(\)\)\)[\s\S]{0,200}setResponseStatus\(event, 404\)/)
  assert.match(src, /oauth_not_configured/)
})

// ---------------------------------------------------------------------------
// Migration 083 — client registry
// ---------------------------------------------------------------------------

test('migration 083 stores the client secret hashed, id in the clear', () => {
  const sql = read('core/db/083_mcp_oauth_client_registry.sql')
  assert.match(sql, /create table if not exists public\.mcp_oauth_clients/)
  assert.match(sql, /client_id\s+text not null unique/)
  assert.match(sql, /client_secret_hash\s+text/)
  // The id is half a public identifier pair — hashing it would break the UI.
  assert.ok(!/client_id_hash/.test(sql))
})

test('migration 083 supports rotate and revoke without re-adding the connector', () => {
  const sql = read('core/db/083_mcp_oauth_client_registry.sql')
  assert.match(sql, /rotated_at/)
  assert.match(sql, /revoked_at/)
  assert.match(sql, /secret_prefix/)
})

test('migration 083 keeps the client registry service-role only', () => {
  const sql = read('core/db/083_mcp_oauth_client_registry.sql')
  assert.match(sql, /alter table public\.mcp_oauth_clients enable row level security/)
  assert.ok(!/create policy/i.test(sql))
})

// ---------------------------------------------------------------------------
// Credential management surface
// ---------------------------------------------------------------------------

test('credentials come from the database first, env only as fallback', () => {
  const src = read('server/utils/mcpOauth.ts')
  // Registry queries live in mcpOauthClients.ts so they can be executed in a
  // test rather than pattern-matched — see tests/mcp-oauth-clients.test.mjs.
  assert.match(src, /findMcpOauthClientById\(db \|\| getAdminClient\(\), id\)/)
  assert.match(src, /findAnyMcpOauthClient\(db \|\| getAdminClient\(\)\)/)
  assert.match(src, /return envMcpOauthClient\(\)/)
  // A DB outage must not take the MCP endpoint down: the lookup is wrapped and
  // the fallback runs after the catch. Matched without literal newlines — this
  // repo checks out CRLF on Windows, so anchoring on \n makes the assertion
  // pass in the working copy and fail after a fresh clone.
  assert.match(src, /catch \{[\s\S]{0,300}return envMcpOauthClient\(\)/)
  // The env pair must only answer for its OWN id, never for a stranger's.
  assert.match(src, /env && env\.clientId === id \? env : null/)
})

test('rotation keeps the client_id and replaces only the secret', () => {
  const src = read('server/utils/mcpOauth.ts')
  // Changing the id would force the admin to re-add the whole connector.
  assert.match(src, /client_secret_hash: hashMcpToken\(generated\.clientSecret\)[\s\S]{0,200}rotated_at/)
  assert.match(src, /clientId: current\.client_id as string/)
})

test('the raw secret is never stored and never re-read', () => {
  const src = read('server/utils/mcpOauth.ts')
  // describeMcpOauthClient backs the Settings UI — it must not select the hash
  // into anything it returns.
  assert.match(src, /has_secret: Boolean\(row\.client_secret_hash\)/)
  assert.ok(!/client_secret:\s*row\./.test(src))
})

test('admin routes require workspace admin, not just membership', () => {
  for (const f of [
    'server/api/v1/mcp-oauth/client.get.ts',
    'server/api/v1/mcp-oauth/client.post.ts',
    'server/api/v1/mcp-oauth/client.delete.ts',
    'server/api/v1/mcp-oauth/disconnect.post.ts',
  ]) {
    assert.match(read(f), /requireWorkspaceAccess\(event, client, workspaceId, 'admin'\)/, f)
  }
})

test('create/rotate returns the secret once; status never does', () => {
  assert.match(read('server/api/v1/mcp-oauth/client.post.ts'), /client_secret: result\.clientSecret/)
  const status = read('server/api/v1/mcp-oauth/client.get.ts')
  assert.ok(!/client_secret/.test(status))
})

test('Settings exposes generate, rotate, disable and per-person disconnect', () => {
  const src = read('app/components/ClaudeConnectorSettings.vue')
  assert.match(src, /Generate credentials/)
  assert.match(src, /Rotate secret/)
  assert.match(src, /Disable connector/)
  assert.match(src, /Disconnect/)
  // Rotation is destructive to live refreshes — must warn.
  assert.match(src, /Rotate the client secret\?/)
})

test('Settings warns that a key in the URL breaks per-person permissions', () => {
  const src = read('app/components/ClaudeConnectorSettings.vue')
  assert.match(src, /Do not put an API key in the URL/)
})

test('the connector tab is wired into Settings', () => {
  const src = read('app/pages/settings.vue')
  assert.match(src, /key: 'claude-connector'/)
  assert.match(src, /<ClaudeConnectorSettings :workspace-id=/)
})

test('metadata middleware answers both probe paths for each document', () => {
  const src = read('server/middleware/mcpOauthMetadata.ts')
  assert.match(src, /'\/\.well-known\/oauth-protected-resource'/)
  assert.match(src, /'\/\.well-known\/oauth-protected-resource\/mcp'/)
  assert.match(src, /'\/\.well-known\/oauth-authorization-server'/)
})

test('/oauth/* is excluded from the supabase auto-redirect', () => {
  const src = read('nuxt.config.ts')
  // Otherwise the module bounce drops the authorize query string.
  assert.match(src, /exclude: \[[^\]]*'\/oauth\/\*'/)
  assert.match(src, /mcpOauthClientId: process\.env\.MCP_OAUTH_CLIENT_ID/)
})

test('consent screen names the account and its tool count before granting', () => {
  const src = read('app/pages/oauth/authorize.vue')
  assert.match(src, /Signed in as/)
  assert.match(src, /Use a different account/)
  assert.match(src, /tool_count/)
})

test('consent screen offers a pending invitation instead of dead-ending', () => {
  const src = read('app/pages/oauth/authorize.vue')
  assert.match(src, /Accept invitation/)
  // Accepting goes through the user's own client so accept_invite's auth.uid()
  // email check still applies — a server route with the service key would skip it.
  assert.match(src, /rpc\('accept_invite', \{\s*p_token: invite\.token,?\s*\}\)/)
  // Reload rather than authorise immediately: the tool count only exists after
  // membership does, and it is the thing worth seeing before granting.
  assert.match(src, /await load\(\)/)
})

test('invite lookup is scoped to the signed-in address', () => {
  const src = read('server/api/oauth/authorize-info.get.ts')
  // The service client bypasses RLS, so this filter is the only thing stopping
  // one person's invite token being handed to another.
  assert.match(src, /\.ilike\('email', email\)/)
  assert.match(src, /\.eq\('status', 'pending'\)/)
  // Expired invites must not be offered — accept_invite would refuse them anyway.
  assert.match(src, /\.gt\('expires_at'/)
})

test('a user with no invite still gets the ask-an-owner message', () => {
  const src = read('server/api/oauth/authorize-info.get.ts')
  assert.match(src, /invites\.length[\s\S]{0,200}not a member of any Fran workspace/)
})

test('design doc records the flow and the key-vs-OAuth tradeoff', () => {
  const doc = read('docs/MCP_OAUTH_DESIGN.md')
  assert.match(doc, /authorization_code/)
  assert.match(doc, /client_credentials/)
  assert.match(doc, /claude\.ai\/api\/mcp\/auth_callback/)
  assert.match(doc, /oauth-protected-resource/)
})
