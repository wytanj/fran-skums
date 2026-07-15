# Fran SKUMS

Fran SKUMS is the product, inventory, fulfillment, and store-operations backend for Fran.

This repo was initialized from the upstream SKUMS working tree and keeps the generic SKUMS primitives in place. Fran-specific behavior lives in:

- `core/fran/`
- `server/fran/`
- `server/routes/fran/`
- `docs/fran-skums-contract.md`
- `docs/fran-product-operations.md`

## Operator documentation

Day-to-day retail / Loft operations (HQ + POS handoff):

| Doc | Audience |
|-----|----------|
| **[`docs/SKUMS_OPERATOR_RUNBOOK.md`](docs/SKUMS_OPERATOR_RUNBOOK.md)** | HQ inventory ops, store managers, admins — **start here to operate SKUMS** |
| In-app **Help** (`/help`) | Click-path guides (store ops, receive, floor adjustments, Loft setup) |
| [`docs/INVENTORY_AND_PURCHASE_LOGGING.md`](docs/INVENTORY_AND_PURCHASE_LOGGING.md) | Stock ledger + POS / SKUMS / CRM data ownership |
| [`docs/LOFT_OPS_DICTIONARY.md`](docs/LOFT_OPS_DICTIONARY.md) | OFS status maps, delivery methods, Loft email checklist |
| [`docs/ORG_PERMISSION_SCOPES.md`](docs/ORG_PERMISSION_SCOPES.md) | Permission scopes & role packages |

After login: **Store Ops** (`/store-ops`) for replenishment waves, receive exceptions, floor ledger apply, and inbound ASN. **Inventory** is levels/warehouse POs; **Actions** is AI decision drafts (not Loft send).

## Local Setup

```sh
npm install
npm run dev
```

The app runs on Nuxt. The default dev URL is `http://localhost:3000`.

## Environment

Use `.env` locally. It is gitignored.

```sh
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_DB_URL=postgresql://...
PGSSL=require
```

The publishable key is enough for browser auth configuration. Server-side POS, CRM, and store-ops routes use `getAdminClient()` and need `SUPABASE_SERVICE_ROLE_KEY` for live API-key validation and RLS-protected writes.

## Fran Route Surface

The Fran POS and CRM routes are mounted without the generic `/api/v1` prefix:

- `POST /fran/pos/scan/resolve`
- `GET /fran/pos/catalog`
- `GET /fran/pos/products/[id]`
- `POST /fran/pos/sales`
- `POST /fran/pos/returns`
- `POST /fran/pos/inventory-events`
- `POST /fran/store-ops/requests`
- `GET /fran/crm/product-context`

The inherited generic API remains available under `/api/v1`.

## Database

Core migrations use the repo runner:

```sh
npm run db:migrate:status
npm run db:migrate -- --dry-run
npm run db:migrate
```

New database work is mirrored in both `core/db/` and `supabase/migrations/`. Fran metadata is introduced by `core/db/045_fran_product_metadata.sql` and `supabase/migrations/202606290045_fran_product_metadata.sql`.

## Verification

```sh
npm test
npm run build
```
