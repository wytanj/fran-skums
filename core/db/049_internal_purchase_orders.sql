-- ============================================================
-- SKUMS — Internal purchase orders (Fran buying / study pipeline)
--
-- Distinct from inventory.purchase_orders (supplier inbound ops).
-- These are decision-layer POs from MCP/study before/alongside inventory.
--
-- Run AFTER: 048_study_pipeline.sql
-- ============================================================

create table if not exists public.internal_purchase_orders (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  po_number             text not null,
  status                text not null default 'draft'
    check (status in (
      'draft', 'pending_approval', 'approved', 'rejected',
      'ordered', 'cancelled'
    )),

  supplier_name         text,
  currency              text not null default 'SGD',
  needed_by             date,
  notes                 text,

  study_session_id      uuid references public.study_sessions(id) on delete set null,
  pipeline_candidate_id uuid references public.pipeline_candidates(id) on delete set null,

  subtotal              numeric(14, 4) not null default 0,
  line_count            integer not null default 0,

  created_by            uuid references public.profiles(id) on delete set null,
  submitted_by          uuid references public.profiles(id) on delete set null,
  submitted_at          timestamptz,
  approved_by           uuid references public.profiles(id) on delete set null,
  approved_at           timestamptz,
  decision_note         text,

  idempotency_key       text,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, po_number)
);

create unique index if not exists idx_internal_pos_idempotency
  on public.internal_purchase_orders(workspace_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_internal_pos_workspace_status
  on public.internal_purchase_orders(workspace_id, status, created_at desc);

create index if not exists idx_internal_pos_study
  on public.internal_purchase_orders(study_session_id)
  where study_session_id is not null;

alter table public.internal_purchase_orders enable row level security;

drop policy if exists "Members can view internal purchase orders"
  on public.internal_purchase_orders;
create policy "Members can view internal purchase orders"
  on public.internal_purchase_orders for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage internal purchase orders"
  on public.internal_purchase_orders;
create policy "Members can manage internal purchase orders"
  on public.internal_purchase_orders for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.internal_purchase_orders
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.internal_purchase_orders;
create trigger set_updated_at before update on public.internal_purchase_orders
  for each row execute function public.update_updated_at();


create table if not exists public.internal_purchase_order_lines (
  id                    uuid primary key default uuid_generate_v4(),
  po_id                 uuid not null references public.internal_purchase_orders(id) on delete cascade,
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  line_number           integer not null default 1,
  product_id            uuid references public.products(id) on delete set null,
  listing_id            uuid references public.marketplace_listings(id) on delete set null,

  title                 text not null,
  sku                   text,
  quantity              numeric(14, 4) not null check (quantity > 0),
  unit_cost             numeric(14, 4) not null default 0,
  currency              text not null default 'SGD',
  line_total            numeric(14, 4) not null default 0,

  marketplace           text,
  shop_id               text,
  item_id               text,
  listing_url           text,
  notes                 text,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_internal_po_lines_po
  on public.internal_purchase_order_lines(po_id, line_number);

create index if not exists idx_internal_po_lines_workspace
  on public.internal_purchase_order_lines(workspace_id);

alter table public.internal_purchase_order_lines enable row level security;

drop policy if exists "Members can view internal po lines"
  on public.internal_purchase_order_lines;
create policy "Members can view internal po lines"
  on public.internal_purchase_order_lines for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Members can manage internal po lines"
  on public.internal_purchase_order_lines;
create policy "Members can manage internal po lines"
  on public.internal_purchase_order_lines for all
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.internal_purchase_order_lines
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.internal_purchase_order_lines;
create trigger set_updated_at before update on public.internal_purchase_order_lines
  for each row execute function public.update_updated_at();
