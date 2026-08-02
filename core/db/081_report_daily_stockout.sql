-- 081_report_daily_stockout.sql
-- Platform seed pack: daily stockout (per-store ATS = 0). Suggest-only.
-- Section handler: inventory.store_stockouts (core/reports/sections.mjs)

insert into public.report_templates (
  id, workspace_id, slug, title, description, audience_hint,
  default_sections, default_schedule, default_timezone, default_channels, is_active, metadata
)
values
  (
    '00000000-0000-0000-0002-000000000004',
    null,
    'daily-stockout',
    'Daily stockout report',
    'Per store: active catalog SKUs with zero available stock (ATS = 0). Suggest-only — does not reorder or transfer.',
    'ops',
    array['inventory.store_stockouts'],
    'daily',
    'Asia/Singapore',
    array['in_app'],
    true,
    '{"v":1,"seed":true,"section":"inventory.store_stockouts"}'::jsonb
  )
on conflict do nothing;

-- Idempotent re-seed by slug when fixed UUID path was skipped
insert into public.report_templates (
  workspace_id, slug, title, description, audience_hint,
  default_sections, default_schedule, default_timezone, default_channels, is_active, metadata
)
select
  null,
  'daily-stockout',
  'Daily stockout report',
  'Per store: active catalog SKUs with zero available stock (ATS = 0). Suggest-only — does not reorder or transfer.',
  'ops',
  array['inventory.store_stockouts']::text[],
  'daily',
  'Asia/Singapore',
  array['in_app'],
  true,
  '{"v":1,"seed":true,"section":"inventory.store_stockouts"}'::jsonb
where not exists (
  select 1 from public.report_templates t
  where t.workspace_id is null and t.slug = 'daily-stockout'
);

comment on table public.report_templates is
  'Agentic report pack definitions (platform seeds + workspace custom). Track K. Includes daily-stockout.';
