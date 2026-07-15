# Fran SKUMS MCP Server

stdio MCP server for agents (Cursor, Claude, Grok, etc.) to:

- **Catalog Q&A** over Fran products (stats / search / get) — safe for 10k+ imports
- **Study** new products (brief via Grok, catalog match, pipeline propose)
- **BI** read Shopee warehouse data (seeds, snapshots, export tables)
- **Pipeline** propose (and, if privileged, decide/execute) watchlist seeds and catalog drafts
- **Internal POs** as **drafts** first; submit/approve only with privileged scopes

Does **not** scrape Shopee on every tool call — it reads/writes the Supabase warehouse. Use `bi_run_seed_now` + a collect worker for new pulls (privileged / ops profile).

### In-app Assistant vs MCP (do not confuse)

| Surface | Where | Best for |
|---------|--------|----------|
| **Catalog Assistant** | SKUMS web drawer (“Catalog AI”) | “How many products?”, brand counts, inventory, Actions queue |
| **MCP local (stdio)** | Cursor / Claude Desktop / `npm run mcp` | Engineers: study, draft POs, pipeline, BI |
| **MCP remote (cloud)** | `POST https://<host>/mcp` + API key | **Non-technical staff** via Claude custom integration (Phase R1) |
| **Actions UI** | `/actions` | Human submit/approve of MCP drafts |
| **Help** | `/help` | How-to / store ops; tools `help_resolve` / `help_get` / `help_list` |

Both use the same workspace DB and `XAI_API_KEY`. Catalog tools share `core/catalog` — totals are exact counts, not guesses.

### Remote MCP (cloud) — employee setup

1. Admin: **Settings → API keys → Create Claude / MCP key**
2. Employee: Claude → custom MCP integration  
   - **URL:** `https://fran-skums.vercel.app/mcp`  
   - **Auth:** `Authorization: Bearer sk_live_…`
3. Guide: `/help/connect-claude`

**Cloud always enforces safe scopes** (no `po_submit` / `pipeline_execute` / seed writes), even if the API key is over-scoped.

```http
POST /mcp
Authorization: Bearer sk_live_…
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"catalog_stats","arguments":{}}}
```

`GET /mcp` returns discovery (no auth). `GET /mcp/tools` lists tools (auth required).

---

## Scope profiles (M0 — required reading)

Agents must not silently submit POs, approve decisions, or execute pipeline writes. Use a **profile**.

| Profile | Env | Can do | Cannot do |
|---------|-----|--------|-----------|
| **safe** (default) | `FRAN_MCP_PROFILE=safe` or `FRAN_MCP_SCOPES=safe` or unset | Read BI, study, **propose** pipeline, **draft** POs, run projections | `po:submit`, `po:decide`, `pipeline:decide`, `pipeline:execute`, `intel:write` (seed upsert/run) |
| **full** (ops only) | `FRAN_MCP_PROFILE=full` or `FRAN_MCP_SCOPES=full` or `*` | Everything | — |
| **custom** | `FRAN_MCP_SCOPES=intel:read,po:draft,...` | Only listed scopes | Anything not listed |

### Safe scopes (explicit list)

```text
intel:read
study:write
pipeline:propose
po:draft
projection:run
```

### Full scopes (when unrestricted is intentional)

```text
intel:read,intel:write
study:write
pipeline:propose,pipeline:decide,pipeline:execute
po:draft,po:submit,po:decide
projection:run
```

**Default if `FRAN_MCP_SCOPES` is empty:** **safe** (not “all scopes”).  
To get the old unrestricted behavior: `FRAN_MCP_SCOPES=full` or `FRAN_MCP_PROFILE=full`.

### Agent contract (safe profile) — composite-first

Source of truth: `mcp/src/agentInstructions.mjs` (also returned on cloud `initialize.instructions` and stdio server instructions).

**Routing (one tool, then short answer):**

