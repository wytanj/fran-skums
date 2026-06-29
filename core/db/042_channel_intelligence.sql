-- ============================================================
-- SKUMS Channel Intelligence
--
-- Purpose:
--   Store channel capabilities, listing rules, content variants,
--   promotions, fulfillment policy, fee snapshots, and listing
--   quality findings as headless commerce primitives.
--
-- Run AFTER: 041_product_attention_items.sql
-- ============================================================

create table if not exists public.channel_capabilities (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid references public.workspaces(id) on delete cascade,
  channel_id      uuid references public.channels(id) on delete cascade,
  channel_key     text not null,

  capability_key  text not null check (capability_key ~ '^[a-z0-9][a-z0-9_.:-]*$'),
  support_level   text not null default 'supported'
    check (support_level in ('supported', 'unsupported', 'conditional', 'unknown')),
  direction       text not null default 'bidirectional'
    check (direction in ('inbound', 'outbound', 'bidirectional', 'none')),
  config_schema   jsonb not null default '{}',
  constraints     jsonb not null default '{}',
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists idx_channel_capabilities_unique
  on public.channel_capabilities(
    coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(channel_id, '00000000-0000-0000-0000-000000000000'::uuid),
    channel_key,
    capability_key
  );

create index if not exists idx_channel_capabilities_workspace
  on public.channel_capabilities(workspace_id, channel_key);

alter table public.channel_capabilities enable row level security;

create policy "Anyone can view global channel capabilities"
  on public.channel_capabilities for select
  using (workspace_id is null);

create policy "Members can view channel capabilities"
  on public.channel_capabilities for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Admins can manage channel capabilities"
  on public.channel_capabilities for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

create trigger set_updated_at before update on public.channel_capabilities
  for each row execute function public.update_updated_at();


create table if not exists public.channel_requirements (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid references public.workspaces(id) on delete cascade,
  channel_id          uuid references public.channels(id) on delete cascade,
  channel_key         text not null,

  requirement_key     text not null check (requirement_key ~ '^[a-z0-9][a-z0-9_.:-]*$'),
  requirement_type    text not null default 'field'
    check (requirement_type in ('field', 'content', 'identifier', 'image', 'price', 'inventory', 'fulfillment', 'policy', 'other')),
  target_object       text not null default 'listing'
    check (target_object in ('product_identity', 'trade_unit', 'listing', 'offer', 'image', 'fulfillment_policy', 'promotion')),
  severity            text not null default 'required'
    check (severity in ('required', 'recommended', 'optional', 'blocked')),
  rule_expression     jsonb not null default '{}',
  validation_schema   jsonb not null default '{}',
  remediation_hint    text,
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists idx_channel_requirements_unique
  on public.channel_requirements(
    coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(channel_id, '00000000-0000-0000-0000-000000000000'::uuid),
    channel_key,
    requirement_key
  );

create index if not exists idx_channel_requirements_lookup
  on public.channel_requirements(workspace_id, channel_key, severity);

alter table public.channel_requirements enable row level security;

create policy "Anyone can view global channel requirements"
  on public.channel_requirements for select
  using (workspace_id is null);

create policy "Members can view channel requirements"
  on public.channel_requirements for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Admins can manage channel requirements"
  on public.channel_requirements for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

create trigger set_updated_at before update on public.channel_requirements
  for each row execute function public.update_updated_at();


create table if not exists public.channel_offer_rules (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  channel_id          uuid references public.channels(id) on delete set null,
  channel_key         text not null,

  rule_key            text not null check (rule_key ~ '^[a-z0-9][a-z0-9_.:-]*$'),
  rule_type           text not null default 'pricing'
    check (rule_type in ('pricing', 'inventory', 'availability', 'min_max_price', 'bundle', 'channel_policy', 'other')),
  status              text not null default 'active'
    check (status in ('draft', 'active', 'paused', 'archived')),
  priority            integer not null default 100,
  conditions          jsonb not null default '{}',
  actions             jsonb not null default '{}',
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (workspace_id, channel_key, rule_key)
);

create index if not exists idx_channel_offer_rules_channel
  on public.channel_offer_rules(workspace_id, channel_key, status, priority);

alter table public.channel_offer_rules enable row level security;

create policy "Members can view channel offer rules"
  on public.channel_offer_rules for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage channel offer rules"
  on public.channel_offer_rules for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.channel_offer_rules
  for each row execute function public.update_updated_at();


create table if not exists public.listing_content_variants (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  listing_id            uuid references public.listings(id) on delete cascade,
  channel_id            uuid references public.channels(id) on delete set null,
  product_identity_id   uuid references public.product_identities(id) on delete set null,
  trade_unit_id         uuid references public.trade_units(id) on delete set null,

  variant_key           text not null check (variant_key ~ '^[a-z0-9][a-z0-9_.:-]*$'),
  locale                text,
  market                text,
  status                text not null default 'draft'
    check (status in ('draft', 'ready', 'active', 'rejected', 'archived')),
  title                 text,
  subtitle              text,
  description           text,
  bullet_points         text[] not null default '{}',
  attributes            jsonb not null default '{}',
  media                 jsonb not null default '[]',
  quality_score         numeric(6,2),
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, listing_id, variant_key)
);

create index if not exists idx_listing_content_variants_listing
  on public.listing_content_variants(listing_id)
  where listing_id is not null;

create index if not exists idx_listing_content_variants_identity
  on public.listing_content_variants(product_identity_id)
  where product_identity_id is not null;

alter table public.listing_content_variants enable row level security;

create policy "Members can view listing content variants"
  on public.listing_content_variants for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage listing content variants"
  on public.listing_content_variants for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.listing_content_variants
  for each row execute function public.update_updated_at();


create table if not exists public.promotion_events (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  channel_id          uuid references public.channels(id) on delete set null,
  listing_id          uuid references public.listings(id) on delete set null,

  promotion_key       text not null check (promotion_key ~ '^[a-z0-9][a-z0-9_.:-]*$'),
  external_id         text,
  name                text not null,
  promotion_type      text not null default 'discount'
    check (promotion_type in ('discount', 'bundle', 'voucher', 'ad', 'campaign', 'flash_sale', 'other')),
  status              text not null default 'draft'
    check (status in ('draft', 'scheduled', 'active', 'ended', 'cancelled', 'archived')),
  starts_at           timestamptz,
  ends_at             timestamptz,
  budget              numeric(14,4),
  currency            text,
  rules               jsonb not null default '{}',
  performance         jsonb not null default '{}',
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (workspace_id, promotion_key)
);

create index if not exists idx_promotion_events_window
  on public.promotion_events(workspace_id, status, starts_at, ends_at);

alter table public.promotion_events enable row level security;

create policy "Members can view promotion events"
  on public.promotion_events for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage promotion events"
  on public.promotion_events for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.promotion_events
  for each row execute function public.update_updated_at();


create table if not exists public.fulfillment_policies (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  channel_id          uuid references public.channels(id) on delete set null,

  policy_key          text not null check (policy_key ~ '^[a-z0-9][a-z0-9_.:-]*$'),
  name                text not null,
  status              text not null default 'active'
    check (status in ('draft', 'active', 'paused', 'archived')),
  market              text,
  service_level       text,
  lead_time_days      integer,
  ship_from_location_id uuid references public.inventory_locations(id) on delete set null,
  return_window_days  integer,
  rules               jsonb not null default '{}',
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (workspace_id, policy_key)
);

create index if not exists idx_fulfillment_policies_channel
  on public.fulfillment_policies(workspace_id, channel_id, status)
  where channel_id is not null;

alter table public.fulfillment_policies enable row level security;

create policy "Members can view fulfillment policies"
  on public.fulfillment_policies for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage fulfillment policies"
  on public.fulfillment_policies for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.fulfillment_policies
  for each row execute function public.update_updated_at();


create table if not exists public.channel_fee_snapshots (
  id                  uuid primary key default uuid_generate_v4(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  channel_id          uuid references public.channels(id) on delete set null,
  listing_id          uuid references public.listings(id) on delete set null,

  fee_key             text not null check (fee_key ~ '^[a-z0-9][a-z0-9_.:-]*$'),
  fee_type            text not null default 'commission'
    check (fee_type in ('commission', 'payment', 'fulfillment', 'advertising', 'storage', 'subscription', 'other')),
  market              text,
  currency            text,
  basis               text not null default 'percentage'
    check (basis in ('percentage', 'fixed', 'tiered', 'formula')),
  amount              numeric(14,4),
  formula             jsonb not null default '{}',
  effective_from      timestamptz,
  effective_to        timestamptz,
  source              text not null default 'manual'
    check (source in ('manual', 'connector', 'import', 'api', 'system')),
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now()
);

create unique index if not exists idx_channel_fee_snapshots_unique
  on public.channel_fee_snapshots(
    workspace_id,
    fee_key,
    coalesce(listing_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(effective_from, '-infinity'::timestamptz)
  );

create index if not exists idx_channel_fee_snapshots_lookup
  on public.channel_fee_snapshots(workspace_id, channel_id, fee_type, created_at desc);

alter table public.channel_fee_snapshots enable row level security;

create policy "Members can view channel fee snapshots"
  on public.channel_fee_snapshots for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can insert channel fee snapshots"
  on public.channel_fee_snapshots for insert
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));


create table if not exists public.listing_quality_findings (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  listing_id            uuid references public.listings(id) on delete cascade,
  channel_id            uuid references public.channels(id) on delete set null,
  product_identity_id   uuid references public.product_identities(id) on delete set null,
  trade_unit_id         uuid references public.trade_units(id) on delete set null,
  attention_item_id     uuid references public.product_attention_items(id) on delete set null,
  proposal_id           uuid references public.agent_proposals(id) on delete set null,

  finding_key           text not null check (finding_key ~ '^[a-z0-9][a-z0-9_.:-]*$'),
  finding_type          text not null default 'content'
    check (finding_type in ('content', 'identifier', 'image', 'pricing', 'inventory', 'policy', 'fee', 'fulfillment', 'other')),
  severity              text not null default 'warning'
    check (severity in ('info', 'warning', 'error', 'critical')),
  status                text not null default 'open'
    check (status in ('open', 'in_review', 'proposed', 'resolved', 'dismissed')),
  title                 text not null,
  description           text,
  evidence              jsonb not null default '{}',
  recommended_action    text,
  metadata              jsonb not null default '{}',
  resolved_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, finding_key)
);

