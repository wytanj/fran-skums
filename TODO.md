# Fran SKUMS — TODO (implementation queue)

**Date:** 2026-07-16  
**Production:** https://fran-skums.vercel.app  
**DB:** migrations **001–066** (065 = inventory_manager · 066 = report registry).  
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

**Shipped:** Loft P–F · remote MCP · composites **#1–8** · **A2.1–A2.4** · permission-gated cloud approve · **Phase N N1–N4** · Claude connector · **M1–M3** · **K Rpt-0–2** (scopes + toggle UI + 3 seed packs).  
**Claude pilot:** **Working** (2026-07-16) — tools list non-empty; use URL  
`https://fran-skums.vercel.app/mcp/c/sk_live_…` (OAuth blank; Settings → Create Claude / MCP key).  
**POS:** structure handoff `fran-pos/docs/SKUMS_INVENTORY_STRUCTURE_HANDOFF.md` — roles/MCP next section below.

| Priority | Track | Status / next |
|----------|--------|----------------|
| **A** | MCP composites #1–8 | **Done** |
| **A2** | Web ↔ MCP permissions | **Core done** — optional A2.5 bind-other UI |
| **B** | Loft Phase 0 close-out | **Ops:** Loft email / dictionary IDs |
| **C** | Phase N | **N1–N4 done** — N6 email later |
| **D** | Phase P remaining | **Empty key ≠ full** shipped; install UI / R2 still open |
| **E** | Phase R / Claude pilot | **Done (tools live)** · R2 OAuth held |
| **H** | HQ schemas | **Done** — Inventory Manager (mig **065** applied) |
| **I** | MCP M1–M3 packs | **Shipped** — `store_request_status`, `floor_adjustment_queue`, `exception_verify` |
| **J** | **Supplier order lifecycle (KR/HK)** | **Planned** — MCP draft editable · affirm · **FOB PDF → in transit** (below) |
| **K** | **Agentic report registry** | **Rpt-0–2 done** — scopes · `/reports` toggle UI · 3 seeds; next Rpt-3 cron |
| **S** | **Login MFA = Google Workspace** | **Planned (ops policy)** — not in-app TOTP (below) |
| **F** | M6.5 audit explorer | Filter mcp / store_ops / api_key |
| **G** | Scrape / brand radar | Parked |

### Claude / remote MCP (verified)

| Item | Status |
|------|--------|
| Remote endpoint | `POST/GET https://fran-skums.vercel.app/mcp` |
| Personal connector URL | **`/mcp/c/sk_live_…`** preferred (`?api_key=` also OK; `?api=` alias) |
| Key template | Settings → **Create Claude / MCP key** → `mcp:ops_safe` ∩ bound user |
| Streamable HTTP | GET SSE → 405 (POST-only JSON-RPC); auth errors stay HTTP 200 JSON-RPC |
| Package scopes | `mcp:ops_safe` **expanded** before `tools/list` (fix empty-tools bug) |
| OAuth | Leave blank; key in URL |
| Human pilot | **Working** — connector shows tools |

**Smoke after key create:** reconnect Claude → tools include `capabilities`, `catalog_health`, `ops_snapshot`.

---

## Roles & MCP next (from fran-pos + SKUMS)

Two permission planes — **do not merge them**:

| Plane | Who | Auth | Powers |
|-------|-----|------|--------|
| **POS terminal** | `cashier` · `manager` · `admin` · `owner` (local PIN) | PIN / session on tablet | Sale, receive, floor **report**, request stock (manager+) only |
| **SKUMS workspace** | `viewer` · `member` · schemas · **admin** · **owner** | Google SSO (**MFA on Workspace**) | HQ decide, verify, floor apply, Loft, keys, MCP |
| **Machine keys** | `pos_connector` · `mcp:ops_safe` · etc. | API key | Cap = package ∩ bound user ∩ no credentials on cloud |

### POS roles (fran-pos — UI only; key never has HQ scopes)

