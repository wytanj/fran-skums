-- ============================================================
-- 071 — Lock down public.skums_migrations (Supabase Advisor)
--
-- Table is used only by scripts/migrate.mjs over SUPABASE_DB_URL
-- (postgres role bypasses RLS). Public/anon must not read it.
-- ============================================================

create table if not exists public.skums_migrations (
  version text primary key,
  name text not null,
  checksum text not null,
  applied_at timestamptz not null default now()
);

alter table public.skums_migrations enable row level security;

-- No policies for anon/authenticated → no API access via RLS
-- service_role / postgres (migrate runner) bypass RLS

revoke all on table public.skums_migrations from anon, authenticated;
grant select, insert, update, delete on table public.skums_migrations to service_role;

comment on table public.skums_migrations is
  'SKUMS migration runner ledger (scripts/migrate.mjs). RLS on; not for client access.';
