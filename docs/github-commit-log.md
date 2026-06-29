# GitHub Commit Log

## Standing Rule

Every time Codex commits and pushes to GitHub in this repo, update this file in
the same commit.

Each dated entry should include:

- Date.
- Branch.
- Commit summary.
- Important files or domains touched.
- Verification run.
- Migration or deployment notes.

## 2026-06-10

Branch: `feat/platform-structure`

Summary:

- Executed SKUMS Phase 1 for agentic/headless commerce.
- Added product attention item and channel intelligence migrations.
- Added attention-item APIs, proposal-from-attention APIs, dry-run, and approved-only proposal execution.
- Hardened POS catalog, sale, and inventory-event APIs for revisions, idempotency, domain events, and attention items.
- Added Square channel scaffold and headless commerce API documentation.
- Added Supabase-facing migration mirrors under `supabase/migrations/`.

Verification:

- `npm test`
- `npm run build`

Migration notes:

- Apply `040`, `041`, then `042` if the target database has not received them.
- Use either the existing `core/db` migration runner or `supabase db push`, not both on the same target database unless reconciling migration history.

## 2026-06-24

Branch: `feat/platform-structure`

Summary:

- Added a generic fulfillment-adapter contract for future 3PL/WMS apps.
- Added the WorldSyntech OFS fulfillment app for Loft Logistics / LISE inbound stock, warehouse inventory visibility, and store replenishment.
- Added OFS server actions for credential testing, reference-data sync, inventory pull, inbound shipment creation, and store replenishment creation.
- Added integration UI actions for OFS credential testing, reference sync, and inventory pull.
- Added the `043_fulfillment_integrations` database migration and Supabase mirror for the generic mapping table plus WorldSyntech app/node seeds.

Verification:

- `npm test` passed.
- `npm run build` passed.
- Supabase migration `fulfillment_integrations` applied to project `ilwdrirzsxgacpdbhmdn`.
- Verified production Supabase has `integration_entity_mappings`, `worldsyntech-ofs`, and `worldsyntech_ofs`.

Deployment notes:

- No live Loft/OFS token is available yet, so WorldSyntech API calls are implemented but not live-tested.
- Existing Supabase advisors still report older project-wide security/performance warnings unrelated to the new fulfillment mapping table.