| POS role | Sale | Floor report | Receive + exception report | Request stock | SKUMS HQ / MCP / Loft |
|----------|------|--------------|----------------------------|---------------|------------------------|
| `cashier` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `manager` | ✓ | ✓ | ✓ | ✓ signal only | ✗ |
| `admin` / `owner` | ✓ | ✓ | ✓ | ✓ signal only | ✗ (still no SKUMS HQ on POS key) |

POS manager/admin is **store floor leadership**, not SKUMS workspace admin.

### SKUMS roles that should exist clearly next

| SKUMS role / schema | Who | Web | Cloud MCP package |
|---------------------|-----|-----|-------------------|
| **Owner** | Single seat | Appoint admins, all ops, keys; Workspace MFA required | `mcp:ops_safe` |
| **Admin** | Many, appointed | Ops, keys, members; not appoint owner; Workspace MFA required | `mcp:ops_safe` |
| **Inventory manager** (schema) | HQ buyer/ops | `store_ops:approve` + `verify` + `inventory:write`; optional no `execute_3pl` | `mcp:ops_safe` or subset |
| **Member / store associate** | Staff in HQ tool | Drafts + reads; no approve | `mcp:member` / `mcp:store` |
| **Viewer** | Read-only | Reads | `mcp:viewer` |

**Not a SKUMS login role:** POS `cashier` — they only hit APIs via the shared `pos_connector` key.

### MCP actions that make sense **next** (ordered by POS → HQ loop)

POS already creates work in SKUMS. HQ Claude should close that loop faster.

| # | Action | Why (POS trigger) | Scope | Priority |
|---|--------|-------------------|-------|----------|
| **M1** | `store_request_status` | Manager requested stock; HQ one-shot context | `store_ops:read` | **Done** |
| **M2** | `floor_adjustment_queue` | Cashier floor reports pile up | `store_ops:read` | **Done** |
| **M3** | `exception_verify` | Receive short/damage HQ verify | `store_ops:verify` | **Done** |
| **M4** | `store_ops_send_to_loft` (shipping payload + connection) | After approve_now, humans still UI-only | `store_ops:execute_3pl` | Medium (after Loft Phase 0 IDs) |
| **M5** | `pos_sync_health` (sale outbox lag / failed inventory-events if SKUMS sees them) | Phase2 POS manager surface | `pos:read` / intel | Medium |
| **M6** | Forecast / low-stock → draft request pack polish | Complements POS request | already partial | Low |
| **M7** | Import job status | Catalog ops, not POS | intel | Low |

**Already good for POS loop (keep using):**  
`ops_snapshot` · `store_ops_list_requests` · `store_ops_recommend` · `store_ops_decide` · `exceptions_snapshot` · `floor_adjustment_apply` · `inventory_ats` · `product_inventory_status` · Phase N inbox.

**Never on POS key or cashier MCP:** approve · verify · execute_3pl · credentials · appoint admin · key revoke.

### Recommended build order (post-pilot)

```text
1–4  M1–M3 + Inventory Manager schema + empty-key ≠ full   ✅
5. Loft Phase 0 ops IDs → then M4 send_to_loft tool
6. Supplier order lifecycle (J) — MCP draft editable; affirm ack; **in transit on FOB PDF**
7. Agentic report registry (K) — scopes + toggles + seed packs (marketing / warehouse / finance)
8. Demand MA nightly + reorder sections inside K (store_fill vs supplier_buy)
9. Phase S — Workspace MFA policy + optional SKUMS step-up for dangerous actions
10. Optional: A2.5 bind key to other user; audit explorer; N6 email
```

---

## Agentic report registry (track K) — planned

**Product idea:** One place to **register sectionized agentic reports** (daily / weekly packs) for different audiences. Each subscription has an **on/off toggle**. Permission to use reports and n8n-style automations is a **scope plane** (same vocabulary as MCP packages).

### Principles

