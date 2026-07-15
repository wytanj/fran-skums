-- ============================================================
-- 063 — API keys: bind to user, kind, package, soft revoke (A2)
-- Align MCP key power with web login permissions.
-- Run AFTER: 010_api_keys.sql, 015_organizations.sql
-- ============================================================

alter table public.api_keys
  add column if not exists bound_user_id uuid references public.profiles(id) on delete set null;

alter table public.api_keys
  add column if not exists key_kind text not null default 'general';

alter table public.api_keys
  add column if not exists max_package text;

alter table public.api_keys
  add column if not exists revoked_at timestamptz;

alter table public.api_keys
  add column if not exists revoked_by uuid references public.profiles(id) on delete set null;

-- Constrain kind loosely (app enforces enums)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'api_keys_key_kind_check'
  ) then
    alter table public.api_keys
      add constraint api_keys_key_kind_check
      check (key_kind in ('general', 'mcp_connector', 'pos', 'integration'));
  end if;
end $$;

create index if not exists idx_api_keys_bound_user
  on public.api_keys(workspace_id, bound_user_id)
  where bound_user_id is not null;

create index if not exists idx_api_keys_revoked
  on public.api_keys(workspace_id, revoked_at)
  where revoked_at is not null;

comment on column public.api_keys.bound_user_id is 'Key power capped by this member web scopes (A2)';
comment on column public.api_keys.key_kind is 'general | mcp_connector | pos | integration';
comment on column public.api_keys.max_package is 'e.g. mcp:ops_safe, mcp:viewer — template ceiling';
comment on column public.api_keys.revoked_at is 'Soft revoke timestamp; prefer over delete for audit';
