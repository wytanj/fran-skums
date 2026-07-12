# Commit Summary — 13 Jul 2026

**Repo:** fran-skums  
**Branch:** `main`  
**Scope:** MCP-ready SKUMS phases **M0–M4** (+ M3.5 UI polish)

## Theme

Make agent (MCP) work **draft-first**, **visible in UI**, and **auditable** (manual vs MCP), without silent production mutations.

---

## M0 — Safe MCP scopes

- Default profile **safe**: read + draft + propose only  
- `full` / `*` for privileged submit/decide/execute/seed writes  
- Startup logs profile + client  
- Env: `FRAN_MCP_PROFILE`, `FRAN_MCP_SCOPES`, `FRAN_MCP_CLIENT`, `FRAN_MCP_ACTOR_USER_ID`

## M1 — Audit channels

- Migration **052**: `audit_events.source_type` includes `ui | mcp | api | assistant | cron | worker`  
- `core/audit/record.mjs` + `server/utils/audit.ts`  
- MCP mutating tools write audit + response envelope (`is_draft`, `channel`, `next_allowed_actions`)  
- UI product create/update → `ui`; API product/PO create → `api`

## M2 — Clone PO tools

- `po_preview_clone` (read-only)  
- `po_clone_as_draft` (always draft + metadata + deep_link)  
- `pipeline_preview_execute`  
- `FRAN_MCP_MODE=safe` hard-blocks privileged scopes  
- Lifecycle events: `po.submitted`, `po.approved`, `po.rejected`, `pipeline.executed`

## M3 — Actions UI

- `/actions` inbox  
- `/actions/internal-pos/:id`  
- `/actions/pipeline/:id`  
- Sidebar **Actions**

## M3.5 — UI polish

- Channel badges from audit; tool_name; channel filter  
- Dashboard Actions queue counts  
- Inventory PO note → Actions  
- Draft edit (notes/qty/cost); copy link; relative times  

## M4 — Roles

- Owner/admin: approve/reject PO + pipeline decide  
- Member: view, edit draft, submit  
- Agent prompt contract in `mcp/README.md`  
- Role refreshed on workspace switch  

## Deploy notes

1. Apply SQL **052** on Supabase if not migrated:  
   `core/db/052_audit_source_channels.sql`  
2. Ensure MCP env uses `FRAN_MCP_PROFILE=safe` (or scopes) in production agent configs  
3. Vercel auto-deploy from `main` push  

## Verify

```bash
node --test tests/mcp-scopes.test.mjs tests/audit-record.test.mjs tests/po-clone.test.mjs
npm run dev   # open /actions
npm run mcp   # expect scopes=safe in stderr
```

## Next (not in this commit)

- Phase N stakeholder notifications  
- M5 import/POS draft consistency  
- Live scrape / Browserbase (parked)  