| # | Rule |
|---|------|
| 1 | **Subscribe, don’t spawn** — turn on known packs first; free-form agents later |
| 2 | **Sections reusable** — packs are ordered lists of section handlers over shared truth |
| 3 | **Toggle per workspace subscription** — disabled = cron/n8n/MCP skip |
| 4 | **Suggest ≠ execute** — reports may recommend reorder/PO; never auto-approve, send Loft, or mark FOB |
| 5 | **Scope-gated** — `reports:*` and `automations:*` like other MCP/web scopes (key ∩ web user) |
| 6 | Demand MA is a **nightly snapshot section**, not recomputed on every chat |

### Model

```text
report_templates          platform seeds (+ later workspace custom)
  slug, title, default_sections[], default_schedule, audience_hint

report_subscriptions      per workspace
  template_id, enabled (toggle), schedule, timezone, channels[], audience, metadata

report_runs
  subscription_id, status, started_at, finished_at, payload_json, markdown_summary, error

report_section_handlers   code registry (not free SQL from users v1)
```

**UI:** one area (`/reports` or Settings → Agentic reports) — cards: toggle · schedule · last run · Run now · audience.

### Scopes (permission plane)

| Scope | Allows |
|-------|--------|
| `reports:read` | List packs + past runs |
| `reports:run` | Run now; receive digests for allowed packs |
| `reports:write` | Create/edit subscriptions, toggle on/off |
| `reports:admin` | Install templates, all audiences |
| `automations:webhook` | Outbound n8n/Zapier on `report.run.completed` |
| `automations:inbound` | Optional inbound hooks feeding sections |

Map into packages: viewer → read; member → read+run; ops_safe/admin → write; owner → admin + automations.

**MCP tools (later):** `reports_list`, `reports_get`, `reports_run` (scoped; only if subscription enabled).

**n8n:** schedule or webhook out; API key needs `reports:run` + `automations:webhook` as appropriate.

### Section library (examples)

| Section id | Used by |
|------------|---------|
| `sales.category_rollup` / `sales.top_movers` | Marketing |
| `inventory.ats_by_location` / `inventory.cover_days` | Warehouse / Finance |
| `ops.wave_baseline` / `ops.open_queues` | Warehouse / HQ |
| `demand.velocity_snapshot` | HQ / warehouse (MA 7/30/90 · EWMA) |
| `reorder.store_fill` / `reorder.supplier_buy` | HQ / buyer (path A vs B — never merged) |
| `supply.supplier_pipeline` | Buying (PO / FOB / ASN — track J) |
| `finance.stock_position` / `loyalty.rewards_liability` | Finance |
| `data_quality.gaps` | All |

### Seed packs (v1 subscriptions)

| Pack | Cadence | Audience | Core sections |
|------|---------|----------|---------------|
| **Marketing daily** | Daily | Marketer | category sales, top movers |
| **Marketing weekly** | Weekly | Marketer | category WoW, catalog health snapshot |
| **Warehouse weekly baseline** | Weekly | Warehouse / ops | Loft ATS, wave baseline, open requests, cover |
| **Warehouse daily ops** | Daily | Ops | exceptions, floor pending, inbound, ready-for-collect |
| **Finance stock & rewards** | Weekly | Finance | stock position, rewards liability (CRM if available) |
| **HQ demand daily** | Daily | HQ / buyer | velocity snapshot + store_fill + supplier_buy suggestions |

### Demand MA + path A/B (inside K, not a separate free agent)

| Path | When report suggests | Downstream |
|------|----------------------|------------|
| **A store_fill** | Store cover low **and** Loft has stock | Draft store request (MCP/UI) → HQ decide |
| **B supplier_buy** | Network cover low vs supplier lead time | Draft internal PO (editable) → affirm → **FOB PDF → in_transit** → ASN |

Moving average: recompute **nightly** (or post-sales batch) into snapshot; report sections **read** snapshot. Do not recompute on every MCP chat.

### Build slices

