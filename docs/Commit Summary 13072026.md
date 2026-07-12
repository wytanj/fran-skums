# Commit Summary — 13 Jul 2026

**Repo:** fran-skums  
**Branch:** `main`  
**SHA:** `650148e` (+ follow-up summary note)  
**Scope:** MCP-ready SKUMS phases **M0–M4** (+ M3.5 UI polish)

## Theme

Make agent (MCP) work **draft-first**, **visible in UI**, and **auditable** (manual vs MCP), without silent production mutations.

---

## M0 — Safe MCP scopes

| Profile | Can do | Cannot do |
|---------|--------|-----------|
| **safe** (default) | Read BI, study, propose pipeline, **draft** POs, projections | submit/approve PO, decide/execute pipeline, write crawl seeds |
| **full** | Everything | — |

- Env: `FRAN_MCP_PROFILE`, `FRAN_MCP_SCOPES`, `FRAN_MCP_MODE`, `FRAN_MCP_CLIENT`, `FRAN_MCP_ACTOR_USER_ID`
- Empty scopes no longer mean “all” → default **safe**
- Startup logs profile + client on `npm run mcp`

### Scope names (quick)

| Scope | Meaning |
|-------|---------|
| `intel:read` | List/get/export warehouse data, previews |
| `study:write` | Study sessions / brief / match |
| `pipeline:propose` | Create proposed candidates |
| `po:draft` | Create/edit/clone **draft** decision POs |
| `projection:run` | Projection runs |
| `intel:write` | Seed upsert / run jobs (**privileged**) |
| `pipeline:decide` / `pipeline:execute` | Accept + write seeds/products (**privileged**) |
| `po:submit` / `po:decide` | Submit + approve PO (**privileged**) |

---

## M1 — Audit channels

- Migration **052**: `audit_events.source_type` includes `ui | mcp | api | assistant | cron | worker`
- **Applied on DB** (local `npm run db:migrate -- --from 052 --to 052`) 2026-07-13
- MCP mutations → `source_type=mcp` + `tool_name` / `request_id`
- UI product create/update → `ui`; API creates → `api`
- Response envelope: `object_type`, `id`, `status`, `is_draft`, `channel`, `next_allowed_actions`

---

## M2 — Clone PO tools

- `po_preview_clone` — read-only keep/drop by brand/sku/title  
- `po_clone_as_draft` — always **DRAFT** + metadata + `deep_link`  
- `pipeline_preview_execute` — dry-run  
- `FRAN_MCP_MODE=safe` hard-blocks privileged scopes  
- Lifecycle events: `po.submitted`, `po.approved`, `po.rejected`, `pipeline.executed`

---

## M3 — Actions UI

| Route | Purpose |
|-------|---------|
| `/actions` | Inbox: draft / pending / pipeline / recent |
| `/actions/internal-pos/:id` | Decision PO detail |
| `/actions/pipeline/:id` | Pipeline candidate detail |

Sidebar **Actions** entry.

---

## M3.5 — UI polish

- Channel badges from audit; tool_name; channel filter  
- Dashboard Actions queue counts  
- Inventory PO note → Actions (warehouse vs decision PO)  
- Draft edit notes/qty/cost; copy deep link; relative times  

---

## M4 — Roles

| Role | Can |
|------|-----|
| Member | View Actions, edit draft, submit for approval |
| Owner / admin | Approve/reject PO; pipeline accept/reject/defer |

Agent system-prompt contract in `mcp/README.md`.

---

## Deploy notes

1. ~~Apply 052~~ done on project used by `SUPABASE_DB_URL`  
2. Confirm Vercel production DB has 052 if it is a **different** project  
3. MCP agents: `FRAN_MCP_PROFILE=safe` unless deliberately full  
4. Production: https://fran-skums.vercel.app  

## Verify

```bash
node --test tests/mcp-scopes.test.mjs tests/audit-record.test.mjs tests/po-clone.test.mjs
npm run mcp          # stderr: scopes=safe
# App: /actions after login
```

## Next

- Phase N stakeholder notifications  
- M5 import/POS draft consistency  
- Live scrape / Browserbase (parked)  
