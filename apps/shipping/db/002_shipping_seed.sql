-- ============================================================
-- Seed: M&P × Fran test air shipment (batch 4962)
-- Requires: 001_shipping.sql applied
-- Uses workspace id from apps/shipping seed script or replace :workspace_id
--
-- This file is idempotent on idempotency_key = 'seed-mp-fran-batch-4962'
-- ============================================================

-- Prefer running via: node apps/shipping/scripts/seed.mjs
-- Manual: set workspace_id below then execute in SQL editor.

do $$
declare
  v_workspace_id uuid;
  v_shipment_id uuid;
begin
  -- Resolve Fran workspace: prefer known MCP workspace, else first workspace
  select id into v_workspace_id
  from public.workspaces
  where id = 'c21c057f-ea01-4e19-bc79-fafcf2626b19'
  limit 1;

  if v_workspace_id is null then
    select id into v_workspace_id from public.workspaces order by created_at asc limit 1;
  end if;

  if v_workspace_id is null then
    raise exception 'No workspace found for shipping seed';
  end if;

  -- Upsert shipment by idempotency key
  select id into v_shipment_id
  from public.shipping_shipments
  where workspace_id = v_workspace_id
    and idempotency_key = 'seed-mp-fran-batch-4962';

  if v_shipment_id is null then
    insert into public.shipping_shipments (
      workspace_id,
      title,
      status,
      mode,
      forwarder_name,
      origin_name,
      destination_name,
      shipper_name,
      consignee_name,
      contact_email,
      quote_number,
      batch_number,
      mawb,
      hawb,
      flight_number,
      flight_date,
      pickup_eta,
      package_count,
      weight_kg,
      carrier_shipment_ids,
      drive_folder_url,
      drive_folder_id,
      storage_risk,
      exception_open,
      package_mismatch,
      missing_fields,
      badges,
      current_location_label,
      status_changed_at,
      idempotency_key,
      metadata
    ) values (
      v_workspace_id,
      'M&P × Fran air — batch 4962',
      'booked',
      'air',
      'M&P',
      'Mapletree Logistics Hub, Tsing Yi, HK',
      'Singapore',
      'M&P / Fran HK staging',
      'Fran Singapore',
      'kirsten07@heyfran.com',
      'MPIF2021699956',
      '4962',
      '160-1655 3482',
      'MCA63843',
      'CX635',
      '2026-09-09',
      '2026-09-08T04:00:00Z',
      9,
      63.230,
      array['37724039', '37728100'],
      'https://drive.google.com/drive/folders/1h-rRlbkWqPCjbLiKYWFoGldBErt2EFTB',
      '1h-rRlbkWqPCjbLiKYWFoGldBErt2EFTB',
      true,
      false,
      false,
      array['commercial_invoice', 'waybill_file', 'freight_quote_file', 'driver_name', 'pickup_confirmed'],
      jsonb_build_array(
        jsonb_build_object('key', 'storage_risk', 'label', 'Storage / booking-lead risk', 'severity', 'warning'),
        jsonb_build_object('key', 'missing_ci', 'label', 'Missing CI', 'severity', 'danger'),
        jsonb_build_object('key', 'missing_waybill', 'label', 'No waybill file', 'severity', 'danger'),
        jsonb_build_object('key', 'missing_freight_quote', 'label', 'No freight quote file', 'severity', 'warning'),
        jsonb_build_object('key', 'missing_driver_pickup', 'label', 'No driver / confirmed pickup', 'severity', 'warning')
      ),
      'Mapletree Logistics Hub Tsing Yi (awaiting pickup)',
      '2026-09-04T10:00:00Z',
      'seed-mp-fran-batch-4962',
      jsonb_build_object(
        'seed', true,
        'lane', 'HK→SG air',
        'partners', jsonb_build_array('M&P', 'Fran'),
        'notes_brief', 'Test air shipment for shipping visualizer v1'
      )
    ) returning id into v_shipment_id;
  else
    update public.shipping_shipments set
      title = 'M&P × Fran air — batch 4962',
      status = 'booked',
      mode = 'air',
      forwarder_name = 'M&P',
      origin_name = 'Mapletree Logistics Hub, Tsing Yi, HK',
      destination_name = 'Singapore',
      contact_email = 'kirsten07@heyfran.com',
      quote_number = 'MPIF2021699956',
      batch_number = '4962',
      mawb = '160-1655 3482',
      hawb = 'MCA63843',
      flight_number = 'CX635',
      flight_date = '2026-09-09',
      pickup_eta = '2026-09-08T04:00:00Z',
      package_count = 9,
      weight_kg = 63.230,
      carrier_shipment_ids = array['37724039', '37728100'],
      drive_folder_url = 'https://drive.google.com/drive/folders/1h-rRlbkWqPCjbLiKYWFoGldBErt2EFTB',
      drive_folder_id = '1h-rRlbkWqPCjbLiKYWFoGldBErt2EFTB',
      storage_risk = true,
      exception_open = false,
      package_mismatch = false,
      missing_fields = array['commercial_invoice', 'waybill_file', 'freight_quote_file', 'driver_name', 'pickup_confirmed'],
      badges = jsonb_build_array(
        jsonb_build_object('key', 'storage_risk', 'label', 'Storage / booking-lead risk', 'severity', 'warning'),
        jsonb_build_object('key', 'missing_ci', 'label', 'Missing CI', 'severity', 'danger'),
        jsonb_build_object('key', 'missing_waybill', 'label', 'No waybill file', 'severity', 'danger'),
        jsonb_build_object('key', 'missing_freight_quote', 'label', 'No freight quote file', 'severity', 'warning'),
        jsonb_build_object('key', 'missing_driver_pickup', 'label', 'No driver / confirmed pickup', 'severity', 'warning')
      ),
      current_location_label = 'Mapletree Logistics Hub Tsing Yi (awaiting pickup)',
      updated_at = now()
    where id = v_shipment_id;
  end if;

  -- Clear prior seed children for re-run
  delete from public.shipping_events where shipment_id = v_shipment_id and metadata->>'seed' = 'true';
  delete from public.shipping_notes where shipment_id = v_shipment_id and metadata->>'seed' = 'true';
  delete from public.shipping_files where shipment_id = v_shipment_id and metadata->>'seed' = 'true';
  delete from public.shipping_lines where shipment_id = v_shipment_id and metadata->>'seed' = 'true';

  -- Timeline events
  insert into public.shipping_events (
    workspace_id, shipment_id, event_type, from_status, to_status,
    title, body, source, occurred_at, metadata
  ) values
  (v_workspace_id, v_shipment_id, 'status_transition', null, 'intake',
   'Intake opened', 'M&P × Fran air lane opened for batch 4962.', 'system',
   '2026-09-02T02:00:00Z', '{"seed":true}'::jsonb),
  (v_workspace_id, v_shipment_id, 'status_transition', 'intake', 'quote',
   'Quote received', 'Quote MPIF2021699956 on file (file attachment still missing).', 'ingest',
   '2026-09-03T04:30:00Z', '{"seed":true,"quote_number":"MPIF2021699956"}'::jsonb),
  (v_workspace_id, v_shipment_id, 'status_transition', 'quote', 'booked',
   'Booked CX635', 'MAWB 160-1655 3482 / HAWB MCA63843. Flight 09 Sep. Pickup ~08 Sep.', 'ingest',
   '2026-09-04T10:00:00Z', '{"seed":true,"flight":"CX635"}'::jsonb),
  (v_workspace_id, v_shipment_id, 'exception', 'booked', 'booked',
   'Box8 briefly missing', 'Box8 reported missing on 4 Sep; later accounted for. Flag cleared.', 'whatsapp',
   '2026-09-04T12:15:00Z', '{"seed":true,"box":"Box8","resolved":true}'::jsonb),
  (v_workspace_id, v_shipment_id, 'badge', null, null,
   'Storage / booking-lead risk', 'Lead time into flight + hub storage risk while awaiting pickup confirmation.', 'system',
   '2026-09-05T01:00:00Z', '{"seed":true,"badge":"storage_risk"}'::jsonb),
  (v_workspace_id, v_shipment_id, 'system', null, null,
   'Drive folder linked', 'Ops Drive folder attached for documents and photos.', 'system',
   '2026-09-05T03:00:00Z', '{"seed":true}'::jsonb);

  -- Staff + curated WhatsApp excerpts
  insert into public.shipping_notes (
    workspace_id, shipment_id, note_type, body, author_label, is_curated, occurred_at, metadata
  ) values
  (v_workspace_id, v_shipment_id, 'staff',
   'Seed observation shipment for visualizer. Answer: where is it / what is missing.',
   'Jeremy', true, '2026-09-05T06:00:00Z', '{"seed":true}'::jsonb),
  (v_workspace_id, v_shipment_id, 'whatsapp_excerpt',
   'Kirsten: 9 pkgs / 63.23 kg confirmed at Mapletree Logistics Hub Tsing Yi. Shipments 37724039 + 37728100.',
   'kirsten07@heyfran.com', true, '2026-09-04T08:20:00Z', '{"seed":true,"curated":true}'::jsonb),
  (v_workspace_id, v_shipment_id, 'whatsapp_excerpt',
   'Ops: Box8 briefly missing earlier today — found and restacked. Still need driver name + pickup confirm for 08 Sep.',
   'Fran ops', true, '2026-09-04T12:40:00Z', '{"seed":true,"curated":true}'::jsonb),
  (v_workspace_id, v_shipment_id, 'whatsapp_excerpt',
   'M&P: CX635 09 Sep / pickup window ~08 Sep. CI + waybill PDF + freight quote file not yet in Drive.',
   'M&P desk', true, '2026-09-05T02:10:00Z', '{"seed":true,"curated":true}'::jsonb);

  -- Files rail (present folder + missing critical docs as placeholders)
  insert into public.shipping_files (
    workspace_id, shipment_id, label, file_kind, drive_url, is_missing, sort_order, metadata
  ) values
  (v_workspace_id, v_shipment_id, 'Ops Drive folder', 'other',
   'https://drive.google.com/drive/folders/1h-rRlbkWqPCjbLiKYWFoGldBErt2EFTB', false, 0,
   '{"seed":true,"kind":"folder"}'::jsonb),
  (v_workspace_id, v_shipment_id, 'Commercial invoice (CI)', 'ci', null, true, 1,
   '{"seed":true}'::jsonb),
  (v_workspace_id, v_shipment_id, 'Waybill PDF', 'waybill', null, true, 2,
   '{"seed":true}'::jsonb),
  (v_workspace_id, v_shipment_id, 'Freight quote file', 'freight_quote', null, true, 3,
   '{"seed":true,"quote_number":"MPIF2021699956"}'::jsonb),
  (v_workspace_id, v_shipment_id, 'HAWB MCA63843 (ref only)', 'hawb', null, true, 4,
   '{"seed":true,"hawb":"MCA63843","note":"number known; file missing"}'::jsonb),
  (v_workspace_id, v_shipment_id, 'MAWB 160-1655 3482 (ref only)', 'mawb', null, true, 5,
   '{"seed":true,"mawb":"160-1655 3482","note":"number known; file missing"}'::jsonb);

  -- Package lines (9 pkgs)
  insert into public.shipping_lines (
    workspace_id, shipment_id, line_number, package_ref, description, quantity, weight_kg, metadata
  )
  select
    v_workspace_id,
    v_shipment_id,
    g,
    'Box' || g,
    case when g = 8 then 'Box8 (briefly missing 4 Sep — recovered)' else 'Air carton ' || g end,
    1,
    round((63.230 / 9)::numeric, 3),
    jsonb_build_object('seed', true, 'briefly_missing', g = 8)
  from generate_series(1, 9) as g;

  raise notice 'Seeded shipping shipment % in workspace %', v_shipment_id, v_workspace_id;
end $$;