| Slice | Work | Status |
|-------|------|--------|
| **Rpt-0** | Scopes `reports:*` + `automations:webhook` in catalog + packages | **Done** (`scopes.ts`, mig **066** permission areas) |
| **Rpt-1** | Schema: templates, subscriptions, runs; UI list + **toggle** + last run | **Done** (`/reports`, APIs under `/api/reports/*`) |
| **Rpt-2** | Seed 3 packs (marketing weekly, warehouse baseline, finance stock) — stub sections OK | **Done** (platform seeds; Run now = stub sections) |
| **Rpt-3** | Cron runner + deliver in_app / Slack (Phase N) | **Next** |
| **Rpt-4** | MCP `reports_list` / `get` / `run` | Later |
| **Rpt-5** | n8n webhook out + `POST` run API | Later |
| **Rpt-6** | Real sections: velocity MA, store_fill vs supplier_buy, sales category, finance stubs | Later |

**Depends on:** Phase N bus (shipped) · velocity views (`v_demand_velocity` exists) · ATS / store ops (shipped).  
**Code:** `server/utils/reportRegistry.ts` · `app/pages/reports/index.vue` · `tests/report-registry-k.test.mjs`.

---

## Supplier order lifecycle (KR/HK) — planned

**Reality (ops):** KR/HK supplier orders are **not automatic**. We plan with a PO; lines stay **editable while draft** (including via MCP). Suppliers may confirm or change amounts via **email / email PDF / (future) API** — we **affirm** that when we know the channel. We do **not** yet have a single “supplier confirmation truth” for every vendor.  

**Hard gate for “in transit” / shipping reality:**  
> **Incoming amounts are committed and goods treated as in transit only when the FOB PDF is sent to us.** That is the signal to put the order **in transit** and drive **comms to Loft** (inbound ASN API we already built).

### Principles (lock these)

| # | Rule |
|---|------|
| 1 | MCP **creates** POs and keeps them **editable in draft** (`po_create_draft`, `po_update_draft`, `po_add_lines`, clone). |
| 2 | Draft (and pre-FOB) ≠ supplier order locked ≠ stock in transit. |
| 3 | **Supplier affirm** = we record/accept their confirmation (email / PDF / API) when we understand that vendor’s channel — channels may differ; truth model is still evolving. |
| 4 | **FOB PDF received** = commercial/shipping lock for “what’s coming” → status **in_transit** → create/update **inbound ASN** → notify Loft. |
| 5 | Loft path is **ASN / inbound API**, not “PO sent to Loft.” |
| 6 | Not invoices/AR — FOB/ack docs are **shipping/commercial confirmations**, not AP invoices. |

### Lifecycle (target)

```text
draft                    MCP/UI: create + edit freely (lines, qty, supplier notes)
  │                      po_create_draft · po_update_draft · po_add_lines · clone
  │                      stays editable until we leave draft intentionally
  ▼
(optional) internal submit / approve_intent
  │                      po_submit / po_decide — plan OK; still NOT in transit
  │                      lines may still be revised if we return to negotiating
  ▼
awaiting_supplier / negotiating
  │                      supplier may counter via email / PDF / API (format TBD per supplier)
  ▼
supplier_affirmed        we accept/tally their confirmation when we have it
  │                      (channel unknown for all vendors yet — flexible record)
  │                      still NOT automatically “in transit”
  ▼
fob_pdf_received         ★ FOB PDF arrived (email attachment or upload)
  │                      final shipping amounts for this shipment
  ▼
in_transit               ★ only now: treat as goods moving
  │                      create/confirm inbound ASN → Loft API (forwarder → warehouse)
  ▼
loft_receiving / closed  existing inbound receive / LISE confirm → LOFT-SG ATS
```

Store replenishment (Loft → store) remains a **later** Store Ops path.

### MCP must support (product intent)

| Capability | Today | Target |
|------------|--------|--------|
| Create PO | `po_create_draft` / `po_clone_as_draft` | Keep |
| Edit while draft | `po_update_draft`, `po_add_lines` | Keep strong; agent must prefer edit over re-create |
| Editable after minor supplier feedback | Manual / re-draft | Stay on draft or `negotiating` with MCP edit |
| Affirm supplier confirmation | — | Record affirm (source: email / pdf / api; amount; at) — **flexible**, vendors differ |
| Mark FOB PDF received | — | Event/status → enables **in_transit** |
| Put in transit + Loft | `inbound_create_draft` + UI send | Triggered by **FOB PDF**, not by draft create or internal approve |

