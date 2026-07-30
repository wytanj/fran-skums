-- 078 — Track RP-8: cache Shopee Mall aggregate reads.
--
-- Why cache at all: the harvest changes weekly at most, but an agent may ask
-- the same aggregate question several times in one conversation, and several
-- agents may ask it in the same week. market_brand_rollup costs ~0.8–1.0s of
-- Postgres work each time to return an answer that cannot have changed.
--
-- Why a table rather than in-process memory: the control plane is Vercel
-- serverless. Process memory does not survive between invocations, so an
-- in-memory cache would miss almost always while still adding a code path.
--
-- Invalidation is by DATA VERSION, not TTL. A TTL would either serve stale
-- numbers after a harvest or expire pointlessly during a quiet week. The
-- version is derived from the workspace's snapshot state (latest crawl +
-- row count), so a new harvest write invalidates every affected entry with
-- no explicit purge, and nothing else does.
--
-- Deliberately shipped LAST in the track: caching before RP-1/4/5 settled the
-- response shapes would have cached wrong answers in a format we then changed.

create table if not exists public.marketplace_query_cache (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  -- Stable hash of (tool, normalised filters). Built by the caller.
  cache_key     text not null,
  -- Snapshot-state fingerprint; a mismatch means the underlying data moved.
  data_version  text not null,

  payload       jsonb not null,
  computed_ms   integer,
  hits          integer not null default 0,
  created_at    timestamptz not null default now(),
  last_hit_at   timestamptz,

  unique (workspace_id, cache_key)
);

comment on table public.marketplace_query_cache is
  'RP-8: memoised Shopee Mall aggregate responses. Invalidated by data_version (snapshot fingerprint), not by TTL — a harvest write changes the version and every stale entry is bypassed.';
comment on column public.marketplace_query_cache.data_version is
  'Fingerprint of the workspace snapshot state (max crawled_at + row count). Row is only a hit when this still matches.';

create index if not exists idx_marketplace_query_cache_lookup
  on public.marketplace_query_cache (workspace_id, cache_key, data_version);

-- Housekeeping: entries whose data_version is stale are dead weight. Nothing
-- reads them, but they should not accumulate forever.
create index if not exists idx_marketplace_query_cache_age
  on public.marketplace_query_cache (created_at);

alter table public.marketplace_query_cache enable row level security;

drop policy if exists "Members read marketplace query cache"
  on public.marketplace_query_cache;
create policy "Members read marketplace query cache"
  on public.marketplace_query_cache for select
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = marketplace_query_cache.workspace_id
        and m.user_id = auth.uid()
    )
  );

-- Writes come from the service role (MCP / API), never the browser.
drop policy if exists "Service role manages marketplace query cache"
  on public.marketplace_query_cache;
create policy "Service role manages marketplace query cache"
  on public.marketplace_query_cache for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

/**
 * Cheap fingerprint of a workspace's snapshot state.
 *
 * One indexed aggregate over (workspace_id, crawled_at) — far cheaper than the
 * rollup it guards. Count is included so a backfill that rewrites rows without
 * advancing crawled_at still busts the cache.
 */
create or replace function public.marketplace_data_version(p_workspace_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    to_char(max(crawled_at), 'YYYYMMDDHH24MISS') || '-' || count(*)::text,
    'empty'
  )
  from public.marketplace_listing_snapshots
  where workspace_id = p_workspace_id;
$$;

grant execute on function public.marketplace_data_version to authenticated, service_role;
