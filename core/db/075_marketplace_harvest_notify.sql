-- 075 — MH-9: Phase N policies for unattended Mall harvest.
--
-- The weekly brand-radar harvest runs on a schedule against a warm local
-- Chrome. When Shopee throws a captcha the run can no longer block on a
-- keypress (there is no TTY on a scheduled run), so it polls for recovery and
-- pings a human out-of-band instead. These policies are that ping.
--
-- Events:
--   marketplace.harvest.blocked    a shelf/PDP hit a captcha or login wall
--   marketplace.harvest.recovered  the wall cleared (or we gave up and moved on)
--
-- Entity is the brand_key so the delivery ledger dedupes per brand per run.
-- No deep link: there is no harvest job UI yet (BR PR-7). Slack carries the
-- shop + shelf in the body, which is what the operator needs to act.

do $$
declare
  r record;
begin
  for r in
    select *
    from (
      values
      (
        'marketplace.harvest.blocked',
        array['in_app','slack']::text[],
        '{"scopes":["intel:write"],"roles":["owner","admin"]}'::jsonb,
        'marketplace_harvest_blocked',
        'urgent',
        '{"description":"Mall harvest hit a captcha/login wall — solve it in the warm Chrome window; the run keeps polling and moves on if it times out."}'::jsonb
      ),
      (
        'marketplace.harvest.recovered',
        array['in_app']::text[],
        '{"scopes":["intel:write"],"roles":["owner","admin"]}'::jsonb,
        'marketplace_harvest_recovered',
        'low',
        '{"description":"Mall harvest wall cleared or the brand was skipped after the recovery deadline."}'::jsonb
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
