# Per-user MCP auth for the Claude Enterprise connector

**Status:** built, not deployed. Migrations `082_mcp_oauth.sql` and
`083_mcp_oauth_client_registry.sql`. Inert until an owner generates credentials in
**Settings → Claude Connector** (or `MCP_OAUTH_CLIENT_ID` is set as a fallback).

## The problem

A Claude Team/Enterprise organisation stores **one connector config** — one URL, one
optional OAuth Client ID, one optional Client Secret. Under the existing scheme the
credential lives in that URL (`/mcp?api_key=sk_live_…`), so:

- every employee in the Claude org shares one identity and one permission set
- there is no second field in which to give Fern a different URL than Jeremy
- the secret sits in a query string, which Anthropic's own docs call a vulnerability
  and the MCP spec prohibits
- offboarding means finding and rotating a key rather than removing a membership row

The web app already knows each employee's role. Nothing carried that into MCP.

## Why OAuth, and why not a key per person

`client_credentials` is not an option: Anthropic states plainly that a
machine-to-machine grant with no user in the loop is **not supported** — "every
connection requires user consent". `authorization_code` + PKCE is the only path.

The thing that makes this work is that the **shared** part of the config grants
nothing. Client ID and Secret identify *Claude as an application*. The credential
that grants data access is an access token minted per employee after they sign in to
Fran. One connector config, nine identities.

| | Key in URL | Key in request header (beta) | OAuth |
|---|---|---|---|
| Connector configs for 9 staff | 9 | 9 | **1** |
| Per-person permissions | no | no | **yes** |
| Secret in logs / history | yes | no | no |
| Offboarding | rotate the key | rotate the key | remove from `workspace_members` |
| Audit trail | which key | which key | **which person** |
| User action | none | none | one click, once |

Keys are **not** removed. They remain correct for scripts, cron, Claude Code, and
any single-identity integration. OAuth is additive.

## Flow

```
Admin, once:  Claude → Admin settings → Connectors → Add custom connector
              URL    = https://fran-skums.vercel.app/mcp
              Advanced settings → OAuth Client ID + Secret

Employee, once ever:
  1. Claude → Settings → Connectors → Fran → Connect
  2. Claude GET /mcp                          → 401 + WWW-Authenticate: Bearer
                                                  resource_metadata="…/.well-known/
                                                  oauth-protected-resource/mcp"
  3. Claude GET /.well-known/oauth-protected-resource/mcp
                                              → { resource, authorization_servers }
  4. Claude GET /.well-known/oauth-authorization-server
                                              → { authorize, token, S256 }
  5. Browser → /oauth/authorize?client_id&redirect_uri&code_challenge&state&resource
       no Fran session → /auth/login?redirect=<full authorize URL> → Google SSO → back
       session         → consent screen: "Signed in as fern@heyfran.com · 14 tools"
  6. POST /api/oauth/approve                  → code bound to THAT user_id
       → 302 https://claude.ai/api/mcp/auth_callback?code&state
  7. Claude POST /oauth/token (authorization_code + code_verifier)
                                              → access_token (1h) + refresh_token (60d)

Every later call:  Authorization: Bearer mcp_at_…
                   → token row → user_id → live workspace_members role → scopes
```

Nothing is cached on the token. **Scopes are re-derived from live membership on every
request**, so demoting someone in the web app takes effect on their next Claude
message rather than at token expiry.

## Files

| Path | Role |
|---|---|
| `core/db/082_mcp_oauth.sql` | `mcp_oauth_codes`, `mcp_oauth_tokens`. RLS on, no policies — service role only. |
| `core/db/083_mcp_oauth_client_registry.sql` | `mcp_oauth_clients` — the client id + hashed secret, so rotation is a button not a redeploy. |
| `app/components/ClaudeConnectorSettings.vue` | Settings → Claude Connector: generate, rotate, disable, see who's connected, disconnect. |
| `server/api/v1/mcp-oauth/*` | Admin-only CRUD behind `requireWorkspaceAccess(…, 'admin')`. |
| `server/utils/mcpOauthProtocol.ts` | Pure protocol: PKCE, redirect allowlist, resource match, scope negotiation, discovery docs. No Nitro deps, so it is unit-tested by execution. |
| `server/utils/mcpOauth.ts` | Request- and DB-bound layer: client config, issuer, code/token mint, rotation, token lookup, scope resolution. |
| `server/middleware/mcpOauthMetadata.ts` | Serves both `.well-known` documents, all probe path variants. |
| `server/routes/oauth/token.post.ts` | `authorization_code` + `refresh_token`. Form-urlencoded, RFC 6749 error codes. |
| `server/api/oauth/authorize-info.get.ts` | Backs the consent screen. |
| `server/api/oauth/approve.post.ts` | Mints the code against `serverSupabaseUser(event)`. The identity gate. |
| `app/pages/oauth/authorize.vue` | Consent screen. |
| `server/utils/remoteMcp.ts` | `authenticateRemoteMcp` checks OAuth bearer first, falls through to API key. |
| `server/utils/mcpHttpHandler.ts` | Real 401 + `WWW-Authenticate` when no credential; keeps the 200 path for bad URL keys. |