### What exists today vs gap

| Step | Today | Gap |
|------|--------|-----|
| MCP create + edit draft PO | Yes (`po_*` draft tools) | Agent instructions: stay in draft; edit via MCP |
| Supplier confirm channels | Outside Fran | Pluggable affirm (email/PDF/API) — don’t hardcode one vendor truth |
| Affirm right amount | Manual | Lightweight affirm + optional variance vs PO lines |
| **FOB PDF → in transit** | Manual process | Status + doc link; **only then** set in_transit |
| Comms to Loft | Inbound ASN API + Store Ops | Wire “FOB received” → ASN draft/send path |
| Agent language | Partial | Never say in transit before FOB PDF |

### MCP vs human (policy)

| Step | MCP | Human / system |
|------|-----|----------------|
| Create + edit draft PO | **Yes** (primary for HQ + Claude) | UI optional |
| Internal plan approve | Optional if scoped | Optional |
| Affirm supplier email/PDF/API | Later tools; v1 may be UI “mark affirmed” | Flexible until channels known |
| Attach / log **FOB PDF** | Later upload or email ingest | **v1 human OK** |
| Set **in_transit** + Loft ASN | Prefer system rule after FOB | UI confirm send-to-Loft until automated |

### Agent / copy rules

- Draft PO is **editable**; prefer `po_update_draft` / `po_add_lines`, not a new PO for every tweak.
- Never: “order placed with supplier” or “in transit” from draft or internal approve alone.
- Supplier affirm = we acknowledged their number; **still not in transit**.
- **In transit only after FOB PDF** (explicit status or event).
- Then: inbound ASN / Loft — not classic multi-warehouse transfer object.

### Build slices (when scheduled)

| Slice | Work |
|-------|------|
| **J1** | Statuses + Help/agent copy: draft-editable; affirm ≠ FOB; in_transit only on FOB |
| **J2** | Keep/strengthen MCP draft edit UX (tools + instructions) |
| **J3** | Supplier affirm record (source type email\|pdf\|api, flexible payload; optional tally) |
| **J4** | FOB PDF event → `in_transit` + link/create inbound ASN → Loft |
| **J5** | Optional: email ingest / API webhook per supplier later (unknown truth sources for now) |

**Depends on:** inbound ASN path (shipped) · internal PO tools (shipped) · Loft Phase 0 IDs for reliable send.

---

### Phase S — login MFA via Google Workspace (planned ops; not in-app TOTP)

**Decision:** Fran staff log in with **Google SSO only**. **Login 2FA lives on Google Workspace**, not a second TOTP product inside SKUMS. App-level MFA would duplicate the IdP and create dual recovery burden.

| Control | Where | Role |
|---------|--------|------|
| **2FA / 2-step verification** | **Google Workspace** (admin-enforced) | Proves the human at login |
| **Who may use this workspace** | SKUMS membership + roles/scopes | Authorization after SSO |
| **Machine keys / MCP / POS** | SKUMS API keys + packages | Separate from human login MFA |
| **POS tablet PIN** | fran-pos local | Not Workspace MFA; store floor only |

#### Workspace policy (ops checklist)

- [ ] All SKUMS users are Workspace (or allowed) Google accounts — no staff password-only local accounts
- [ ] Enforce MFA for the domain **or** a group that includes everyone with SKUMS access
- [ ] Prefer stronger second factor for **owner** (and ideally **admin**) accounts
- [ ] Block legacy less-secure sign-in paths; SSO is the only staff path into SKUMS
- [ ] Document break-glass: Workspace admin recovery if an owner loses their second factor

#### Who must have Workspace MFA

