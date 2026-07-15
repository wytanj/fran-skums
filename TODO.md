# Fran SKUMS — TODO (implementation queue)

**Date:** 2026-07-16  
**Production:** https://fran-skums.vercel.app  
**DB:** migrations **001–064** (064 = Phase N notification bus).  
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

**Shipped:** Loft P–F · remote MCP · composites **#1–8** · **A2.1–A2.4** · permission-gated cloud approve · **Phase N N1–N4** · Claude connector reliability fixes.  
**Claude pilot:** **Working** (2026-07-16) — tools list non-empty; use URL  
`https://fran-skums.vercel.app/mcp/c/sk_live_…` (OAuth blank; Settings → Create Claude / MCP key).  
**POS:** structure handoff `fran-pos/docs/SKUMS_INVENTORY_STRUCTURE_HANDOFF.md` — roles/MCP next section below.

| Priority | Track | Status / next |
|----------|--------|----------------|
| **A** | MCP composites #1–8 | **Done** |
| **A2** | Web ↔ MCP permissions | **Core done** — optional A2.5 bind-other UI |
| **B** | Loft Phase 0 close-out | **Ops:** Loft email / dictionary IDs |
| **C** | Phase N | **N1–N4 done** — N6 email later |
| **D** | Phase P remaining | Empty non-MCP keys ≠ full; legacy gates |
| **E** | Phase R / Claude pilot | **Done (tools live)** · R2 OAuth held |
| **H** | HQ schemas from POS reality | Inventory-manager schema + MCP packs (below) |
| **I** | MCP actions next (POS-driven) | **Next eng:** M1–M3 packs (below) |
| **J** | **Supplier order lifecycle (KR/HK)** | **Planned** — intent ≠ supplier ack ≠ Loft ASN (below) |
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
| **M1** | `store_request_status` / request pack (lines + recommend + wave) | Manager requested stock; HQ needs one-shot context | `store_ops:read` | **High** |
| **M2** | `floor_adjustment_queue` digest (pending damage/found/count) | Cashier floor reports pile up | `store_ops:read` / `inventory:read` | **High** |
| **M3** | `exception_verify` MCP tool (confirm/reject/escalate) | Receive reported short/damage | `store_ops:verify` | **High** |
| **M4** | `store_ops_send_to_loft` (shipping payload + connection) | After approve_now, humans still UI-only | `store_ops:execute_3pl` | Medium (after Loft Phase 0 IDs) |
| **M5** | `pos_sync_health` (sale outbox lag / failed inventory-events if SKUMS sees them) | Phase2 POS manager surface | `pos:read` / intel | Medium |
| **M6** | Forecast / low-stock → draft request pack polish | Complements POS request | already partial | Low |
| **M7** | Import job status | Catalog ops, not POS | intel | Low |

**Already good for POS loop (keep using):**  
`ops_snapshot` · `store_ops_list_requests` · `store_ops_recommend` · `store_ops_decide` · `exceptions_snapshot` · `floor_adjustment_apply` · `inventory_ats` · `product_inventory_status` · Phase N inbox.

**Never on POS key or cashier MCP:** approve · verify · execute_3pl · credentials · appoint admin · key revoke.

### Recommended build order (post-pilot)

```text
1. Inventory-manager permission schema seed (if missing) + doc who gets it
2. MCP M1 request status pack + M2 floor queue digest   ← close POS→HQ loop in Claude
3. MCP M3 exception_verify (scoped store_ops:verify)
4. P remaining: empty non-MCP keys ≠ full
5. Loft Phase 0 ops IDs → then M4 send_to_loft tool
6. Supplier order lifecycle (J) — statuses + supplier ack tally + gate ASN on ack
7. Phase S — Workspace MFA policy + optional SKUMS step-up for dangerous actions
8. Optional: A2.5 bind key to other user; audit explorer; N6 email
```

---

## Supplier order lifecycle (KR/HK) — planned

**Reality (ops):** Orders to KR/HK suppliers are **not automatic**. Supplier may change qty/price/lines. After we confirm on our side, they usually send a **PDF or email** with the final amount — we **tally** that. Only when goods go out to the **forwarder** do we create **comms to Loft** via the inbound ASN API already built.

### Principle (lock this)

> **Loft is only notified after supplier reality is tallied (or an explicit “ship on our numbers” override) — not when an internal PO is drafted or even internally approved.**

| Phrase | Meaning |
|--------|---------|
| Internal PO / buying plan | Decision-layer intent in Fran (`po_*`) |
| Internal approve | We accept the *plan* (`po_decide`) — **not** a supplier order lock |
| Supplier ack | PDF/email final amount + lines; **tally** vs our PO |
| ASN → Loft | Forwarder→warehouse handoff (`inbound_*` / Store Ops) |