## Decisions

**Separate tables, not `api_keys`.** An `api_keys` row is a long-lived secret an admin
issues and distributes. These are short-lived artefacts the system mints for someone
who just proved their identity, they rotate on every refresh, and they carry no scopes
of their own. Sharing one table would blur the two and fill the API-keys UI with
machine-minted rows.

**Scopes are audit-only on the token.** Freezing them at consent time would leave a
demoted employee's Claude connection holding yesterday's permissions. The `scope`
column records what was granted; enforcement always recomputes.

**Reuses the A2 pipeline verbatim.** `resolveMcpScopesForUser` hands
`resolveEffectiveScopesForApiKey` a synthetic key row bound to the user, carrying the
default package for their role. An OAuth connection therefore behaves exactly like
the key an admin *would* have issued for that person — one permission model, no second
implementation to drift.

**No Dynamic Client Registration.** DCR would create a fresh client row on every
connection. The admin pastes a pre-registered pair instead. This is also a
prerequisite for Enterprise Managed Auth later, which is incompatible with DCR
because the IdP stamps a fixed `client_id` into every assertion.

**A real 401.** Anthropic will not read `WWW-Authenticate` off a 200 response. The
handler previously forced 200 for every auth failure because some MCP clients render
401 as "couldn't reach"; that behaviour is preserved for the API-key path and
overridden only when there is no URL key to explain and OAuth is configured.

**Middleware, not `server/routes/.well-known/`.** Dot-prefixed directories are not
reliably picked up by file-based route scanners, and Claude probes several path
variants for the same document. One matcher, no dependency on build-time globbing.

**A consent screen, though Claude already shows one.** Ours names the account and the
tool count. Without it, someone signed into a personal Google account authorises
silently and then reports "Claude can't see my stock" with nothing on screen to
explain why.

**Inert until credentials exist.** No client row and no env var → discovery 404s, the
401 path is skipped, nothing changes. Safe to ship ahead of setup.

**Client credentials in the database, not env vars.** Rotation is the operation most
likely to be needed in a hurry, and as env vars it means editing Vercel and
redeploying. As a row it is a button. A DB read failure falls back to env rather than
taking the MCP endpoint down. Rotation keeps the same `client_id` and replaces only
the secret, so the admin updates one field in Claude instead of re-adding the
connector; live access tokens survive, refreshes fail until Claude has the new value.

## Deploy

1. Apply the migrations:
   ```sh
   node scripts/migrate.mjs --only 082
   node scripts/migrate.mjs --only 083
   ```
2. Deploy, then **Settings → Claude Connector → Generate credentials**. Copy the
   secret — it is shown once.
3. No env vars needed. `MCP_OAUTH_CLIENT_ID` / `MCP_OAUTH_CLIENT_SECRET` still work as
   a fallback for local dev, and a database row takes precedence over them.
4. Verify:
   ```
   curl -s https://fran-skums.vercel.app/.well-known/oauth-protected-resource/mcp
   curl -s https://fran-skums.vercel.app/.well-known/oauth-authorization-server
   curl -si -X POST https://fran-skums.vercel.app/mcp \
     -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -20
   # expect: HTTP/2 401 + WWW-Authenticate: Bearer resource_metadata="…"
   ```
5. In Claude: Admin settings → Connectors → Add custom connector → URL + Advanced
   settings → paste the pair. Then Connect as yourself and confirm the consent screen
   shows your email and a non-zero tool count.

## Open items

- **`requireScope` admin elevation.** `isWorkspaceAdmin` grants a large hardcoded scope
  set, so per-person differentiation only bites for non-admins. Unchanged here — it is
  a separate decision.
- **`inbound_create_draft` scope mismatch.** MCP requires `store_ops:write`, the GUI
  requires `store_ops:inbound`. MCP is the more permissive of the two. Unchanged:
  tightening it revokes capability from live keys.
- **`tools/list` caching.** The list now varies per user. If a client caches it across
  accounts, one person could see another's tool names (not their data).
- **Enterprise Managed Auth.** Removes even the one-time Connect click by exchanging an
  IdP-signed JWT (RFC 7523) at `/oauth/token`. Beta and waitlist-gated. Adding it later
  means advertising `urn:ietf:params:oauth:grant-type:jwt-bearer` in
  `grant_types_supported` plus a trusted-issuer allowlist — the endpoint is already
  shaped for a second grant type.
- **Request headers (beta).** Anthropic's `static_headers` would move the shared key out
  of the query string without any of this work. Worth requesting for the
  script/cron path.
