-- ============================================================
-- 067 — Report run delivery policy (track K / Rpt-3)
--
-- Seeds Phase N policy for report.run.completed → in_app + slack.
-- Webhook (n8n) is delivered separately by reportRegistry (Rpt-5).
--
-- Run AFTER: 064_notification_bus.sql, 066_report_registry.sql
-- ============================================================

insert into public.notification_policies (
  workspace_id,
  event_type,
  enabled,
  channels,
  recipient_rules,
  template_key,
  priority_default,
  metadata
)
select
  null,
  'report.run.completed',
  true,
  array['in_app', 'slack']::text[],
  '{"scopes":["reports:read"],"roles":["owner","admin"]}'::jsonb,
  'report_run_completed',
  'normal',
  '{
    "deep_link_template": "/reports?run={entity_id}",
    "description": "Digest when an agentic report pack finishes (cron/manual/MCP/API)"
  }'::jsonb
where not exists (
  select 1 from public.notification_policies
  where workspace_id is null and event_type = 'report.run.completed'
);

comment on table public.report_runs is
  'Report execution ledger. Suggest-only payloads; delivery via Phase N + optional n8n webhook.';
