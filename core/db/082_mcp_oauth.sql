-- 082 — Per-user OAuth for the remote MCP endpoint (Claude Enterprise connector).
--
-- Why this exists: a Claude Team/Enterprise organisation stores ONE connector
-- config — one URL, one optional OAuth client id/secret — for the whole org.
-- With the API-key-in-URL scheme that means one key shared by every employee,
-- so everyone gets identical MCP power regardless of their web role. There is
-- no second field to give Fern a different URL than Jeremy.
--
-- OAuth fixes that because the shared part (client id/secret) only identifies
-- Claude as an application; the credential that actually grants data access is
-- an access token minted per employee after they sign in to Fran. Anthropic
-- does not support a client_credentials grant at all — every connection
-- requires a user in the loop — so authorization_code is the only path.
--
-- Deliberately NOT reusing api_keys: an api_keys row is a long-lived secret an
-- admin issues and distributes. These are short-lived tokens the system mints
-- for a user who just proved their identity, they rotate on every refresh, and
-- they carry no scopes of their own (scopes are recomputed from the user's
-- current workspace_members role on every request — see mcpOauth.ts). Storing
-- both in one table would blur "issued secret" with "session artefact" and
-- would make the api_keys UI list dozens of machine-minted rows.
--
-- Scopes are NOT stored on the token on purpose. If we froze them at consent
-- time, demoting someone in the web app would leave their Claude connection
-- with yesterday's permissions until the token expired. The `scope` column
-- below records only what was *granted at consent* for audit; enforcement
-- always re-derives from live membership.

-- ---------------------------------------------------------------------------
-- Authorization codes (single-use, ~60s)
-- ---------------------------------------------------------------------------
create table if not exists public.mcp_oauth_codes (
  id              uuid primary key default uuid_generate_v4(),

  -- SHA-256 of the code. The raw value only ever exists in the redirect URL.
  code_hash       text not null unique,

  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  -- The person who authorised. This is the whole point of the table.
  user_id         uuid not null references public.profiles(id) on delete cascade,

  client_id       text not null,
  redirect_uri    text not null,

  -- PKCE (RFC 7636). Claude always sends S256; we reject anything else.
  code_challenge  text not null,
  code_challenge_method text not null default 'S256',

  -- RFC 8707 resource indicator — the MCP URL the token is for.
  resource        text,
  scope           text,

  expires_at      timestamptz not null,
  -- Set on first exchange. A second exchange with the same code is an attack
  -- signal, not a retry: RFC 6749 requires single use.
  consumed_at     timestamptz,

  created_at      timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_codes_expires
  on public.mcp_oauth_codes (expires_at);

-- ---------------------------------------------------------------------------
-- Access + refresh tokens
-- ---------------------------------------------------------------------------
create table if not exists public.mcp_oauth_tokens (
  id                  uuid primary key default uuid_generate_v4(),

  access_token_hash   text not null unique,
  -- Null when the grant was issued without offline_access.
  refresh_token_hash  text unique,

  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  user_id             uuid not null references public.profiles(id) on delete cascade,

  client_id           text not null,
  resource            text,
  -- Audit only. Enforcement re-derives scopes from live membership per request.
  scope               text,

  expires_at          timestamptz not null,
  -- Refresh tokens outlive the access token; null means non-expiring refresh.
  refresh_expires_at  timestamptz,

  -- Rotation chain. Claude is registered as a confidential client here, but we
  -- rotate anyway so a leaked refresh token has a bounded useful life, and so
  -- reuse of a rotated token is detectable.
  rotated_from        uuid references public.mcp_oauth_tokens(id) on delete set null,
  revoked_at          timestamptz,
  revoked_reason      text,

  last_used_at        timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_tokens_user
  on public.mcp_oauth_tokens (workspace_id, user_id)
  where revoked_at is null;

create index if not exists idx_mcp_oauth_tokens_expires
  on public.mcp_oauth_tokens (expires_at)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Security posture: service role only.
--
-- Same rule as skums_migrations — RLS on, zero policies for anon/authenticated.
-- These rows are bearer-credential material; the Supabase public URL + anon key
-- must not be able to read them even with a valid user session. Every access
-- path goes through the Nitro server with the service-role key.
-- ---------------------------------------------------------------------------
alter table public.mcp_oauth_codes  enable row level security;
alter table public.mcp_oauth_tokens enable row level security;

comment on table public.mcp_oauth_codes is
  'Single-use OAuth authorization codes for the remote MCP connector. Service role only.';
comment on table public.mcp_oauth_tokens is
  'Per-user OAuth access/refresh tokens for the remote MCP connector. Scopes are re-derived from live workspace_members on every request; the scope column is audit only. Service role only.';
