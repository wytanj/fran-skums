-- ============================================================
-- SKUMS — Hanshow All-Star ESL node (WIP)
--
-- Spec in hand: docs/hanshow.pdf HS-ALLSTAR-V220005
--   login + article query + ESL bind/unbind/flash
-- Waiting on: article import/update API, client_id/secret, store AP
--
-- Run AFTER: 086_iherb_catalogue.sql
-- Apply: node scripts/migrate.mjs --only 087
-- ============================================================

insert into public.integration_node_definitions
  (
    workspace_id,
    name,
    slug,
    description,
    icon,
    color,
    category,
    node_type,
    is_available,
    is_coming_soon,
    actions,
    triggers,
    credential_schema,
    default_field_mapping,
    supports_webhooks,
    rate_limit_rpm
  )
select
  null::uuid,
  'Hanshow All-Star ESL',
  'hanshow-allstar',
  'WIP. Query All-Star articles, bind ESLs to SKUs, and flash labels. Price push waits on Hanshow article import API. Shelf refresh needs a store Hanshow AP.',
  'esl',
  'bg-amber-600/10 text-amber-300 ring-amber-500/20',
  'other',
  'action',
  true,
  false,
  '[
    {"key":"test_credentials","label":"Test Credentials","description":"Exchange All-Star OAuth credentials for a bearer token."},
    {"key":"query_articles","label":"Query Articles","description":"Look up products already in All-Star by SKU or EAN."},
    {"key":"bind_labels","label":"Bind ESL","description":"Associate an ESL labelId with a product SKU."},
    {"key":"unbind_labels","label":"Unbind ESL","description":"Remove an ESL ↔ product association."},
    {"key":"list_label_links","label":"List ESL Links","description":"Read which SKU is bound to a set of ESL ids."},
    {"key":"flash_labels","label":"Flash ESL","description":"Flash LED or switch page. Physical change needs a store AP."},
    {"key":"push_articles","label":"Push Articles (blocked)","description":"Waiting on Hanshow article create/update spec."}
  ]'::jsonb,
  '[]'::jsonb,
  '{
    "properties": {
      "base_url": {"type":"string","label":"All-Star Base URL","description":"https://ap-allstar.hanshowcloud.net","required":true,"default":"https://ap-allstar.hanshowcloud.net"},
      "username": {"type":"string","label":"Username","description":"All-Star account, e.g. Test2.1002","required":true},
      "password": {"type":"string","label":"Password","secret":true,"required":true},
      "client_id": {"type":"string","label":"API Client ID","description":"Issued by Hanshow for the OAuth app — not the web login.","required":true},
      "client_secret": {"type":"string","label":"API Client Secret","secret":true,"required":true},
      "org": {"type":"string","label":"Org / customer code","description":"All-Star customer code used in article paths"},
      "terminal": {"type":"string","label":"Terminal / store number","description":"Store number used in article paths"},
      "customer_code": {"type":"string","label":"OpenAPI customer-code","description":"Defaults to org if blank"},
      "store_code": {"type":"string","label":"OpenAPI store-code","description":"Defaults to terminal if blank"}
    }
  }'::jsonb,
  '{}'::jsonb,
  false,
  60
where not exists (
  select 1
  from public.integration_node_definitions ind
  where ind.workspace_id is null
    and ind.slug = 'hanshow-allstar'
);
