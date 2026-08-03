-- 083 — Move the MCP OAuth client credentials from env vars into the database.
--
-- 082 shipped the flow with MCP_OAUTH_CLIENT_ID / MCP_OAUTH_CLIENT_SECRET read
-- from the environment. That works but makes rotation an infrastructure task:
-- edit Vercel, redeploy, hope nobody was mid-flow. Rotation is the operation
-- most likely to be needed in a hurry (someone pasted the secret into a ticket,
-- a laptop walked off), so it should not require a deploy.
--
-- Here the pair is a row an owner creates from Settings, and rotation is a
-- button. The env vars stay supported as a fallback so existing deployments and
-- local dev keep working with no migration of configuration.
--
-- Secret handling mirrors api_keys: SHA-256 at rest, raw value shown once at
-- creation. Unlike api_keys there is normally exactly one live row — this
-- identifies Claude-as-an-application, not a person, so there is nothing to
-- issue per user. (@see core/db/082_mcp_oauth.sql for why that distinction
-- matters and where per-user identity actually comes from.)
--
-- client_id is NOT secret. It is half of a public identifier pair and is shown
-- in the UI whenever asked, so it stays plaintext.

create table if not exists public.mcp_oauth_clients (
  id                  uuid primary key default uuid_generate_v4(),

  -- Owning workspace, for audit and for scoping the Settings UI. Authorization
  -- does NOT depend on this: a token's workspace comes from the signed-in user
  -- at consent time, so a client row cannot grant access to a workspace.
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,

  -- What the admin pastes into Claude's "OAuth Client ID" field.
  client_id           text not null unique,

  -- SHA-256 of the secret. Null = public client (no secret required), which the
  -- discovery document advertises as token_endpoint_auth_methods_supported:
  -- ["none"]. Prefer a secret.
  client_secret_hash  text,
  -- First few characters, so the UI can show which secret is live without
  -- being able to reveal it.
  secret_prefix       text,

  label               text,

  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  -- Set when the secret is replaced in place. Existing access tokens keep
  -- working; refreshes fail until Claude is updated with the new secret.
  rotated_at          timestamptz,
  last_used_at        timestamptz,

  revoked_at          timestamptz,
  revoked_reason      text
);

-- Lookup path on every token exchange and every discovery read.
create index if not exists idx_mcp_oauth_clients_live
  on public.mcp_oauth_clients (client_id)
  where revoked_at is null;

create index if not exists idx_mcp_oauth_clients_workspace
  on public.mcp_oauth_clients (workspace_id)
  where revoked_at is null;

-- Service role only, same posture as the token tables in 082: RLS on, no
-- policies for anon/authenticated. The secret hash must not be readable with
-- the public anon key even by a signed-in owner; the Settings UI reads it
-- through a server route that returns metadata only.
alter table public.mcp_oauth_clients enable row level security;

comment on table public.mcp_oauth_clients is
  'Registered OAuth client (id + hashed secret) for the Claude MCP connector. Identifies Claude as an application, not a user — per-user identity comes from mcp_oauth_tokens.user_id. Service role only.';
comment on column public.mcp_oauth_clients.client_secret_hash is
  'SHA-256 of the client secret. Raw value is shown once at creation and never again. Null means a public client.';
