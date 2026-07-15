# Fran SKUMS — TODO (implementation queue)

**Date:** 2026-07-15  
**Production:** https://fran-skums.vercel.app  
**DB:** migrations **001–063** applied on shared project (063 = API key `bound_user` / soft revoke).  
**Held / parked:** R2 OAuth · live scrape / Browserbase / brand radar · Phase H ecommerce  

**Plans (do not lose track):**

| Doc | Role |
|-----|------|
| **This file** | Implementation queue + MCP #1–8 index |
| **`docs/MCP_ACTION_BACKLOG.md`** | MCP tools detail, leftovers after #8 |
| **`docs/MCP_USER_PERMISSION_DESIGN.md`** | Web ↔ MCP permission model (A2) |
| **`docs/ORG_PERMISSION_SCOPES.md`** | Canonical scope catalog |
| **`TODO-LOFT.md`** | Loft / store-ops / 3PL plan |
| **`docs/SKUMS_OPERATOR_RUNBOOK.md`** | Operator how-to |
| **`mcp/README.md`** | MCP setup (stdio + cloud) |

---

## Start here next

**Shipped:** Loft P–F · remote MCP · composites **#1–8** · **A2.1–A2.4** · **permission-gated cloud approve**.  
**POS:** restructure against `fran-pos/docs/SKUMS_INVENTORY_STRUCTURE_HANDOFF.md` (other team).  

| Priority | Track | Status / next |
|----------|--------|----------------|
| **A** | MCP composites #1–8 | **Done** — see index below · backlog file for leftovers |
| **A2** | Web ↔ MCP permissions | **Core done** — optional A2.5 bind-other-user UI |
| **B** | Loft Phase 0 close-out | **Ops:** send Loft email; paste dictionary / delivery_method_ids |
| **C** | Phase N notifications | Store request / exception notify (design exists) |
| **D** | Phase P remaining | Empty API key ≠ full on non-MCP keys; legacy route gates |
| **E** | Phase R pilot | Humans use Claude connector; R2 OAuth held |
| **F** | M6.5 audit explorer | Filter mcp / store_ops / api_key events |
| **G** | Scrape / brand radar | Parked |

---

## Permission model (current understanding)

**One rule for UI and cloud MCP:**

```text
effective power = key package  ∩  bound user’s web role/scopes  ∩  (no credentials on cloud keys)
```

| Role | Who | Web | Cloud MCP (bound key) |
|------|-----|-----|------------------------|
| **Owner** | Single seat (`workspaces.owner_id`) — e.g. CEO/CTO (Jeremy) | Appoint **admins**, all ops, keys | `mcp:ops_safe` → approve + drafts if web has scopes |
| **Admin** | **Many** (appointed by owner) | Ops, keys, members/viewers; **not** appoint admins | Same as owner for MCP tools when scoped |
| **Member** | Staff | Schema-based write | Drafts/reads; **no** `store_ops:approve` |
| **Viewer** | Read-only | Reads | Reads only |

| Action | Scope | MCP tool (if any) |
|--------|--------|-------------------|
| Create store request | `store_ops:write` | `store_ops_create_draft_request` |
| **Approve / reject / defer** | `store_ops:approve` | **`store_ops_decide`** (cloud OK when scoped) |
| Apply floor adj to ledger | `inventory:write` | **`floor_adjustment_apply`** |
| Send order to Loft | `store_ops:execute_3pl` (+ connection) | Scope may exist; full send still mainly **Store Ops UI** |
| Revoke API keys | `api:write` (owner/admin) | Settings only (not an MCP tool) |
| Credentials | never on cloud keys | — |

**Onus on owner/admin:** design permission schemas + who is admin so web and Claude stay aligned. Recreate Claude keys after role changes if needed (`mcp:ops_safe` + bind self). Member remove → keys revoked (A2.4).

Detail: **`docs/MCP_USER_PERMISSION_DESIGN.md`**.

---

## MCP composites #1–8 (shipped)

Living detail + optional later work: **`docs/MCP_ACTION_BACKLOG.md`**.

| # | Purpose | MCP tools | Catalog AI |
|---|---------|-----------|------------|
| **1** | Catalog research | `catalog_health`, `catalog_sample`, `catalog_search_summary` | `get_catalog_health`, `sample_products`, `search_products_summary` |
| **2** | Stock / path (Loft→store) | `inventory_ats`, `product_inventory_status` | `get_inventory_ats`, `get_product_inventory_status` |
| **3** | Queues + permissions | `ops_snapshot`, `capabilities` | `get_ops_snapshot`, `get_capabilities` |
| **4** | Composite-first instructions | `mcp/src/agentInstructions.mjs` | `assistantPrompt.ts` |
| **5** | Bounded CSV | `catalog_export_csv` | `export_catalog_csv` |
| **6** | Retail/POS intent + seeds | `catalog_data_ops` | `get_catalog_data_ops` |
| **7** | Store request draft + **HQ decide** | `store_ops_create_draft_request`, list/waves/recommend, **`store_ops_decide`** | reads via ops tools; writes MCP-first |
| **8** | Digests + more drafts + apply floor | `expiry_snapshot`, `exceptions_snapshot`, `integrations_health`, `attention_snapshot`, `low_stock_request_pack`, `pos_enable_proposal`, `inbound_create_draft`, `floor_adjustment_create_draft`, **`floor_adjustment_apply`** | `get_expiry_*`, `get_exceptions_*`, `get_integrations_*`, `get_attention_*`, `get_low_stock_request_pack`, `get_pos_enable_proposal` |

