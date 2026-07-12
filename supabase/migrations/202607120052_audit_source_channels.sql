-- Mirror of core/db/052_audit_source_channels.sql
alter table public.audit_events
  drop constraint if exists audit_events_source_type_check;

alter table public.audit_events
  add constraint audit_events_source_type_check
  check (source_type in (
    'db_trigger',
    'api',
    'import',
    'sync',
    'app',
    'system',
    'ui',
    'mcp',
    'assistant',
    'cron',
    'worker'
  ));

comment on column public.audit_events.source_type is
  'Provenance channel: ui | mcp | api | assistant | cron | worker | import | sync | app | system | db_trigger';

create index if not exists idx_audit_events_source_type
  on public.audit_events(workspace_id, source_type, created_at desc);
