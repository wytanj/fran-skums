# Shipping Visualizer

Ops observation base for Fran shipments.

## Routes

- UI: /apps/shipping and /apps/shipping/:id
- Ingest: POST /api/apps/shipping/ingest
- Recon: GET|POST /api/apps/shipping/recon-digest

## Env

- SHIPPING_INGEST_SECRET
- SHIPPING_RECON_SECRET (optional; falls back to ingest/cron secrets)
- SHIPPING_RECON_EMAIL (default jeremy@heyfran.com)

## Schema

Apply core migration 088 (shipping_visualizer), then run apps/shipping seed.

## Ingest contract

Header: Authorization Bearer <SHIPPING_INGEST_SECRET>
Body JSON: workspace_id, shipment fields, optional notes/files/lines, idempotency_key.
Every status change writes shipping_events.

Non-goals: new Supabase project, full chat dump UI, carrier APIs, OFS rewrite.