**Not in scope for cloud MCP (by product choice):** bulk POS activate, invoices/AR, live scrape every call, credential management.

**Optional leftovers** (see backlog file): forecast summary, import job status, bind key to *other* user UI, full `execute_3pl` send-to-Loft tool with shipping payload.

---

## Quick smoke

```bash
npm run db:migrate:status    # 063 applied
# https://fran-skums.vercel.app
# Settings → Claude MCP key (mcp:ops_safe, bound to you) → capabilities
# Owner: store_ops_decide in permitted tools; viewer key: not present
node --test tests/effective-scopes-a2.test.mjs tests/api-key-lifecycle-a24.test.mjs tests/tool-scopes-capabilities.test.mjs tests/mcp-backlog-8.test.mjs
```

### Ops / env leftovers

- [x] Migrations **058–063** on shared project (063 A2 keys)
- [ ] Confirm prod deploy green after each push
- [ ] Confirm prod DB has **063** if not same project as local migrate
- [ ] Fill Vercel **`SUPABASE_DB_URL`** if empty
- [ ] Optional: `FRAN_MCP_ACTOR_USER_ID` local attribution
- [ ] Secret rotation / Vercel env audit
- [ ] **015** checksum-mismatch historical (use `--from N` / `--only`)

---

## North star

**Agents draft and, when scoped, HQ-approve; humans still own Loft send and credentials.**  
**v3 Loft retail:** POS = signal · HQ decide (UI or MCP with `store_ops:approve`) · Loft warehouse · receive + exception · floor apply (UI or MCP with `inventory:write`).

---

## Completed tracks (do not redo)

- M0–M6 · Help · R1 remote MCP · Loft P–E · MCP composites **#1–8** · **A2.1–A2.4** · permission-gated cloud approve  
- Detail in git history / `TODO-LOFT.md` / commit summaries  

### Phase N — notifications (still planned)

N1–N6 design exists; build after store-ops inbox is stable.

### Phase P — remaining

- [x] Scope catalog + Loft packages + store-ops requireScope surfaces  
- [x] MCP effective scopes = web ∩ key  
- [ ] Empty non-MCP keys ≠ full (legacy)  
- [ ] App install grants UI polish  
- [ ] R2 OAuth after packages solid  

### Phase R

- [x] R1 remote MCP + URL key + permission-based tools  
- [ ] R1 human pilot (Claude connector)  
- [ ] R2 OAuth held  

---

## Definition of done (smoke)

| Check | Pass |
|-------|------|
| Floor apply | Pending → apply (UI or MCP `floor_adjustment_apply` if scoped) |
| Store approve | Owner/admin MCP: `store_ops_decide`; member cannot |
| Help AI | resolve_help for store ops how-to |
| Keys | Owner/admin revoke; remove member revokes bound keys |
| Deploy | Vercel green; mig **063** on prod DB |

---

## Explicitly parked

- Live scrape / Browserbase / brand radar  
- Phase H ecommerce  
- R2 OAuth until packages + pilot solid  

---

## Suggested build order (status)

```text
M0–M6 + R1 + Loft P–F + MCP composites #1–8 + A2.1–A2.4   ✅
─────────────────
MCP composites (docs/MCP_ACTION_BACKLOG.md):
  1 catalog_health / sample / search_summary     ✅
  2 inventory_ats / product_inventory_status     ✅
  3 ops_snapshot / capabilities                  ✅
  4 agent instructions composite-first           ✅
  5 catalog_export_csv                           ✅
  6 catalog_data_ops                             ✅
  7 store_ops draft + decide (scoped approve)    ✅
  8 digests + inbound/floor drafts + apply floor ✅
  leftovers: forecast, import jobs, bind-other UI, full Loft send tool
─────────────────
A2 permissions (docs/MCP_USER_PERMISSION_DESIGN.md):
  A2.1–A2.4 + cloud permission-gated approve     ✅
  A2.5 optional bind key to other member UI
─────────────────
Next eng:
  N   notifications
  0.x Loft email / dictionary IDs
  P   empty-key legacy, install UI
  R   human pilot
  F   audit explorer filters
```

**Recommended next:** Phase N notifications · Loft Phase 0 email · Claude pilot with **new** `mcp:ops_safe` key.  
**Owner model:** one owner appoints admins; many admins for ops/keys.

---

## Links

- Production: https://fran-skums.vercel.app  
- Remote MCP: `https://fran-skums.vercel.app/mcp`  
- Help: `/help/operator-runbook`  
- **MCP composites #1–8 + leftovers:** `docs/MCP_ACTION_BACKLOG.md`  
- **MCP ↔ web permissions:** `docs/MCP_USER_PERMISSION_DESIGN.md`  
- Org scopes: `docs/ORG_PERMISSION_SCOPES.md`  
- Operator runbook: `docs/SKUMS_OPERATOR_RUNBOOK.md`  
- Loft plan: `TODO-LOFT.md`  
- MCP setup: `mcp/README.md`  