| Intent | Tool |
|--------|------|
| Catalog structure / “best products” / import readiness | `catalog_health` |
| Sample N products | `catalog_sample` |
| Category research | `catalog_search_summary` |
| CSV of filtered products | `catalog_export_csv` (max 200) |
| Retail/POS intent + market seed ideas | `catalog_data_ops` |
| Stock / status of product X | `product_inventory_status` |
| ATS by location | `inventory_ats` |
| What’s outstanding / transfers | `ops_snapshot` |
| Can I invoice / what exists? | `capabilities` |
| How-to | `help_resolve` → `help_get` |
| Draft buying intent | `po_*` draft / clone only |
| Draft store replenishment request | `store_ops_create_draft_request` (dry_run first; no Loft) |

**Answer style:** 1–2 tools max when a composite exists · lead with the answer · short bullets/table · use `agent_hint` · never invent counts/rankings · never use `product.stock_quantity` as stock · empty queues ≠ “transfers settled” · after draft → deep_link + human UI.

**Paste block (safe):**

```text
You are operating Fran SKUMS via MCP in SAFE mode unless told otherwise.
Composite-first: catalog_health | catalog_sample | catalog_search_summary | catalog_export_csv | catalog_data_ops | product_inventory_status | inventory_ats | ops_snapshot | capabilities | help_resolve | store_ops_create_draft_request.
Answer style: 1–2 tools then short answer; lead with the answer; no invented counts/rankings; no product.stock_quantity as ATS.
Draft/propose only. Never imply PO is ordered or product is live unless status says so.
PO clone: po_list/get → po_preview_clone → po_clone_as_draft → return deep_link (/actions/…). Stop for human Actions UI.
Store request: store_ops_create_draft_request (prefer dry_run) → deep_link /store-ops. Never approve or execute_3pl.
NO (safe/cloud): po_submit, po_decide, pipeline_decide, pipeline_execute, bi_upsert_seed, bi_run_seed_now, store approve, execute_3pl.
No invoices. Store Ops path for warehouse→store (not classic transfer object).
```

Preferred chat story: *“copy previous PO, remove Anua and 3CE”* → **draft only** → user opens **Actions** → Submit / Approve (owner/admin).

---

## Setup

1. Repo `.env` must include:

```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
XAI_API_KEY=...                  # live Grok briefs / projection commentary
FRAN_MCP_WORKSPACE_ID=<uuid>     # your Fran workspace

# --- M0 scope + attribution (recommended) ---
FRAN_MCP_PROFILE=safe
# or: FRAN_MCP_SCOPES=safe
# privileged machine only:
# FRAN_MCP_PROFILE=full

FRAN_MCP_CLIENT=cursor
# optional: your profiles.id for audit attribution (M1+)
# FRAN_MCP_ACTOR_USER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### How to get `FRAN_MCP_WORKSPACE_ID`

It is the **UUID of a row in `public.workspaces`**. You do not invent a random UUID.

**Recommended (app):**

1. `npm run dev`
2. Sign up / log in
3. Complete **onboarding** (creates a workspace via `create_workspace` RPC)
4. Run:

```bash
node scripts/print-workspace-id.mjs
```

5. Copy into `.env`:

```env
FRAN_MCP_WORKSPACE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

If the script prints **no workspaces**, you have not created one yet — finish onboarding first.  
Service role alone cannot create a normal workspace without a real user `profiles` row (`owner_id` is required).

2. Run from monorepo root:

```bash
npm run mcp
# or
node mcp/src/index.mjs
```

On start, stderr logs profile/scopes, e.g.:

```text
[fran-mcp] scopes=safe (profile=safe): intel:read,study:write,...
[fran-mcp] client=cursor
```

## Cursor / Claude Desktop config example

```json
{
  "mcpServers": {
    "fran-skums": {
      "command": "node",
      "args": ["C:/Users/Jeremy Tan/CodeProjects/fran-skums/mcp/src/index.mjs"],
      "env": {
        "FRAN_MCP_WORKSPACE_ID": "your-workspace-uuid",
        "FRAN_MCP_PROFILE": "safe",
        "FRAN_MCP_CLIENT": "cursor"
      }
    }
  }
}
```

