# Changes - Week Ending 2026-05-28

## 2026-05-28 Update

### Summary

Prepared SKUMS for the LISE demo path where staff can sign in with Google, upload supplier XLSX files, stage product rows, and connect POS through a scoped API key.

### What Changed Today

- Fixed workspace creation compatibility so new users can save a workspace even when the deployed Supabase RPC does not accept `ws_org_id`.
- Added richer product import progress for XLSX uploads, including row counts, percentages, and current commit phase.
- Changed large product imports to batch commits with row-level fallback so bigger spreadsheets do not depend on one large insert.
- Added a one-click POS connector setup flow in `Settings > API Keys`.
- The POS connector creates a scoped API key with `pos:read` and `pos:write`.
- The connector UI shows SKUMS POS endpoints and a copyable POS environment block:
  - `VITE_SKUMS_API_URL=https://skums.vercel.app`
  - `VITE_SKUMS_API_KEY=sk_live_...`
- Confirmed the Google SSO architecture: SKUMS owns workspace/team/API-key administration; POS can use SSO for staff access but talks to SKUMS through the connector key for the demo.

### Why

The demo needs a low-friction path from SKUMS product upload to POS checkout. SKUMS should remain the product and workspace authority, while POS should consume the catalog through a narrow integration boundary instead of duplicating product truth.

### Verification

- SKUMS tests passed: 108/108.
- SKUMS production build passed locally.
- Latest pushed SKUMS app commit before this changelog: `e78f22d Add POS connector setup flow`.

### Deployment

- Production app: `https://skums.vercel.app`
- Latest verified production deployment before this changelog: `dpl_2gAuiBUoh7tLr7tzbVYaeNPfQQSE`

## Summary

This week moved SKUMS from a product-management prototype toward the hosted system of record for product, import, identity, and POS-facing catalog data.

The main architectural decision is that SKUMS should start as a shared hosted production database with tenant isolation by organization and workspace. Customer-dedicated databases, managed backups, restore workflows, and database orchestration are future enterprise capabilities, not the default model for early customers.

## Why

LISE Beauty needs to upload supplier XLSX files into SKUMS and have POS users sell from the approved SKUMS catalog. The files may change format over time, so the import path cannot assume one fixed spreadsheet layout. The product data also needs to preserve disabled/non-POS rows in SKUMS while only exposing POS-enabled products to checkout.

Google SSO, workspace membership, API keys, imports, and POS endpoints all need to reinforce the same tenancy boundary: organization and workspace first, separate customer databases later when operationally justified.

## Platform And IAM

- Hardened Google SSO profile creation through migration `038_auth_identity.sql`.
- Preserved safe login redirects across email and Google auth flows.
- Tightened UI API key creation so a signed-in user must be an owner or admin of the requested workspace.
- Continued using workspace-scoped API keys as the integration boundary for POS and external clients.
- Documented the IAM direction in `docs/AGENTIC_COMMERCE_BUSINESS_PICTURE.md`: SKUMS users, teams, organizations, keys, backups, and restores should eventually be governed by the same trust model.

## Import Review Pipeline

- Added migration `039_import_review_pipeline.sql`.
- Extended `import_jobs` with:
  - `mapping_source`
  - `inferred_column_mapping`
  - `normalization_model`
  - `review_status`
  - approved and rejected row counts
- Extended `import_job_rows` with:
  - `normalization_confidence`
  - `approval_status`
  - `approval_notes`
- Added indexes for import review queues.
- Applied migration `039` manually in the SKUMS Supabase SQL Editor because the direct Supabase Postgres hostname resolved as IPv6-only from the local machine.

## XLSX Import Support

- Added `xlsx` as a dependency.
- Updated the import/export page to accept `.xlsx` and `.xls` files in addition to CSV/TSV-style imports.
- Added automatic header row detection for supplier spreadsheets where the first row may not contain field names.
- Added duplicate-header handling so repeated spreadsheet column names can still be staged safely.
- Added deterministic column aliases for ABW/LISE-style supplier files, including:
  - supplier item/catalog number
  - supplier availability
  - option/variant name
  - retail and sale price
  - weight
  - UPC/EAN/GTIN
  - POS enabled flags
- Defaulted demo imports to active, POS-enabled products so LISE staff can upload and see approved products in POS quickly.
- Staged normalized rows into `import_job_rows` before product commit so the path is ready to evolve into a true review-and-approve workflow.

## POS API Integration

- Added `GET /api/v1/pos/catalog`.
- The catalog endpoint:
  - requires the `pos:read` API scope
  - resolves workspace context from the API key
  - returns active products by default
  - filters out products where POS flags are disabled
  - includes graph references for product identity, trade units, identifiers, and SKU assignments where available
- Kept `POST /api/v1/pos/sales` as the write-back path for POS sales under the same workspace boundary.
- Added CORS middleware for `/api/v1/*` so browser-based POS clients can call SKUMS APIs.
- Updated the OpenAPI and API index surfaces to advertise the POS catalog route.

## Business Direction Documentation

- Updated `docs/AGENTIC_COMMERCE_BUSINESS_PICTURE.md` to capture:
  - shared SKUMS database first
  - dev and production database separation
  - customer-managed backup expectations
  - future database orchestration as an enterprise/customer tier
  - import staging before approval
  - future LLM-assisted normalization for changing XLSX formats
  - POS reading SKUMS as the product source of truth

## Verification

- SKUMS tests passed: 103/103.
- SKUMS production build passed on Vercel.
- Production deployment completed:
  - `https://skums.vercel.app`
  - deployment `dpl_7C9JY3u1Gt8w3bxXo2AZSo7qz7a6`

## Known Follow-Ups

- The import UI still auto-commits after staging for demo speed. The intended durable flow is stage, review, approve, then commit.
- The migration runner has not recorded `039` in `public.skums_migrations` because the SQL was applied manually. This should be reconciled once a working Supabase pooler URL is available.
- Generated Supabase database types are still missing in Vercel builds.
- Customer-dedicated database provisioning, backup policies, restore approvals, and migration status tracking are not implemented yet.
