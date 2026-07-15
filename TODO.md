# Fran SKUMS — TODO (implementation queue)

**Date:** 2026-07-15  
**Shipped on `main`:** **M0–M6**, Help Center, **Phase R1** remote MCP, **Loft P–E** + operator docs + assistant Help tools (see `TODO-LOFT.md` · `docs/Commit Summary 15072026.md`)  
**DB:** migrations **001–061** on shared Supabase (058 floor; 059–060 Help; 061 calendars; apply `--from 058` if a host lags).  
**Held:** **R2 OAuth** (remote MCP stays API-key until org permissioning is solid)  
**Parked:** Live Shopee scrape / Browserbase / brand radar  
**Production:** https://fran-skums.vercel.app  
**Plans:** This file · **`TODO-LOFT.md`** · `docs/SKUMS_OPERATOR_RUNBOOK.md` · `docs/ORG_PERMISSION_SCOPES.md` · `docs/LOFT_OPS_DICTIONARY.md` · `mcp/README.md`

---

## Start here next

**Shipped:** Loft P–F · Claude URL-key MCP · MCP composites **#1–7** (incl. draft store request).  
**POS:** restructuring against `fran-pos/docs/SKUMS_INVENTORY_STRUCTURE_HANDOFF.md`.  
**Focus now:** **#8 review** — further MCP actions across the app (`docs/MCP_ACTION_BACKLOG.md`).  
**Later:** MCP user permission + scopes (members ↔ connector keys).

| Priority | Track | First tasks |
|----------|--------|-------------|
| **A** | **MCP composite tools** | #1–7 ✅ · **#8 action backlog for review** |
| **A2 (later)** | **MCP user permission + scopes** | Map workspace member scopes ↔ MCP/API keys (deferred) |
| **B (ops)** | **Loft Phase 0 close-out** | Send Loft email; paste URLs / delivery_method_ids |
| **C** | **Phase N** | Notifications on store requests / exceptions |
| **D** | **Phase P remaining** | `requireScope` on legacy routes; empty API keys ≠ full |
| **E** | **Phase R** | R1 pilot (Claude works with URL key); **R2 OAuth held** |
| **F** | **M6.5** — audit explorer | Filter mcp / store_ops channels |
| **G (parked)** | Scrape / brand radar | Linux + Browserbase smoke |

### Quick smoke (post-deploy)

```bash
npm run db:migrate:status    # expect 058–061 applied
# Production: https://fran-skums.vercel.app
#  /store-ops → Floor adjustments · Waves & calendar
#  /help/operator-runbook
#  Catalog AI: "How do I approve a store replenishment request?"
node --test tests/inventory-ats.test.mjs tests/catalog-composite.test.mjs tests/ops-snapshot.test.mjs tests/mcp-instructions.test.mjs tests/catalog-export-data-ops.test.mjs tests/store-ops-draft-request.test.mjs
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
  8  Further MCP actions across the app — REVIEW BACKLOG
       → docs/MCP_ACTION_BACKLOG.md
       candidates: expiry_snapshot, exceptions digests, draft ASN,
       floor-adj draft only, low-stock→request pack, integrations health,
       attention queue, POS-enable proposals (no bulk flip)
─────────────────
Next / deferred:
  · A2 MCP user permission + scopes (workspace members ↔ connector keys)
  · Fast path already: capabilities → key_permissions.permitted_actions (this key)
─────────────────
Parallel / later:
  0.x  Loft email answers → dictionary IDs
  N    notifications
  P remaining · R1 pilot polish
  G    connector cancel/hold / recon
```

**Recommended next (eng):** **Review #8** (`docs/MCP_ACTION_BACKLOG.md`) and pick v1 items.  
**Later:** MCP user permission + scopes (members relative to connector).  
**Ops:** send Phase 0 Loft email when ready.

---

## Links

- Production: https://fran-skums.vercel.app  
- Remote MCP: `https://fran-skums.vercel.app/mcp` · Help: `/help/operator-runbook`  
- Operator runbook: `docs/SKUMS_OPERATOR_RUNBOOK.md`  
- Commit summary: `docs/Commit Summary 15072026.md`  
- Org scopes: `docs/ORG_PERMISSION_SCOPES.md`  
- Loft plan: `TODO-LOFT.md`  
- MCP: `mcp/README.md`  