| Who | Login MFA |
|-----|-----------|
| **Owner** | Required (Workspace) |
| **Admin** | Required (Workspace) |
| **Inventory manager / member / viewer** | Required for any account that can reach SKUMS (simplest: whole domain/group) |
| **POS PIN roles** | Out of scope for Workspace MFA |
| **MCP / Claude** | No TOTP in the agent; bound key power still ≤ web user |

#### What SKUMS still owns (not login 2FA)

- Roles, scopes, appoint admin, key bind/revoke
- Optional **later step-up** on dangerous web actions only: credentials, appoint admin, mint/revoke elevated MCP keys — via Google re-auth or short re-login, **not** a second authenticator app product in v1
- Audit of privileged actions; API key lifecycle remains the high-risk surface to harden in-app

#### Explicit non-goals (v1)

- Supabase/in-app TOTP for every SKUMS login
- MFA inside Claude/MCP tools
- Treating POS PIN as HQ 2FA

**Depends on:** Google Workspace admin access (ops) · owner/admin appoint model (done).

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
npm run db:migrate:status    # 066 applied (use --only N if 015 checksum blocks full run)
# https://fran-skums.vercel.app
# Settings → Claude MCP key (mcp:ops_safe, bound to you) → capabilities
# /reports — toggle packs; Run now (stub sections until Rpt-6)
node --test tests/effective-scopes-a2.test.mjs tests/api-key-lifecycle-a24.test.mjs tests/tool-scopes-capabilities.test.mjs tests/mcp-backlog-8.test.mjs tests/report-registry-k.test.mjs tests/m1-m3-packs.test.mjs
```

### Ops / env leftovers

- [x] Migrations **058–063** on shared project (063 A2 keys)
- [x] Migration **064** notification bus on shared project
- [x] Migration **065** inventory_manager schema on shared project
- [x] Migration **066** report registry on shared project
- [ ] Confirm prod deploy green after each push
- [ ] Confirm prod DB has **063–066** if not same project as local migrate
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

- M0–M6 · Help · R1 remote MCP · Loft P–F · MCP composites **#1–8** · **A2.1–A2.4** · permission-gated cloud approve · Phase N N1–N4 · Claude connector tools live · **M1–M3** · inv manager **065** · **K Rpt-0–2** (mig **066**)  
- Detail in git history / `TODO-LOFT.md` / commit summaries  

### Phase N — stakeholder notifications

| Step | Status |
|------|--------|
| **N0** Principles (lifecycle, deep link, idempotent, no MCP draft email) | Locked |
| **N1** Schema: `notification_policies`, `notification_deliveries`, `workspace_notification_settings` | **Done** (mig **064**) |
| **N2** Events: `store_ops.request.submitted/decided`, `store_ops.exception.opened/verified` (+ PO stubs) | **Done** |
| **N3** Delivery: in_app + Slack; email skipped until provider | **Done** (in_app/Slack) |
| **N4** Store Ops Inbox tab + deep links | **Done** |
| **N5** Digests / mute / invoice events | Later |
| **N6** Email provider (Resend/SES) + templates polish | Later |

Wire: `server/utils/notifications.ts` · hooks in `storeReplenishment` / `storeReceive`.

### Phase P — remaining

- [x] Scope catalog + Loft packages + store-ops requireScope surfaces  
- [x] MCP effective scopes = web ∩ key  
- [x] Empty API keys ≠ full (`hasScope` / `apiAuth` default deny empty scopes)  
- [x] Inventory Manager schema alias (065)  
- [ ] App install grants UI polish  
- [ ] R2 OAuth after packages solid  

### Phase R

- [x] R1 remote MCP + URL key + permission-based tools  
- [x] R1 human pilot (Claude connector) — tools list working 2026-07-16  
- [x] Connector fixes: Streamable HTTP GET/SSE, `?api=` alias, package-scope expand for tools/list  
- [ ] R2 OAuth held  

---

## Definition of done (smoke)

| Check | Pass |
|-------|------|
| Floor apply | Pending → apply (UI or MCP `floor_adjustment_apply` if scoped) |
| Store approve | Owner/admin MCP: `store_ops_decide`; member cannot |
| Help AI | resolve_help for store ops how-to |
| Keys | Owner/admin revoke; remove member revokes bound keys |
| Deploy | Vercel green; mig **064** on prod DB |
| Claude MCP | Connector URL `/mcp/c/sk_live_…` shows tools (`capabilities`, etc.) |

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
  N   notifications N1–N4 ✅ · N5 digests / N6 email provider later
  R1  Claude connector ✅ tools live (URL /mcp/c/… + package expand)
  M1–M3 + inv manager + empty-key ≠ full ✅ (mig 065)
  K   Rpt-0–2 ✅ · next Rpt-3 cron / Slack deliver
  0.x Loft email / dictionary IDs → M4 send_to_loft
  J   supplier KR/HK (draft PO → affirm → FOB PDF → in_transit → ASN)
  P   install UI
  S   Workspace MFA policy (ops)
  F   audit explorer filters
```

