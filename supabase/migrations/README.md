# Supabase Migrations

This folder is the Supabase-facing migration folder for new SKUMS database work.

Current legacy migrations still live in `core/db/` because the repo migration
runner reads that folder and records checksums in `public.skums_migrations`.
Starting with the POS and Phase 1 work, new migrations should also be mirrored
here with Supabase-style timestamped filenames.

## Current Mirrors

- `202606100040_pos_inventory_events.sql` mirrors `core/db/040_pos_inventory_events.sql`
- `202606100041_product_attention_items.sql` mirrors `core/db/041_product_attention_items.sql`
- `202606100042_channel_intelligence.sql` mirrors `core/db/042_channel_intelligence.sql`
- `202606240043_fulfillment_integrations.sql` mirrors `core/db/043_fulfillment_integrations.sql`
- `202606240044_store_operations.sql` mirrors `core/db/044_store_operations.sql`
- `202606290045_fran_product_metadata.sql` mirrors `core/db/045_fran_product_metadata.sql`
- `202607090046_loyalty_pricing_inventory.sql` mirrors `core/db/046_loyalty_pricing_inventory.sql`

## Rule

For each new database migration:

1. Add the numbered migration under `core/db/` until the repo runner is moved.
2. Add the same SQL under `supabase/migrations/` with a timestamped filename.
3. Register the numbered migration in `core/db/MIGRATIONS.md`.
4. Update the relevant tests or docs that prove the new schema is discoverable.

Use one application path per database. Do not run both the custom `core/db`
runner and `supabase db push` against the same target unless you are explicitly
repairing migration history.