create index if not exists idx_listing_quality_findings_status
  on public.listing_quality_findings(workspace_id, status, severity, created_at desc);

create index if not exists idx_listing_quality_findings_listing
  on public.listing_quality_findings(listing_id)
  where listing_id is not null;

create index if not exists idx_listing_quality_findings_attention
  on public.listing_quality_findings(attention_item_id)
  where attention_item_id is not null;

alter table public.listing_quality_findings enable row level security;

create policy "Members can view listing quality findings"
  on public.listing_quality_findings for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage listing quality findings"
  on public.listing_quality_findings for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.listing_quality_findings
  for each row execute function public.update_updated_at();


create or replace function public.resolve_channel_capabilities(
  p_workspace_id uuid,
  p_channel_key text default null,
  p_channel_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with target_channel as (
    select c.*
    from public.channels c
    where
      (p_channel_id is not null and c.id = p_channel_id)
      or (
        p_channel_id is null
        and p_channel_key is not null
        and c.channel_key = p_channel_key
        and (c.workspace_id = p_workspace_id or c.workspace_id is null)
      )
    order by c.workspace_id nulls last
    limit 1
  ),
  capabilities as (
    select cc.*
    from public.channel_capabilities cc
    where (cc.workspace_id = p_workspace_id or cc.workspace_id is null)
      and (
        cc.channel_id = p_channel_id
        or cc.channel_key = coalesce((select channel_key from target_channel), p_channel_key)
      )
    order by cc.workspace_id nulls first, cc.capability_key
  ),
  requirements as (
    select cr.*
    from public.channel_requirements cr
    where (cr.workspace_id = p_workspace_id or cr.workspace_id is null)
      and (
        cr.channel_id = p_channel_id
        or cr.channel_key = coalesce((select channel_key from target_channel), p_channel_key)
      )
    order by cr.workspace_id nulls first, cr.requirement_key
  )
  select jsonb_build_object(
    'channel', coalesce((select to_jsonb(target_channel) from target_channel), '{}'::jsonb),
    'capabilities', coalesce((select jsonb_agg(to_jsonb(capabilities)) from capabilities), '[]'::jsonb),
    'requirements', coalesce((select jsonb_agg(to_jsonb(requirements)) from requirements), '[]'::jsonb)
  );
$$;

revoke execute on function public.resolve_channel_capabilities(uuid, text, uuid)
  from public, anon, authenticated;


insert into public.channel_capabilities
  (workspace_id, channel_id, channel_key, capability_key, support_level, direction, constraints, metadata)
values
  (null, null, 'square', 'catalog.items', 'supported', 'bidirectional', '{"source":"square_catalog_api"}'::jsonb, '{}'::jsonb),
  (null, null, 'square', 'catalog.images', 'conditional', 'bidirectional', '{"requires_image_upload_flow":true}'::jsonb, '{}'::jsonb),
  (null, null, 'square', 'inventory.counts', 'supported', 'bidirectional', '{"location_scoped":true}'::jsonb, '{}'::jsonb),
  (null, null, 'square', 'orders.sales', 'supported', 'inbound', '{"maps_to":"pos_sales"}'::jsonb, '{}'::jsonb)
on conflict do nothing;

insert into public.channel_requirements
  (workspace_id, channel_id, channel_key, requirement_key, requirement_type, target_object, severity, rule_expression, remediation_hint)
values
  (null, null, 'square', 'item.name.required', 'field', 'listing', 'required', '{"field":"item_data.name","min_length":1}'::jsonb, 'Add a channel-safe listing title before publishing.'),
  (null, null, 'square', 'variation.price_money.required', 'price', 'offer', 'required', '{"field":"item_variation_data.price_money"}'::jsonb, 'Set a sellable unit price and currency.'),
  (null, null, 'square', 'variation.sku.recommended', 'identifier', 'offer', 'recommended', '{"field":"item_variation_data.sku"}'::jsonb, 'Map the SKUMS seller SKU to the Square item variation SKU.')
on conflict do nothing;

drop trigger if exists audit_listing_quality_findings on public.listing_quality_findings;
create trigger audit_listing_quality_findings
  after insert or update or delete on public.listing_quality_findings
  for each row execute function public.record_graph_audit_event();