**Recommended next:** **K Rpt-3** (cron + Phase N delivery) · Loft Phase 0 → **M4** · **J supplier** when KR/HK buying · Phase S Workspace MFA (ops).  
**Owner model:** one owner appoints admins; many admins for ops/keys; login MFA = Google Workspace.  
**Supplier rule:** MCP creates/edits **draft** POs; supplier affirm when known; **in transit only on FOB PDF** → ASN → Loft.  
**Reports rule:** sectionized packs with **toggle**; `reports:*` / `automations:*` scopes; suggest ≠ execute.

---

## Road ahead (snapshot)

### Done (do not re-open without cause)

| Area | State |
|------|--------|
| Catalog / identity / Help / M0–M6 | Shipped |
| Remote MCP + Claude pilot | Working (`/mcp/c/sk_live_…`, tools non-empty) |
| A2 permissions (web ∩ key, bind, revoke) | Core shipped |
| Loft store-ops P–F (request → decide → receive → floor → waves) | Shipped |
| MCP composites #1–8 | Shipped |
| Phase N N1–N4 (inbox + bus + request/exception hooks) | Shipped |

### Near-term eng (code)

1. ~~**M1–M3**~~ · ~~**Inventory-manager**~~ · ~~**empty-key ≠ full**~~ · ~~**K Rpt-0–2**~~  
2. **K Rpt-3** — cron runner + in_app / Slack via Phase N  
3. **M4** after Loft Phase 0 dictionary IDs — send-to-Loft tool  
4. **K Rpt-4–6** — MCP tools, n8n, real section handlers  

### Product platforms (larger)

| Track | Outcome |
|-------|---------|
| **K Agentic reports** | Rpt-0–2 shipped (`/reports`); next cron + real sections |
| **J Supplier KR/HK** | Draft PO editable; affirm; **FOB PDF → in transit → Loft ASN** |
| Demand MA | Nightly velocity snapshot feeding K sections + reorder A/B |

### Ops (non-code or light)

| Item | Owner |
|------|--------|
| Loft Phase 0 email / `delivery_method_id`s | Ops |
| Google Workspace MFA for all SKUMS users | Workspace admin (Phase S) |
| Claude keys: `mcp:ops_safe` for HQ only; staff get weaker packages | Owner |

### Held / later

R2 OAuth · N6 email provider · A2.5 bind-other-user UI · audit explorer · live scrape / brand radar · Phase H ecommerce · full supplier email ingest (J5)

### Suggested sequence (next eng slices)

```text
M1–M3 + Inventory Manager + empty-key ≠ full   ✅
Rpt-0 scopes → Rpt-1 toggle UI → Rpt-2 seed packs   ✅ (mig 066)
  →  Rpt-3 cron + Phase N deliver
  →  Loft Phase 0 ops · M4 send-to-loft
  →  J1–J4 supplier FOB lifecycle when buying focus
  →  Rpt-4 MCP tools · Rpt-6 velocity + store_fill/supplier_buy
```

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
