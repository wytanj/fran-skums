-- ============================================================
-- 064 — Phase N: stakeholder notification bus
--
-- Lifecycle-event notifications (not every field edit).
-- Reuses store_ops_notifications for in-app HQ inbox.
-- Adds policies + durable delivery ledger + workspace settings.
--
-- Run AFTER: 056_store_ops_waves_inbox.sql, 052_audit_source_channels.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Workspace-level notification settings
-- ------------------------------------------------------------
create table if not exists public.workspace_notification_settings (
  workspace_id          uuid primary key references public.workspaces(id) on delete cascade,
  email_enabled         boolean not null default false,
  slack_enabled         boolean not null default true,
  -- Optional override; if null, fall back to any assistant_context_profiles.slack_webhook_url
  slack_webhook_url     text,
  email_from            text,
  email_reply_to        text,
  quiet_hours           jsonb not null default '{}',
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.workspace_notification_settings enable row level security;

drop policy if exists "Members can view notification settings"
  on public.workspace_notification_settings;
create policy "Members can view notification settings"
  on public.workspace_notification_settings for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Admins can manage notification settings"
  on public.workspace_notification_settings;
create policy "Admins can manage notification settings"
  on public.workspace_notification_settings for all
  to authenticated
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

grant select, insert, update, delete on table public.workspace_notification_settings
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.workspace_notification_settings;
create trigger set_updated_at before update on public.workspace_notification_settings
  for each row execute function public.update_updated_at();

-- ------------------------------------------------------------
-- 2. Notification policies (platform defaults + workspace overrides)
-- ------------------------------------------------------------
create table if not exists public.notification_policies (
  id                    uuid primary key default uuid_generate_v4(),
  -- null workspace_id = platform default seed
  workspace_id          uuid references public.workspaces(id) on delete cascade,
  event_type            text not null
    check (event_type ~ '^[a-z0-9][a-z0-9_.:-]*$'),
  enabled               boolean not null default true,
  channels              text[] not null default '{in_app}',
  -- recipient_rules jsonb:
  --   roles: ["owner","admin"]
  --   scopes: ["store_ops:approve"]
  --   dynamic: ["requested_by","actor"]  -- keys from payload / entity
  --   user_ids: ["uuid",...]
  recipient_rules       jsonb not null default '{}',
  template_key          text,
  priority_default      text not null default 'normal'
    check (priority_default in ('low', 'normal', 'urgent', 'critical')),
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists idx_notification_policies_platform_event
  on public.notification_policies(event_type)
  where workspace_id is null;

create unique index if not exists idx_notification_policies_workspace_event
  on public.notification_policies(workspace_id, event_type)
  where workspace_id is not null;

create index if not exists idx_notification_policies_event
  on public.notification_policies(event_type)
  where enabled = true;

alter table public.notification_policies enable row level security;

drop policy if exists "Members can view notification policies"
  on public.notification_policies;
create policy "Members can view notification policies"
  on public.notification_policies for select
  to authenticated
  using (
    workspace_id is null
    or workspace_id in (select public.get_my_workspace_ids())
  );

drop policy if exists "Admins can manage workspace notification policies"
  on public.notification_policies;
create policy "Admins can manage workspace notification policies"
  on public.notification_policies for all
  to authenticated
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

grant select, insert, update, delete on table public.notification_policies
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.notification_policies;
create trigger set_updated_at before update on public.notification_policies
  for each row execute function public.update_updated_at();

-- ------------------------------------------------------------
-- 3. Durable delivery ledger (idempotent per channel+recipient)
-- ------------------------------------------------------------
create table if not exists public.notification_deliveries (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  event_type            text not null,
  entity_type           text,
  entity_id             uuid,
  channel               text not null
    check (channel in ('in_app', 'email', 'slack', 'webhook')),
  -- user_id, email, scope:store_ops:approve, workspace_slack, etc.
  recipient             text not null,
  recipient_user_id     uuid references public.profiles(id) on delete set null,
  status                text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  provider_ref          text,
  payload_snapshot      jsonb not null default '{}',
  error                 text,
  -- e.g. store_ops.request.submitted:req-uuid:in_app:scope:store_ops:approve
  idempotency_key       text not null,
  created_at            timestamptz not null default now(),
  sent_at               timestamptz,
  updated_at            timestamptz not null default now()
);

create unique index if not exists idx_notification_deliveries_idempotency
  on public.notification_deliveries(workspace_id, idempotency_key);

create index if not exists idx_notification_deliveries_workspace_status
  on public.notification_deliveries(workspace_id, status, created_at desc);

create index if not exists idx_notification_deliveries_entity
  on public.notification_deliveries(workspace_id, entity_type, entity_id)
  where entity_id is not null;

create index if not exists idx_notification_deliveries_event
  on public.notification_deliveries(workspace_id, event_type, created_at desc);

alter table public.notification_deliveries enable row level security;

drop policy if exists "Members can view notification deliveries"
  on public.notification_deliveries;
create policy "Members can view notification deliveries"
  on public.notification_deliveries for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

-- Inserts/updates via service role (bus); writers may insert for manual triggers
drop policy if exists "Writers can insert notification deliveries"
  on public.notification_deliveries;
create policy "Writers can insert notification deliveries"
  on public.notification_deliveries for insert
  to authenticated
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

drop policy if exists "Writers can update notification deliveries"
  on public.notification_deliveries;
create policy "Writers can update notification deliveries"
  on public.notification_deliveries for update
  to authenticated
  using (workspace_id in (select public.get_my_writable_workspace_ids()));

grant select, insert, update, delete on table public.notification_deliveries
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.notification_deliveries;
create trigger set_updated_at before update on public.notification_deliveries
  for each row execute function public.update_updated_at();

-- ------------------------------------------------------------
-- 4. Platform default policies (store-ops first; PO stubs for later)
-- Idempotent: insert only when platform row for event_type is missing.
-- ------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      (
        'store_ops.request.submitted',
        array['in_app','slack']::text[],
        '{"scopes":["store_ops:approve"],"roles":["owner","admin"]}'::jsonb,
        'store_ops_request_submitted',
        'normal',
        '{"deep_link_template":"/store-ops?tab=queue&request={entity_id}","description":"HQ inbox when store submits replenishment request"}'::jsonb
      ),
      (
        'store_ops.request.decided',
        array['in_app','slack']::text[],
        '{"dynamic":["requested_by"]}'::jsonb,
        'store_ops_request_decided',
        'normal',
        '{"deep_link_template":"/store-ops?tab=queue&request={entity_id}","description":"Notify requester when HQ decides"}'::jsonb
      ),
      (
        'store_ops.exception.opened',
        array['in_app','slack']::text[],
        '{"scopes":["store_ops:verify"],"roles":["owner","admin"]}'::jsonb,
        'store_ops_exception_opened',
        'urgent',
        '{"deep_link_template":"/store-ops?tab=exceptions&exception={entity_id}","description":"HQ when POS receive reports short/damage/etc"}'::jsonb
      ),
      (
        'store_ops.exception.verified',
        array['in_app']::text[],
        '{"dynamic":["requested_by","actor"]}'::jsonb,
        'store_ops_exception_verified',
        'normal',
        '{"deep_link_template":"/store-ops?tab=exceptions&exception={entity_id}","description":"Close-the-loop on exception verify"}'::jsonb
      ),
      (
        'po.submitted',
        array['in_app']::text[],
        '{"roles":["owner","admin"]}'::jsonb,
        'po_submitted',
        'normal',
        '{"deep_link_template":"/actions?po={entity_id}","description":"Internal PO submit → approvers"}'::jsonb
      ),
      (
        'po.approved',
        array['in_app']::text[],
        '{"dynamic":["created_by"]}'::jsonb,
        'po_approved',
        'normal',
        '{"deep_link_template":"/actions?po={entity_id}","description":"Internal PO decision → submitter"}'::jsonb
      ),
      (
        'po.rejected',
        array['in_app']::text[],
        '{"dynamic":["created_by"]}'::jsonb,
        'po_rejected',
        'normal',
        '{"deep_link_template":"/actions?po={entity_id}","description":"Internal PO reject → submitter"}'::jsonb
      )
    ) as v(event_type, channels, recipient_rules, template_key, priority_default, metadata)
  loop
    if not exists (
      select 1 from public.notification_policies
      where workspace_id is null and event_type = r.event_type
    ) then
      insert into public.notification_policies (
        workspace_id, event_type, enabled, channels, recipient_rules,
        template_key, priority_default, metadata
      ) values (
        null, r.event_type, true, r.channels, r.recipient_rules,
        r.template_key, r.priority_default, r.metadata
      );
    end if;
  end loop;
end $$;

comment on table public.notification_policies is
  'Phase N: per-event channel + recipient rules. Null workspace_id = platform defaults.';
comment on table public.notification_deliveries is
  'Phase N: durable, idempotent delivery ledger (in_app / slack / email / webhook).';
comment on table public.workspace_notification_settings is
  'Phase N: workspace toggles for email/slack; slack_webhook_url optional override.';
