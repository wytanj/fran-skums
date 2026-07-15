# Fran SKUMS — TODO (implementation queue)

**Date:** 2026-07-15  
**Shipped on `main`:** **M0–M6**, Help Center, **Phase R1** remote MCP, **Loft P–E** + operator docs + assistant Help tools (see `TODO-LOFT.md` · `docs/Commit Summary 15072026.md`)  
**DB:** migrations **001–063** (063 = API key bound_user / soft revoke for A2).  
**Held:** **R2 OAuth** (remote MCP stays API-key until org permissioning is solid)  
**Parked:** Live Shopee scrape / Browserbase / brand radar  
**Production:** https://fran-skums.vercel.app  
**Plans:** This file · **`TODO-LOFT.md`** · **`docs/MCP_ACTION_BACKLOG.md`** (MCP composites #1–8 + leftovers) · `docs/MCP_USER_PERMISSION_DESIGN.md` · `docs/SKUMS_OPERATOR_RUNBOOK.md` · `docs/ORG_PERMISSION_SCOPES.md` · `docs/LOFT_OPS_DICTIONARY.md` · `mcp/README.md`

---

## Start here next

**Shipped:** Loft P–F · Claude MCP · composites **#1–8** · **A2.1–A2.4**.  
**POS:** restructuring against `fran-pos/docs/SKUMS_INVENTORY_STRUCTURE_HANDOFF.md`.  
**Focus now:** ops polish / Phase N notifications / Loft Phase 0 email.  
**A2 remaining:** optional bind-other-user UI; R2 OAuth later.

| Priority | Track | First tasks |
|----------|--------|-------------|
| **A** | **MCP composite tools** | **#1–8 ✅** — full list below · living backlog **`docs/MCP_ACTION_BACKLOG.md`** |
| **A2** | **MCP ↔ web login permissions** | **A2.1–A2.4 ✅** — `docs/MCP_USER_PERMISSION_DESIGN.md` · mig **063** · key recap on role change / revoke on remove |
| **B (ops)** | **Loft Phase 0 close-out** | Send Loft email; paste URLs / delivery_method_ids |
| **C** | **Phase N** | Notifications on store requests / exceptions |
| **D** | **Phase P remaining** | `requireScope` on legacy routes; empty API keys ≠ full |
| **E** | **Phase R** | R1 pilot (Claude works with URL key); **R2 OAuth held** |
| **F** | **M6.5** — audit explorer | Filter mcp / store_ops channels |
| **G (parked)** | Scrape / brand radar | Linux + Browserbase smoke |

### MCP composites #1–8 (shipped) — index

Canonical detail + optional leftovers: **`docs/MCP_ACTION_BACKLOG.md`**.

| # | What | MCP tools (main) | Catalog AI twins (where applicable) |
|---|------|------------------|-------------------------------------|
| **1** | Catalog research speed | `catalog_health`, `catalog_sample`, `catalog_search_summary` | `get_catalog_health`, `sample_products`, `search_products_summary` |
| **2** | Stock / logistics status | `inventory_ats`, `product_inventory_status` | `get_inventory_ats`, `get_product_inventory_status` |
| **3** | Ops queues + “what can I do?” | `ops_snapshot`, `capabilities` | `get_ops_snapshot`, `get_capabilities` |
| **4** | Instructions (composite-first) | `mcp/src/agentInstructions.mjs` (cloud `initialize` + stdio) | `assistantPrompt.ts` routing table |
| **5** | Bounded CSV export | `catalog_export_csv` | `export_catalog_csv` |
| **6** | Retail/POS intent + market seed plan | `catalog_data_ops` | `get_catalog_data_ops` |
| **7** | Draft store replenishment request | `store_ops_create_draft_request` (+ list/waves/recommend) | *(MCP-first write; use Store Ops UI for HQ)* |
| **8** | Ops digests + more safe drafts | `expiry_snapshot`, `exceptions_snapshot`, `integrations_health`, `attention_snapshot`, `low_stock_request_pack`, `pos_enable_proposal`, `inbound_create_draft`, `floor_adjustment_create_draft` | `get_expiry_snapshot`, `get_exceptions_snapshot`, `get_integrations_health`, `get_attention_snapshot`, `get_low_stock_request_pack`, `get_pos_enable_proposal` |

**Cloud permission model (A2):** tools allowed when **key ∩ bound web user** has the scope. Owner/admin packages include `store_ops:approve` (and optionally execute_3pl). Member/viewer keys do not. Credentials never on cloud keys. Bulk POS activate still UI-only.

### Quick smoke (post-deploy)

```bash
npm run db:migrate:status    # expect 063 applied (api key bound_user / soft revoke)
# Production: https://fran-skums.vercel.app
#  Settings → Team: demote/remove member → bound MCP keys recapped/revoked
#  Settings → API Keys: soft revoke
#  Catalog AI / MCP: capabilities → key_permissions (web-aligned)
node --test tests/effective-scopes-a2.test.mjs tests/api-key-lifecycle-a24.test.mjs tests/tool-scopes-capabilities.test.mjs
```

### Ops leftovers

- [x] Help **053/054** on shared Supabase
- [x] Loft **055–057** applied
- [x] **058–061** applied (shared project)
- [x] Pushed Loft P–E + operator docs + assistant Help (this commit)
- [ ] Confirm Vercel production deploy green for latest `main`
- [ ] Confirm prod Supabase has **058–060** if not the same project
- [ ] Fill Vercel **`SUPABASE_DB_URL`** if empty in prod
- [ ] Optional: `FRAN_MCP_ACTOR_USER_ID` for local MCP attribution
- [ ] Secret rotation / Vercel env audit
- [ ] Note: **015** checksum-mismatch (historical; use `--from N`)

---

## North star (current product)

**v1–v2:** Agents draft; humans approve in Actions; remote MCP safe keys.  
**v3 Loft retail:** POS signals only; HQ decides (MCP advice); Loft warehouse; store receive + exception verify; floor apply via ledger.

**Success (v3 MVP + E):** ASN → LOFT-SG → Mon/Thu or lift → receive with exceptions → floor damage/found/count apply to ledger · operators use Help + Catalog AI for how-to.

---

## Migrations (local / shared)

| Status | Notes |
|--------|--------|
| **052–054** | audit, help, connect-claude |
| **055–057** | Loft permissions/topology; waves; inbound ASN |
| **058–060** | Floor adjustment apply; Help store-ops; operator-runbook |
| **015 checksum-mismatch** | Historical; `--from N` for new migrations |
| **Next SQL** | Phase F delivery calendars / wave cutoffs if schema needed |

---

## Completed (do not redo) — pointer

See historical sections in git history for M0–M6, R1, N design, P design.  
**Loft:** P–E code + docs in `TODO-LOFT.md`.  
**Operator:** `docs/SKUMS_OPERATOR_RUNBOOK.md` · `/help/*`.

### Phase N — Stakeholder notifications (still planned)

Principles and N1–N6 model remain in prior revisions / design notes; build after Store Ops inbox is stable. Do not block Phase F on email.

### Phase P — Org scopes (remaining)

- [x] Catalog design + Loft fine-grained scopes seeded (055)
- [x] `resolveScopes` / `requireScope` for store-ops surfaces
- [ ] Sign-off empty key ≠ full; gate all legacy integration routes
- [ ] App install grants UI polish
- [ ] R2 OAuth after packages solid

### Phase R

- [x] R1 remote MCP
- [ ] R1 human pilot
- [ ] R2 OAuth held

---

## Definition of done (quick)

| Check | Pass |
|-------|------|
| Floor apply | Pending adjustment → Apply → ledger |
| Help AI | resolve_help + get_help_article for store ops |
| POS live receive free-form | Disabled; Receive delivery for Loft |
| Deploy | Vercel green; migrations 058–060 on DB used by prod |

---

## Explicitly parked

- Live scrape / Browserbase / brand radar  
- Phase H ecommerce  
- R2 OAuth until Phase P packages on consent screen  

---

## Suggested build order

```text
M0–M6 + R1 + Loft P–F + ops docs + Claude URL-key MCP   ✅
─────────────────
MCP speed / ability-to-act (from docs/sample-mcp-responses.md):
  1  catalog_health + catalog_sample + catalog_search_summary   ✅
  2  inventory_ats + product_inventory_status (lifecycle / path)   ✅
  3  ops_snapshot + capabilities (queues + what can/cannot)   ✅
  4  Tighten cloud MCP + Catalog AI instructions (composite-first)   ✅
  5  catalog_export_csv (bounded filter export)   ✅
  6  catalog_data_ops (retail/POS intentional + seed plan)   ✅
  7  store_ops_create_draft_request (write draft/submit signal; no execute_3pl)   ✅
  8  Further MCP actions (read composites + safe drafts)   ✅
       See table “MCP composites #1–8” above
       Living backlog / leftovers: docs/MCP_ACTION_BACKLOG.md
─────────────────
A2 MCP ↔ web login permissions:
  A2.1 resolveEffectiveScopes + mcp:* packages     ✅
  A2.2 mig 063 bound_user / soft revoke + Settings  ✅
  A2.3 MCP auth + Catalog AI tool filter           ✅
  A2.4 member lifecycle recap/revoke + audit       ✅
       PUT  /api/v1/workspace/members/:id/role
       DELETE /api/v1/workspace/members/:id
  A2.5 optional: bind key to other member UI · R2 OAuth
  Cloud MCP: permission-gated approve (not blanket block)   ✅
       store_ops_decide · floor_adjustment_apply · scopes ∩ web role
─────────────────
Parallel / later:
  0.x  Loft email answers → dictionary IDs
  N    notifications
  P remaining · R1 pilot polish
  G    connector cancel/hold / recon
```

**Recommended next (eng):** Phase N notifications · Loft Phase 0 email · optional A2.5 bind-other-user UI.  
**Owner model:** one owner seat (appoints admins); multiple admins for ops/keys.  
**Ops:** send Phase 0 Loft email when ready.

---

## Links

- Production: https://fran-skums.vercel.app  
- Remote MCP: `https://fran-skums.vercel.app/mcp` · Help: `/help/operator-runbook`  
- Operator runbook: `docs/SKUMS_OPERATOR_RUNBOOK.md`  
- **MCP composites backlog (#1–8 + optional later):** `docs/MCP_ACTION_BACKLOG.md`  
- **MCP ↔ web permissions (A2):** `docs/MCP_USER_PERMISSION_DESIGN.md`  
- Commit summary: `docs/Commit Summary 15072026.md`  
- Org scopes: `docs/ORG_PERMISSION_SCOPES.md`  
- Loft plan: `TODO-LOFT.md`  
- MCP setup: `mcp/README.md`  