**Not invoices/AR.** Supplier confirmation is an **ack / commercial confirmation**, not an AP invoice product.

### Lifecycle (target statuses)

```text
draft                          MCP/UI: po_create_draft / clone
  → pending_internal_approval  po_submit
  → approved_intent            po_decide (owner key may do this in MCP)
  → negotiating                (optional) supplier proposed changes; revise lines
  → confirmed_internally       we lock what *we* think we ordered
  → supplier_ack_received      PDF/email logged; amount + lines tallied
       ↘ variance_flagged      ack ≠ our lines/amount → human resolve
  → asn_created / loft_notified   inbound ASN API (goods → forwarder → Loft)
  → loft_receiving / closed
```

Physical stock only becomes Loft ATS after Loft receive / LISE confirm (existing inbound path). Store replenishment remains a **later** Store Ops path (request → decide → execute_3pl).

### What exists today vs gap

| Step | Today | Gap |
|------|--------|-----|
| Draft / revise plan | `po_*` draft tools + Actions UI | — |
| Internal submit / approve | MCP if `po:submit` / `po:decide` (owner ops key); else Actions UI | Copy: never say “ordered from supplier” |
| Supplier may adjust | Manual edits on draft/pending | Explicit `negotiating` / revision history |
| Fran confirms our side | Approximated by approve | `confirmed_internally` status |
| Supplier PDF/email + tally | Manual / outside system | Ack attachment or note + **tally** (amount + line compare) |
| Goods → forwarder → Loft | `inbound_create_draft` + Store Ops send/confirm | Gate: prefer **supplier_ack_received** (or override) before send-to-Loft |
| Agent language | Partial in instructions | Encode full lifecycle in agent + Help |

### MCP vs human (policy)

| Step | MCP (owner `mcp:ops_safe`) | Human / UI v1 |
|------|----------------------------|---------------|
| Draft / revise plan | Yes | Optional |
| Internal approve intent | Yes if scoped | Optional |
| Log supplier PDF/email + tally | Later (upload / note tool) | **Required v1** |
| Create ASN + notify Loft | Draft yes; full send mainly UI | **Required v1** until send tool solid |
| Override “ship without ack” | No auto | Owner/admin explicit only |

### Agent / copy rules (add when building)

- Draft or approved internal PO ≠ “supplier order placed” ≠ “stock in transit.”
- After internal approve: “Awaiting supplier confirmation (PDF/email); then tally; then ASN to Loft.”
- After supplier ack tallied: OK to create inbound ASN / notify Loft.
- Approve store request still ≠ send to Loft (`execute_3pl` separate).

### Build slices (when scheduled)

| Slice | Work |
|-------|------|
| **J1** | Status model + Help/agent copy (no new MCP if statuses only) |
| **J2** | Supplier ack record (file URL / note, final amount, tallied_at, variance) |
| **J3** | Gate inbound send-to-Loft on ack (or override flag + audit) |
| **J4** | Optional MCP: log ack summary, variance digest, link PO ↔ ASN |

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
npm run db:migrate:status    # 063 applied
# https://fran-skums.vercel.app
# Settings → Claude MCP key (mcp:ops_safe, bound to you) → capabilities
# Owner: store_ops_decide in permitted tools; viewer key: not present
node --test tests/effective-scopes-a2.test.mjs tests/api-key-lifecycle-a24.test.mjs tests/tool-scopes-capabilities.test.mjs tests/mcp-backlog-8.test.mjs
```

### Ops / env leftovers

- [x] Migrations **058–063** on shared project (063 A2 keys)
- [x] Migration **064** notification bus on shared project
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

- M0–M6 · Help · R1 remote MCP · Loft P–F · MCP composites **#1–8** · **A2.1–A2.4** · permission-gated cloud approve · Phase N N1–N4 · Claude connector tools live  
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
- [ ] Empty non-MCP keys ≠ full (legacy)  
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
  0.x Loft email / dictionary IDs
  M1–M3 POS→HQ MCP packs (request status, floor queue, exception verify)
  J   supplier KR/HK lifecycle (intent → supplier ack tally → ASN → Loft)
  P   empty-key legacy, install UI
  S   Workspace MFA policy (ops)
  F   audit explorer filters
```

**Recommended next:** MCP **M1–M3** (POS→HQ) · inventory-manager schema · Loft Phase 0 · **J supplier lifecycle** when buying from KR/HK · Phase S Workspace MFA (ops).  
**Owner model:** one owner appoints admins; many admins for ops/keys; login MFA = Google Workspace.  
**Supplier rule:** internal PO approve ≠ supplier order ≠ Loft notify; Loft only after tallied supplier ack (or explicit override).

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