Env vars can also come from the shell that launches the MCP process; the server loads repo `.env` automatically.

---

## Tools

### Catalog (Fran products — imported catalog Q&A)
| Tool | Scope |
|------|--------|
| `catalog_stats` | intel:read |
| `catalog_search` | intel:read |
| `catalog_get` | intel:read |

### Study
| Tool | Scope |
|------|--------|
| `study_start` | study:write |
| `study_get` / `study_list` | intel:read |
| `study_brief` | study:write |
| `study_match_catalog` | study:write |
| `study_propose` | pipeline:propose |
| `market_search` / `market_seller_mix` / `market_listing_history` | intel:read |

### Pipeline
| Tool | Scope |
|------|--------|
| `pipeline_propose` | pipeline:propose |
| `pipeline_list` | intel:read |
| `pipeline_decide` | pipeline:decide (**full** only) |
| `pipeline_execute` | pipeline:execute (**full** only) |

### BI
| Tool | Scope |
|------|--------|
| `bi_list_seeds` / `bi_job_status` / `bi_query_snapshots` / `bi_export_table` / `bi_list_metrics` / `bi_latest_digest` | intel:read |
| `bi_upsert_seed` / `bi_set_cadence` / `bi_run_seed_now` | intel:write (**full** only) |

### Internal POs + projections
| Tool | Scope |
|------|--------|
| `po_create_draft` / `po_update_draft` / `po_add_lines` | po:draft |
| `po_get` / `po_list` / `po_export` / `po_suggest_qty` | intel:read (+ draft for writes) |
| `po_submit` | po:submit (**full** only) |
| `po_decide` | po:decide (**full** only) |
| `projection_create` / `projection_from_po` / `projection_from_study` | projection:run |
| `projection_get` / `projection_list` / `projection_export` | intel:read |

---

## Typical agent flows

### Safe (default)

```text
study_start → study_brief → study_match_catalog → study_propose
po_create_draft / po_add_lines   # status stays draft
po_list / po_get                 # show human the draft id
# STOP — human submits/approves in SKUMS (or full-profile MCP)
```

### Full (ops)

```text
…propose → pipeline_decide(accepted) → pipeline_execute
po_submit → po_decide(approved)
bi_run_seed_now + worker process-jobs
```

---

## Audit (M1)

Mutating tools write `audit_events` with:

| Field | MCP value |
|-------|-----------|
| `source_type` | `mcp` |
| `metadata.tool_name` | e.g. `po_create_draft` |
| `metadata.client_name` | `FRAN_MCP_CLIENT` |
| `metadata.request_id` | per tool call UUID |
| `actor_user_id` | `FRAN_MCP_ACTOR_USER_ID` if set |

Tool responses include envelope fields: `object_type`, `id`, `status`, `is_draft`, `channel`, `next_allowed_actions`.

UI product create/update uses `source_type=ui`. API key creates use `source_type=api`.

Apply migration **052** on Supabase if not yet applied:

```bash
# core/db/052_audit_source_channels.sql
```

## Clone PO story (M2)

```text
po_list / po_get
  → po_preview_clone(source_po_id, exclude_brands: ["anua","3ce"])
  → po_clone_as_draft(...)   # always DRAFT
  → open deep_link /actions/internal-pos/:id in SKUMS
  → human Submit / Approve in UI
```

`FRAN_MCP_MODE=safe` hard-blocks submit/decide/execute even if scopes are full.

## UI (M3)

- **Actions** inbox: `/actions`
- Internal PO detail: `/actions/internal-pos/:id`
- Pipeline candidate: `/actions/pipeline/:id`

## Not in MCP yet

- Reconciliation packs (Phase 6)
- Browser collect inside MCP (use worker `process-jobs`)
- Email stakeholder notifs (Phase N — hooks via lifecycle events)

## Tests

```bash
node --test tests/mcp-scopes.test.mjs tests/audit-record.test.mjs tests/po-clone.test.mjs
```
