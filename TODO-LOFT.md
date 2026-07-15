# TODO — Loft Logistics / WorldSyntech OFS (phased PR plan)

**Status:** Phases **P–E** + operator docs + assistant Help shipped (2026-07-15); **Phase F in progress**; Phase 0 live OFS IDs still pending Loft  
**Date:** 2026-07-15  
**Assumption:** Loft is the production 3PL.  
**Permission foundation:** `docs/ORG_PERMISSION_SCOPES.md` (2026-07-13 design — Phase P catalog freeze).  
**Summary:** `docs/Commit Summary 15072026.md` · Operator: `docs/SKUMS_OPERATOR_RUNBOOK.md`  
**Commits (skums):** `38d4383` P/A/B/C · `a861eec` C.4 · `17d8665` D · (15072026 E + docs + Help AI)  
**Commits (pos):** `4148095` bind + request/receive · `e7d811f` fran receive · (15072026 cycle count + free-form receive gate)  
**Boundary (locked):**

```text
POS  →  store facts + receipt exceptions + replenishment REQUESTS only (no Loft credentials)
SKUMS →  notification inbox, HQ decision, ledger, orchestrate, verify exceptions
MCP  →  HQ decision support (baseline + lift); never auto-send to Loft without human approve scope
Loft/OFS →  warehouse execution (ASN, stock, pick/pack, dispatch/ready)
```

**Replenishment decision model (locked):**

```text
Store manager / permissioned POS staff
  → submits store_replenishment_request (urgent or ad-hoc need)
  → does NOT auto-approve, does NOT call Loft
  → lands in HQ notification / Actions-style inbox for staff with store_ops:approve

HQ inventory ops (human)
  → sees request in notification center
  → uses MCP (baseline demand + lift / forecast signals) to judge:
        A) approve ad-hoc / lift order now  → convert → (later) send to Loft
        B) defer: regular weekly wave is enough  → reject or schedule into Mon/Thu cycle
  → only store_ops:approve may decide; only store_ops:execute_3pl may send to Loft

Default cadence (LISE retail)
  → weekly replenishment waves: Monday + Thursday
  → store requests are exceptions / signals on top of that rhythm, not the default pipe
```

**Repos:**

| Repo | Path |
|------|------|
| SKUMS | `C:\Users\Jeremy Tan\CodeProjects\fran-skums` |
| POS | `C:\Users\Jeremy Tan\CodeProjects\fran-pos` |
| Loft API | WorldSyntech OFS (external) — no code repo |

**Related docs:**

- `docs/ORG_PERMISSION_SCOPES.md` — canonical scopes, role packages, apps-as-installs
- `docs/WORLDSYNTECH_3PL_INTEGRATION_PLAN.md`
- `docs/LOFT_SOW_KIV.md`
- `docs/POS_SKUMS_3PL_STORE_OPS_HANDOFF.md`
- `fulfillment/worldsyntech-ofs/README.md`
- `docs/Commit Summary 13072026.md` — M0–M4 MCP/roles groundwork

**Physical flow this plan serves:**

```text
KR/HK suppliers → offshore forwarder → M&P (local) → Loft
  → self-collect OR Loft delivery to store
  → bulk broken or full/partial pallet
  → multi-store retail chain (FEFO at Loft; policy gates in SKUMS)
  → [later] ecommerce (Shopee + custom frontend)
```

---

## How to read this plan

- Each **PR** is intended to be mergeable on its own (or as a small Graphite/stack slice).
- **`[skums]`** / **`[pos]`** / **`[ops]`** mark ownership.
- **`Scopes:`** on a PR lists required catalog scopes (from Phase P) for that surface.
- POS may **report** bad receipt, missing, damage, wrong SKU, overage, and **request** stock.  
  POS must **not** approve final stock, close Loft variance, decide Mon/Thu vs lift, or call OFS.
- A store replenishment **request is a signal**, not a warehouse order. It only notifies HQ staff with `store_ops:approve`.
- HQ uses **MCP for baseline + lift** to choose approve-now vs defer-to-weekly; MCP proposes / informs — it does **not** replace `store_ops:approve` or auto-execute Loft.
- SKUMS staff **verify** POS-reported receipt exceptions (see ledger policy under Phase C).
- Check boxes are implementation status; leave unchecked until done.
- **Phase P (permissions) starts early** and is enforced on every new Loft/store-ops route — do not ship Phase B/C APIs without scope gates.

---

## Inventory status ownership (reminder)

| Fact | Owner |
|------|--------|
| Product / barcode / SKU master | SKUMS |
| Sellable ATS per store | SKUMS `inventory_levels` + ledger |
| Loft warehouse physical stock | Loft (mirrored as OFS snapshot until confirmed) |
| Store receive claim (good / short / damaged / wrong) | **POS reports** |
| Exception verification & disposition | **SKUMS staff** |
| Store replenishment **request** | POS manager+ (signal only) |
| Approve request / defer to Mon–Thu wave | **HQ** `store_ops:approve` (MCP-assisted) |
| Weekly baseline wave (Mon + Thu) | **HQ** planned replenishment, not store-driven |
| Baseline / lift analysis | **MCP + intel/forecast tools** → human decision |
| FEFO pick selection | Loft WMS |
| Near-expiry outbound policy | SKUMS |
| Scope grants / who may act | SKUMS permission catalog + POS local roles |
| Ecommerce fulfillment | Deferred (Phase H) |

---

## Phase P — Permission & role scoping (do first / in parallel)

**Goal:** one scope vocabulary for humans, POS machine keys, and the WorldSyntech app so Loft work does not invent a second ACL.

**Groundwork already done (yesterday / prior):**

| Item | Where |
|------|--------|
| Canonical scope catalog design | `docs/ORG_PERMISSION_SCOPES.md` |
| Resource+verb format (`inventory:read`, `store_ops:write`, …) | same |
| Role packages (ws_owner, ws_admin, ws_member, ws_viewer, **store associate**, finance, buyer) | same |
| Apps declare `required_scopes` (incl. `worldsyntech-ofs`, `pos-connector`) | same |
| MCP safe scopes / empty ≠ god mode | M0 (`docs/Commit Summary 13072026.md`) |
| Actions approve as privileged pattern | M4 |
| POS local roles | fran-pos `owner` \| `admin` \| `manager` \| `cashier` |

**Enforcement roadmap (from org scopes doc — execute under this phase):**

| Step | Work |
|------|------|
| **P0** | Freeze catalog + seed `permission_schemas` for missing areas |
| **P1** | `resolveScopes({ userId, workspaceId })` + API-key resolver |
| **P2** | Gate UI (`can` via scopes) |
| **P3** | Gate API routes (`requireScope`) |
| **P4** | Apps install grant (`worldsyntech-ofs`, `pos-connector`) |
| **P5** | Org ↔ workspace matrix (later; not blocking Loft MVP) |

---

### P.0 — Loft-relevant scope freeze `[skums-docs]` + seed `[skums]`

Extend / freeze the catalog used by all later PRs. Prefer names already in `ORG_PERMISSION_SCOPES.md`; add only what is missing for exception verify / inbound / 3pl execute.

#### Core scopes (already proposed — **must seed + enforce**)

| Scope | Meaning for Loft track |
|-------|-------------------------|
| `inventory:read` | Levels, ATS, Loft snapshot views |
| `inventory:write` | Ledger apply, adjustments, receive apply |
| `inventory:po` | Warehouse supplier POs (not store replenish) |
| `locations:read` / `locations:write` | Store / Loft / in_transit topology |
| `expiry:read` / `expiry:write` | Batches, short-date data |
| `store_ops:read` | Requests, orders, expected deliveries, exceptions (view) |
| `store_ops:write` | Create/edit requests & orders, submit receive, open exceptions |
| `pos:read` / `pos:write` | Catalog, scan, sales, inventory events, receive submit |
| `pos:config` | Registers / POS location binding |
| `integrations:read` / `integrations:write` | Connection rows |
| `integrations:execute` | Pull inventory, poll orders, send to Loft, create ASN |
| `credentials:read` / `credentials:write` | OFS secrets (**admin install only**) |
| `apps:read` / `apps:write` / `apps:install` | Enable WorldSyntech / POS connector apps |
| `activity:read` / `audit:read` | Who verified exceptions |

#### Fine-grained scopes to **add** for Loft (catalog amendment)

Keep the base set small; these avoid giving every `store_ops:write` user Loft send + exception close:

| Scope | Meaning |
|-------|---------|
| `store_ops:approve` | Approve / reject / **defer-to-wave** replenishment requests; convert to order; run weekly wave planning |
| `store_ops:execute_3pl` | Send/cancel order to Loft; create ASN; poll jobs that mutate remote |
| `store_ops:verify` | Confirm / adjust / reject receipt & inventory exceptions (HQ) |
| `store_ops:inbound` | KR/HK ASN lifecycle + LISE confirm promote to Loft stock |
| `inventory:override_expiry` | Override near-expiry gate when sending to store |
| `intel:read` / forecasting read | MCP + HQ UI: baseline demand, lift, sell-through inputs for approve vs defer |
| `actions:read` | Notification / Actions inbox for pending store requests (if routed through Actions) |
| `mcp:safe` (or tools under it) | HQ may query baseline/lift via MCP; **must not** include execute_3pl / approve without human scope |

**Package aliases (optional):**

| Package | Expands to (summary) |
|---------|----------------------|
| `pkg:store` | `pos:*`, `inventory:read`, `store_ops:read`, `store_ops:write` (request + receive report only), `products:read` — **no** approve/verify/execute_3pl/credentials |
| `pkg:inventory_ops` | inventory + store_ops read/write/approve/verify + expiry read/write + locations read — **no** credentials; execute_3pl optional by org |
| `pkg:3pl_admin` | `integrations:*`, `credentials:write`, `store_ops:execute_3pl`, `store_ops:inbound`, apps install |

**Checklist:**

- [ ] Amend `docs/ORG_PERMISSION_SCOPES.md` §4.4 with fine-grained `store_ops:*` above (or land solely here and link)
- [ ] Seed `permission_schemas` JSON: inventory, expiry, store_ops, pos, integrations, locations
- [ ] Align TypeScript `PermissionArea` / scope types
- [ ] Document: empty API key scopes → **deny** or viewer package (not full) — same as org scopes decision checklist
- [ ] Unit tests: package expansion for `pkg:store`, `pkg:ws_admin`, `pkg:3pl_admin`

**Depends on:** nothing  
**Unblocks:** all gated routes in B–E

---

### P.1 — Resolve + requireScope helpers `[skums]`

**Touches:** `server/utils/` (new or extend team/api-key helpers), API key scope validation, optional MCP alias map.

**Work:**

- [ ] `resolveScopes({ userId, workspaceId })` → `Set<string>` from org role × workspace role × permission schema
- [ ] `resolveScopesForApiKey(key)` → key scopes only (**never** org-admin passthrough)
- [ ] `requireScope(event, scope | scope[])` for Nitro handlers (user session **or** API key)
- [ ] POS connector keys: default grant `pos:read`, `pos:write` only (optionally `store_ops:read` if receive list needs it — prefer including `store_ops:read` + `store_ops:write` for request/receive **without** approve/verify/execute)
- [ ] Integration worker / WorldSyntech app: `granted_scopes` from `workspace_apps` only

**Scopes used by helper itself:** n/a  

**Depends on:** P.0

---

### P.2 — Role → capability matrix (human) `[skums]` + `[pos]`

Canonical matrix for Loft track. SKUMS workspace roles use packages; POS uses local PIN roles.

#### SKUMS workspace (UI humans)

| Capability | Viewer | Member / Store schema | Inventory ops | Admin / 3pl admin | Owner |
|------------|--------|------------------------|---------------|-------------------|-------|
| View Loft inventory snapshot | ✓ read | ✓ | ✓ | ✓ | ✓ |
| View store-ops requests/orders | ✓ | ✓ | ✓ | ✓ | ✓ |
| Submit replenishment request (signal → HQ inbox) | — | ✓ `store_ops:write` | ✓ | ✓ | ✓ |
| Receive request notification | — | — | ✓ `store_ops:approve` (+ notif policy) | ✓ | ✓ |
| MCP baseline/lift for a request or wave | — | — | ✓ `intel:read` + `mcp:safe` | ✓ | ✓ |
| Approve / reject / defer-to-Mon–Thu wave | — | — | ✓ `store_ops:approve` | ✓ | ✓ |
| Convert approved → order / build weekly wave | — | — | ✓ `store_ops:approve` | ✓ | ✓ |
| Send / cancel Loft order, ASN, poll | — | — | optional | ✓ `store_ops:execute_3pl` + `integrations:execute` | ✓ |
| Install WorldSyntech app / credentials | — | — | — | ✓ `apps:install` + `credentials:write` | ✓ |
| Receive exception **verify** | — | — | ✓ `store_ops:verify` | ✓ | ✓ |
| Apply ledger adjustments | — | limited | ✓ `inventory:write` | ✓ | ✓ |
| Override short-date gate | — | — | optional | ✓ `inventory:override_expiry` | ✓ |
| Inbound ASN + LISE confirm promote | — | — | optional | ✓ `store_ops:inbound` | ✓ |
| Map OFS products | — | — | ✓ | ✓ | ✓ |

Default mapping to packages:

| SKUMS package / role | Loft-relevant scopes |
|----------------------|----------------------|
| `pkg:ws_viewer` | `*:read` only |
| `pkg:store` / store associate schema | `pos:*`, `inventory:read`, `store_ops:read`, `store_ops:write`, `products:read` |
| `pkg:ws_member` | products/inventory write, `store_ops:read/write`, **no** approve/verify/execute_3pl/credentials |
| Inventory manager schema | + `store_ops:approve`, `store_ops:verify`, `inventory:write`, `expiry:*` |
| `pkg:ws_admin` | most write + team + apps; + execute_3pl; credentials if policy allows |
| `pkg:ws_owner` / `pkg:3pl_admin` | full including credentials + inbound |

#### POS terminal (local roles — fran-pos)

Map handoff “part-time / full-time / manager” → existing POS roles:

| POS role | Level | Sale | Damage/found report | Receive + bad receipt report | Request replenishment (signal) | Approve / MCP / wave | Verify exception (HQ) | Send to Loft |
|----------|-------|------|---------------------|------------------------------|--------------------------------|----------------------|----------------------|--------------|
| `cashier` | 1 | ✓ | ✓ | ✓ | — | — | — | — |
| `manager` | 2 | ✓ | ✓ | ✓ | ✓ → HQ inbox only | — | — | — |
| `admin` | 3 | ✓ | ✓ | ✓ | ✓ → HQ inbox only | — | — | — |
| `owner` | 4 | ✓ | ✓ | ✓ | ✓ → HQ inbox only | — | — | — |

- POS **never** gets approve / MCP / verify / send-to-Loft (no those scopes on the POS key).
- Request UX copy: **“Sent to HQ for review”** — not “order placed” or “Loft notified”.
- HQ verification of receipts is **only** in SKUMS UI with `store_ops:verify`.
- HQ replenishment decisions are **only** with `store_ops:approve`, informed by MCP.

**Checklist:**

- [ ] Document matrix in this file (done) + short copy in handoff doc
- [ ] `[pos]` gate UI by `ROLES` / `MANAGEMENT_ROLES` for request vs receive
- [ ] `[skums]` gate store-ops UI actions by resolved scopes (P.2 after P.1)

**Depends on:** P.0; POS gates can ship UI-only before P.1

---

### P.3 — Gate existing + new Loft routes `[skums]`

Apply `requireScope` as routes appear. Minimum for MVP:

| Route / action family | Min scopes |
|-----------------------|------------|
| `GET` POS catalog / scan | `pos:read` |
| `POST` POS sales | `pos:write` |
| `POST` POS inventory-events | `pos:write` |
| `POST` store-ops requests | `store_ops:write` (+ `pos:write` if via POS key); **side effect:** notify `store_ops:approve` holders only |
| `GET` expected-deliveries | `store_ops:read` or `pos:read` |
| `POST` receive | `store_ops:write` or `pos:write` |
| Approve / reject / defer-to-wave / convert | `store_ops:approve` |
| MCP tools: baseline, lift, request context | `intel:read` / forecast scopes under `mcp:safe` — **no** silent approve |
| Send to Loft / create ASN / poll mutating jobs | `store_ops:execute_3pl` + `integrations:execute` |
| Exception verify / adjust / reject | `store_ops:verify` (+ `inventory:write` if ledger adjust) |
| Pull inventory (read remote) | `integrations:execute` + `inventory:read` |
| Credentials / connection setup | `credentials:write` + `integrations:write` |
| Inbound confirm promote | `store_ops:inbound` + `inventory:write` |
| Near-expiry override on send | `inventory:override_expiry` |

**Work:**

- [ ] Audit current `server/api/integrations/worldsyntech-ofs/*` and Fran store-ops routes; add gates
- [ ] Reject empty API key scope = full access on new keys; migrate old keys deliberately
- [ ] Tests: cashier-equivalent key cannot call verify or execute_3pl
- [ ] Tests: POS key can receive + report exception; cannot approve request

**Depends on:** P.1  
**Ship rule:** any new PR in Phases B–E that adds a route **must** list `Scopes:` and call `requireScope`

---

### P.4 — Apps install: worldsyntech-ofs + pos-connector `[skums]`

Align with org scopes §6.

| App key | required_scopes (final proposal) |
|---------|----------------------------------|
| `worldsyntech-ofs` | `inventory:read`, `inventory:write`, `store_ops:read`, `store_ops:write`, `store_ops:execute_3pl`, `store_ops:inbound`, `integrations:execute`, `locations:read` — install also needs `credentials:write` + `apps:install` on the **installer** |
| `pos-connector` | `pos:read`, `pos:write`, `store_ops:read`, `store_ops:write` (request + receive only) |

**Work:**

- [ ] Seed/update `app_definitions` for both apps
- [ ] On enable: store `granted_scopes` on `workspace_apps`
- [ ] Connection credentials separate under `credentials:*`
- [ ] UI: cannot “test OFS” without app enabled + execute scopes

**Depends on:** P.0–P.1

---

### P.5 — POS key + staff enforcement checklist `[pos]` + `[skums]`

- [ ] Company SKUMS connector uses least-privilege key (`pos-connector` package)
- [ ] POS never embeds OFS credentials
- [ ] Staff role checks client-side **and** SKUMS rejects over-scoped actions server-side
- [ ] Optional later: map POS staff → SKUMS actor for audit (`received_by_ref` already)

---

## Phase 0 — Loft dictionary & environments

**Goal:** stop guessing OFS enums before coding orchestration.  
**Code:** none required (docs only).  
**Scopes:** n/a  
**Note:** P–D code already shipped against **provisional** status heuristics. Phase 0 remains the gate for **live Loft pilot** (real URLs + delivery_method_ids + official enums).

### PR-0.1 — Loft ops dictionary `[ops]` `[skums-docs]`

- [x] Create `docs/LOFT_OPS_DICTIONARY.md` with:
  - [ ] Production + sandbox base URLs _(structure + demo URL; LISE sandbox/prod **TBD Loft**)_
  - [x] Auth model (Basic token ownership, user/password rotation)
  - [x] Rate limits / concurrency guidance (or “unknown — use conservative poll”)
  - [ ] `delivery_method_id` map: `delivery` vs `self_collect` _(slots + credential defaults; IDs **TBD Loft**)_
  - [ ] Shipping address rules for self-collect orders _(SOW Krislite door unit noted; OFS field rule **TBD**)_
  - [x] Order status enum → SKUMS status map _(provisional heuristics aligned to `poll-orders`; official table **TBD**)_
  - [x] Inbound (`ship_to_warehouse`) status enum + partial/spoil fields _(provisional + identity fields; official ids **TBD**)_
  - [x] SKU-only vs required `product_id` _(target: require mapped product_id; confirm with Loft)_
  - [x] ASN field parity vs SOW (UPC, expiry, carton/pallet counts)
  - [x] Confirm FEFO at Loft + LISE short-date rule (e.g. 9 months) _(SOW + SKUMS 9‑mo gate; reconfirm WMS with Loft)_
  - [x] M&P tracking: what goes in ASN metadata
- [x] Structured email to Loft (and WorldSyntech if needed) — draft in dictionary; **send pending human**
- [x] Update `docs/LOFT_SOW_KIV.md` “Locked-in” with product locks _(full OFS ID tables still after Loft reply)_

**Depends on:** nothing  
**Unblocks:** live pilot + replacing poll heuristics; originally unblocked A–D (now shipped on placeholders)  
**Parallel with:** Phase P / E–F

---

## Phase A — Locations, multi-store bind, product map

**Goal:** every sale/replenish/receive hits the right store and Loft location.

### PR-A.1 — Seed Loft + store inventory topology `[skums]`

**Scopes:** `locations:write` (setup); `locations:read` (view)

**Touches:** `core/db/` migration, workspace seed, inventory UI labels

**Work:**

- [ ] Location `LOFT-SG` (`location_type = 3pl`)
- [ ] Each physical store `location_type = store` with stable codes
- [ ] Optional `in_transit` location(s) for Loft→store legs
- [ ] Link every `pos_locations` row → `inventory_location_id`
- [ ] Document topology in `LOFT_OPS_DICTIONARY.md`

**Out of scope:** OFS calls, POS UI redesign

---

### PR-A.2 — OFS product mapping UX + hard gate `[skums]`

**Scopes:** `integrations:execute`, `products:read`, `inventory:read`; mapping UI write as products/integrations write

**Touches:** `fulfillment/worldsyntech-ofs/*`, integration routes, `integration_entity_mappings`, attention items

**Work:**

- [ ] Pull OFS products into mappings (`product_id`, sku, upc)
- [ ] Match SKUMS products by mapping → SKU → UPC
- [ ] Attention items for unmapped / duplicate SKU
- [ ] Block send-to-3pl when any line lacks OFS product mapping

---

### PR-A.3 — POS multi-store / register binding `[pos]`

**Scopes (SKUMS side when configuring):** `pos:config`  
**POS local:** admin/owner settings; runtime uses bound store for all writes

**Touches (fran-pos):** store config, sale adapter, stock-movement, event payloads

**Work:**

- [ ] Live mode: bind terminal to one store code (not only `FRAN01`)
- [ ] All SKUMS writes include store code + inventory location id
- [ ] Tests: sale/event payload includes bound store

**Depends on:** PR-A.1  
**Out of scope:** receive workflow (Phase C)

---

### PR-A.4 — Catalog / ATS is store-scoped `[skums]` + thin `[pos]`

**Scopes:** `pos:read` (catalog); POS display only

**Work:**

- [ ] Catalog returns stock for requesting store location
- [ ] POS stock page shows store ATS as **display cache**, not second ledger

**Depends on:** PR-A.1, PR-A.3

---

## Phase B — Store replenishment (request → HQ decide → optional Loft)

**Goal:** store signals and weekly waves become OFS orders only after HQ decision.  
**Default rhythm:** **Monday + Thursday** replenishment waves. Store requests are **inbox signals**, not automatic Loft jobs.

```text
[POS manager+] request
      │
      ▼
store_replenishment_requests (submitted)
      │
      ├─► notification center / Actions inbox  →  users with store_ops:approve
      │
      ▼
HQ + MCP: baseline demand + lift vs Mon/Thu wave capacity
      │
      ├─► approve now (lift / urgent)  →  convert order  →  execute_3pl when ready
      ├─► defer_to_wave (Mon or Thu)   →  attach to next wave plan
      └─► reject / close               →  notify store optional
```

### PR-B.0 — Request → notification for approvers `[skums]` (+ Phase N alignment)

**Scopes:**  
- Create request: `store_ops:write`  
- Receive notification / open inbox: holders of `store_ops:approve`  
- No `execute_3pl` on this path

**Touches:** request create hooks, notification outbox / Actions inbox, store-ops inbox UI, audit `store_ops.request.submitted`

**Work:**

- [ ] On request submit: enqueue notification for workspace members who resolve to `store_ops:approve`
- [ ] Inbox item: store, priority, lines summary, needed_by, requester, deep link
- [ ] Status stays `submitted` / `in_review` until human decide — **never** auto-convert or auto-Loft
- [ ] Align with Phase N (`TODO.md`) notification bus if N1 tables exist; else minimal in-app inbox for MVP
- [ ] Optional email/push later; in-app + MCP-listable queue is enough first cut
- [ ] Audit: who was targeted by policy, who later decided

**Depends on:** request API; **P.1** for “who has approve”  
**POS:** no change beyond submit

---

### PR-B.1 — Order model extensions for delivery mode & schedule `[skums]`

**Scopes:** migration + UI edit under `store_ops:write` / `store_ops:approve`

**Work:**

- [ ] Fields: `delivery_mode` (`delivery` \| `self_collect`), `delivery_method_id`, windows, optional pallet metadata
- [ ] Connection defaults for delivery method ids
- [ ] UI: choose delivery vs self-collect when creating/approving order
- [ ] Request decision fields: `decision` = `approved` \| `rejected` \| `deferred_to_wave`; `wave_date` (next Mon/Thu); `decision_reason`; `mcp_context` jsonb (optional baseline/lift snapshot)

**Depends on:** Phase 0 map (or config placeholders)

---

### PR-B.1b — Mon/Thu weekly wave calendar (baseline cadence) `[skums]`

**Scopes:** configure `store_ops:approve` or `locations:write`; read `store_ops:read`

**Work:**

- [ ] Workspace setting: replenishment weekdays default **Monday + Thursday** (LISE)
- [ ] Wave plan: `wave_date`, stores included, cutoff before send
- [ ] HQ builds wave lines from: (a) deferred requests, (b) baseline suggestions, (c) manual adds
- [ ] Store request “defer” attaches to a specific upcoming Mon/Thu wave
- [ ] POS may later show “next wave: Thu” read-only (Phase F.3)

**Depends on:** B.1 decision fields  
**Note:** This is the **default pipe**. Ad-hoc approve is the exception path.

---

### PR-B.1c — MCP baseline + lift decision support `[skums]` / MCP

**Scopes:** tools under `mcp:safe` + `intel:read` + `inventory:read` + `store_ops:read`  
**Must not:** silent `store_ops:approve` or `store_ops:execute_3pl` as side effects of analysis tools

**Work:**

- [ ] MCP tool(s): given store + SKU or open request id, return:
  - baseline (sell-through, weeks of cover, residual after planned Mon/Thu wave)
  - lift / urgency (campaign, stockout risk, request priority)
  - recommendation **label only**: `approve_now` \| `defer_to_wave` \| `reject` — human still decides
- [ ] MCP: list open replenishment requests for HQ review
- [ ] MCP: list upcoming Mon/Thu waves + attached deferred requests
- [ ] Persist optional `mcp_context` on decision for audit
- [ ] Document: “decision support only; approval is privileged UI/API”
- [ ] Tests: MCP safe profile cannot convert request or call OFS

**Depends on:** forecasting/intel as available; request list; **P.1**  
**Related:** M0–M4 MCP patterns; cloud-safe allowlist

---

### PR-B.2 — Orchestrator: human approve → order → (optional) Loft send `[skums]`

**Scopes:**  
- Decide: `store_ops:approve`  
- Send to Loft: `store_ops:execute_3pl` + `integrations:execute` (**separate** step)  
- App must be installed with WorldSyntech granted scopes

**Touches:** orchestrator service, convert/send routes, OFS client/mapping, executions, store-ops UI

**Work:**

- [ ] Decision API: `approve_now` | `reject` | `defer_to_wave` (with `wave_date`)
- [ ] **Only** approved / wave-ready lines convert to `store_replenishment_orders`
- [ ] Resolve OFS product_ids; fail with attention items
- [ ] Explicit “Send to Loft” or wave-release job → `order/create`; store `external_order_id`; status `sent_to_3pl`
- [ ] Idempotency by reference / order_number
- [ ] **Do not** auto-increment store `on_hand` on send
- [ ] **Do not** auto-send on request submit
- [ ] Gate UI + API with scopes above
- [ ] Record decision actor + optional `mcp_context`

**Depends on:** PR-A.2, PR-B.1, PR-B.0, **P.1**

---

### PR-B.3 — Poll OFS order status → SKUMS order status `[skums]`

**Scopes:** `store_ops:execute_3pl` + `integrations:execute` (mutating poll); read-only status view: `store_ops:read`

**Work:**

- [ ] Map OFS statuses via Phase 0 dictionary
- [ ] Include ready_for_collect / shipped / exception paths
- [ ] Policy: when to post `in_transit` (default: shipped or ready_for_collect)
- [ ] Self-collect ready state visible as expected delivery for POS

**Depends on:** PR-B.2, Phase 0

---

### PR-B.4 — Near-expiry / FEFO policy gate on send `[skums]`

**Scopes:** default gate uses system policy; override requires `inventory:override_expiry` (+ `store_ops:execute_3pl` to send)

**Work:**

- [ ] Min remaining shelf life policy (default 9 months if SOW keeps it)
- [ ] Block or require override before OFS create
- [ ] Record override actor + reason on order metadata
- [ ] FEFO **pick** remains Loft’s job
- [ ] Wave release uses same gate as ad-hoc send

**Depends on:** PR-B.2

---

### PR-B.5 — POS: request replenishment (signal only) `[pos]`

**Scopes (machine):** `store_ops:write` (and `pos:write` if colocated)  
**POS roles:** `manager`+ (not `cashier`)  
**Outcome:** HQ notification only — not Loft, not approved stock move

**Work:**

- [ ] Submit lines: sku, qty, reason, priority, needed_by
- [ ] Idempotency keys
- [ ] **No** local stock change on request
- [ ] Copy: “Request sent to HQ” / “Reviewed against Mon & Thu replenishment”
- [ ] Optional status read: submitted | in_review | deferred_to_wave | approved | rejected (no execute details)
- [ ] Client role gate + server scope gate
- [ ] Never show “Loft order created” from this screen

**Depends on:** request API; PR-A.3; PR-B.0; **P.2** POS matrix

---

## Phase C — Store receive + exception verification (critical path)

**Goal:** store sellable stock only after receive; POS can flag bad/missing goods; SKUMS verifies.

### Design rules for receipt exceptions

| Actor | Allowed | Scope / role |
|-------|---------|----------------|
| POS cashier+ | Confirm good qty; report short / damaged / over / wrong_sku / unexpected; note | POS local any staff; key: `pos:write` / `store_ops:write` |
| POS staff | Submit receiving session (idempotent) | same |
| POS staff | **Cannot** resolve exception / liability / ASN | no `store_ops:verify` on POS key |
| SKUMS inventory ops | Verify / adjust / reject exception | `store_ops:verify` (+ `inventory:write` if ledger adjust) |
| SKUMS 3pl admin | Escalate to Loft, re-send | `store_ops:execute_3pl` |
| SKUMS ledger | Apply accepted good qty; hold disputed | server policy under receive handler |

**Recommended apply policy (v1):**

1. POS submits session → status `submitted`.
2. Auto-apply **uncontested good units** to store `on_hand` / clear matching `in_transit`.
3. Exception lines → `inventory_exceptions` `pending_verification`.
4. SKUMS staff with `store_ops:verify` → confirm / reject / adjust → final ledger correction.

Workspace flag may force hold-all-until-verify later.

---

### PR-C.1 — Expected deliveries API + receive submit API `[skums]`

**Scopes:**  
- List: `store_ops:read` **or** `pos:read`  
- Submit receive: `store_ops:write` **or** `pos:write`  
- Ledger apply inside handler: server-side (not granted to POS as free `inventory:write`)

**Touches:** Fran/POS store-ops routes, `receiving_sessions*`, `inventory_exceptions`, apply service, handoff contract

**Work:**

- [ ] `GET expected-deliveries?pos_location_code=`
- [ ] `POST receive` with lines + exception_type + idempotency_key
- [ ] Spawn exceptions for short/damaged/over/wrong/unexpected
- [ ] Apply good qty per policy
- [ ] Partial → `partially_received`; clean full → `received`
- [ ] Tests: scope denial for verify-only routes; POS key can receive; cannot call verify API
- [ ] Tests: idempotent resubmit; short line creates exception + applies good only

**Depends on:** PR-B.2/B.3 (or mocks); **P.1**

---

### PR-C.2 — SKUMS exception verification inbox `[skums]`

**Scopes:** list `store_ops:read`; actions `store_ops:verify`; ledger fix `inventory:write`

**Work:**

- [ ] Inbox filters: open / pending_verification / store / type
- [ ] Confirm / Adjust / Reject / Escalate to Loft
- [ ] Audit actor (scope resolution user id)
- [ ] Hide actions without `store_ops:verify`
- [ ] Never expose OFS credentials

**Depends on:** PR-C.1, **P.2**

---

### PR-C.3 — POS expected deliveries + receive UI `[pos]`

**Scopes:** machine key as PR-C.1  
**POS roles:** all roles may receive; no verify UI

**Work:**

- [ ] Expected list from SKUMS only
- [ ] Per line: received, damaged, exception type, note (required if exception)
- [ ] Copy: “Reported to HQ for verification” when exceptions present
- [ ] Wire partial qty
- [ ] Tests: payload enums match `044` exception_type checks
- [ ] No button path to HQ resolve

**Depends on:** PR-C.1  
**Out of scope:** Loft UI, approve replenishment, stock master

---

### PR-C.4 — Self-collect confirmation fields `[skums]` + light `[pos]`

**Scopes:** same as receive submit; ready-for-collect queue view: `store_ops:read`

**Work:**

- [ ] POS: collector name + time when `delivery_mode = self_collect`
- [ ] SKUMS: ready-for-collect ops list
- [ ] Still no Loft call from POS

**Depends on:** PR-C.1, PR-C.3, PR-B.1

---

## Phase D — Inbound KR/HK → Loft (M&P + ASN)

**Goal:** pre-alert Loft; track warehouse receive; promote trusted Loft stock.

### PR-D.1 — Local inbound ASN domain + create to OFS `[skums]`

**Scopes:** `store_ops:inbound` + `store_ops:execute_3pl` + `integrations:execute`

**Work:**

- [ ] Lifecycle: draft → asn_sent → in_transit → loft_receiving → partial/full → lise_confirmed → available
- [ ] M&P + palletization metadata
- [ ] Create OFS ASN; store stock_incoming ids
- [ ] UI for ops only (not POS)
- [ ] Gate all mutations with scopes above

**Depends on:** PR-A.2, Phase 0, **P.1**

---

### PR-D.2 — Poll inbound + LISE confirm + promote Loft stock `[skums]`

**Scopes:** poll execute as D.1; promote: `store_ops:inbound` + `inventory:write`

**Work:**

- [ ] Poll partial vs declared
- [ ] LISE confirm required on variance
- [ ] Promote to `LOFT-SG` only after policy
- [ ] Never write store on_hand from inbound
- [ ] Optional expiry batch on confirm (`expiry:write`)

**Depends on:** PR-D.1, PR-A.1

---

### PR-D.3 — POS: no inbound-to-Loft UI `[pos]`

- [ ] Explicit non-goal (no scopes exposed for ASN on POS key)

---

## Phase E — Floor hygiene (adjustments, counts)

### PR-E.1 — Approve/apply POS damage & found `[skums]`

**Scopes:** report already via `pos:write`; approve apply: `inventory:write` (and/or `store_ops:verify` if unified inbox)

**Work:**

- [x] Pending adjustments → approve/reject → ledger (`058` + Store Ops **Floor adjustments** tab)
- [x] Align UX with exception verification (C.2)
- [x] `recordAudit` on apply/reject; intake audit on POS inventory-events
- [x] Fix store receive ledger types → `transfer_received` (logging hygiene)

---

### PR-E.2 — POS cycle count / variance report `[pos]` + `[skums]`

**Scopes:** POS submit `pos:write` / `store_ops:write`; apply variance `inventory:write` + verify-class role

**Work:**

- [x] POS counts vs SKUMS expected; submit variance only (`inventory.cycle_count.reported` → stocktake adjustment)
- [x] SKUMS approve before ledger write (same apply path as E.1)

---

### PR-E.3 — Deprecate POS free-form “receive stock” as ledger `[pos]`

**Work:**

- [x] Loft deliveries only via Phase C (Receive delivery)
- [x] Stop treating local `inventory_count` as authority (live free-form receive disabled; display cache copy)

---

## Phase F — Delivery calendars & multi-store waves (extends B.1b)

**Note:** Mon/Thu **replenishment wave** cadence is owned in **PR-B.1b** (baseline). Phase F adds per-store delivery windows (Loft → door) and allocation polish.

### PR-F.1 — Store delivery calendar + cutoffs `[skums]`

**Scopes:** configure `locations:write` or `store_ops:approve`; read for POS `store_ops:read`

- [x] Per-store fixed receive windows (e.g. prime before 10:00) on top of Mon/Thu wave days (`store_delivery_calendars`, Store Ops **Waves & calendar**)
- [x] Cutoff for “include in Thursday wave” vs “next Monday” (`wave_include_cutoff_hours` + next-wave resolver)
- [x] Align self-collect vs delivery slots with wave release (preferred_delivery_mode + defaults)

### PR-F.2 — Multi-store allocation from Loft ATS `[skums]`

**Scopes:** `store_ops:approve` + `inventory:read`; send still `store_ops:execute_3pl`

- [x] Allocate one Loft SKU across stores for a wave without overselling Loft available (preview + optional persist draft)
- [ ] MCP may suggest allocation; human approves wave _(preview is HQ UI; MCP wire optional follow-up)_

### PR-F.3 — POS show next wave on request form `[pos]`

**Scopes:** read-only from SKUMS; no calendar edit  
**POS roles:** same as request (manager+)

- [x] Display “Next scheduled replenishment: Monday / Thursday …” (`GET /fran/store-ops/next-wave`)
- [x] Help store staff understand ad-hoc request is for lift/urgent, not the default pipe

---

## Phase G — Connector completeness & ops polish `[skums]`

All G routes: `integrations:execute` and/or `store_ops:execute_3pl` as appropriate; credentials remain admin-only.

### PR-G.1 — OFS product push (if required)

### PR-G.2 — Cancel / hold replenishment (`store_ops:execute_3pl`)

### PR-G.3 — Snapshot reconciliation report (`inventory:read` + `integrations:read`)

### PR-G.4 — Integration card UX (hide actions without scopes)

---

## Phase H — Ecommerce (deferred)

**Do not start until retail path (A–C) + Phase P MVP are stable.**

### PR-H.1 — Fulfillment mode split `[skums]`

- [ ] Separate scopes later if needed (`fulfillment:ecommerce` — **not** in MVP catalog)
- [ ] Do not overload `store_ops:*` for consumer orders

### PR-H.2 — Channel adapters

- [ ] POS unchanged unless BOPIS

---

## Suggested PR stack order (merge sequence)

```text
P.0  scope freeze + seeds          ★ permissions foundation
P.1  resolveScopes + requireScope   ★
0.1  Loft dictionary (parallel)
P.2  role matrices (docs + POS UI gates)
P.4  app install grants (can follow P.1)
A.1  locations topology
A.2  product mapping
A.3  POS store bind
A.4  store-scoped catalog
P.3  gate existing OFS/store-ops routes (ongoing as routes land)
B.1  delivery_mode + decision fields
B.1b Mon/Thu weekly wave calendar  ★ default cadence
B.0  request → HQ notification     ★ no auto-Loft
B.1c MCP baseline + lift support   ★ decision aid
B.5  POS request (signal only)     (manager+ / store_ops:write)
B.2  human approve → order → send  (approve ≠ execute_3pl)
B.3  poll orders
B.4  near-expiry gate
C.1  expected + receive APIs       ★ store stock hinge (gated)
C.2  SKUMS verify exceptions       ★ store_ops:verify
C.3  POS receive + bad receipt UI  ★
C.4  self-collect fields
D.1  ASN domain                    (store_ops:inbound)
D.2  poll inbound + promote
E.*  floor hygiene
F.*  store door windows + allocation (extends B.1b)
G.*  connector polish
H.*  ecommerce
```

**MVP for trustworthy store inventory under Loft:**

```text
P.0 → P.1 → A.1 → A.2 → A.3 → B.0 → B.1 → B.1b → B.5 → B.2 → B.3 → C.1 → C.2 → C.3
```

(B.1c MCP can trail first human-only approvals if intel data is thin.)

**MVP for KR/HK inbound visibility:** add `D.1 → D.2` (needs `store_ops:inbound`).

**MVP permission / process bar (must be true before production Loft send):**

- [ ] POS key cannot `store_ops:verify`, `store_ops:approve`, or `store_ops:execute_3pl`
- [ ] Cashier cannot submit replenishment request (POS role)
- [ ] Request submit only notifies `store_ops:approve` holders — never OFS
- [ ] Approve / defer-to-wave requires `store_ops:approve` (MCP may recommend only)
- [ ] Send-to-Loft requires human (or scheduled wave job) with `store_ops:execute_3pl`
- [ ] Exception resolve requires `store_ops:verify`
- [ ] OFS credentials require `credentials:write` / admin install path
- [ ] Default ops rhythm documented as Mon + Thu waves

---

## Repo checklist summary

### fran-skums owns

- [ ] Scope catalog freeze, seeds, `resolveScopes`, `requireScope`
- [ ] Role packages + store_ops fine-grained scopes
- [ ] WorldSyntech + POS app `required_scopes` / `granted_scopes`
- [ ] Inventory locations + ledger apply
- [ ] OFS connector (auth, products, inventory pull, ASN, order create/poll)
- [ ] Store-ops request/order lifecycle
- [ ] **Notification / inbox** for `store_ops:approve` when store requests land (Phase N align)
- [ ] **Mon/Thu wave** planning + defer-to-wave
- [ ] **MCP tools** for baseline + lift (recommend only; no silent approve/send)
- [ ] Human approve / reject / defer → convert → send (split scopes)
- [ ] Expected deliveries + receive APIs
- [ ] Exception verification inbox (`store_ops:verify`)
- [ ] FEFO/short-date **policy** gates (+ override scope)
- [ ] Inbound ASN lifecycle + Loft stock promote
- [ ] Delivery calendars, multi-store allocation
- [ ] Ecommerce fulfillment mode (later)
- [ ] All Loft credentials and mappings

### fran-pos owns

- [ ] Local role gates (`cashier` / `manager` / `admin` / `owner`)
- [ ] Store/register binding
- [ ] Display store ATS (cache)
- [ ] Submit replenishment **requests as HQ signals** (manager+) — not warehouse orders
- [ ] List expected deliveries (SKUMS)
- [ ] Confirm receive; report short / damaged / over / wrong / unexpected (all staff)
- [ ] Self-collect collector details
- [ ] Damage / found / count **reports**
- [ ] Optional read-only request status / next Mon–Thu wave day
- [ ] Least-privilege SKUMS API key usage
- [ ] Sale write-back (existing)

### fran-pos does **not** own

- [ ] OFS / Loft API calls
- [ ] HQ notification targeting / approve inbox
- [ ] MCP baseline/lift analysis
- [ ] Approve / defer-to-wave / weekly wave build
- [ ] Final exception disposition (`store_ops:verify`)
- [ ] Send-to-Loft (`store_ops:execute_3pl`)
- [ ] ASN / M&P inbound
- [ ] Canonical inventory ledger
- [ ] Delivery calendar configuration
- [ ] Scope catalog / permission schemas

### Loft / human process (not a PR)

- [ ] Status/delivery method dictionary answers
- [ ] WhatsApp variance close (logged in SKUMS under verifier identity)
- [ ] Damage photos / destroy authority
- [ ] Short-dated written waiver when WMS blocks
- [ ] M&P multi-leg tracking noise

---

## Acceptance criteria (cross-cutting)

### Store inventory status

- [ ] Sale decrements correct store location only
- [ ] Send-to-Loft does not increase store on_hand
- [ ] Store on_hand increases only from verified/applied receive path
- [ ] Short/damaged lines never silently count as sellable
- [ ] OFS inventory pull alone never overwrites store levels

### POS exception reporting

- [ ] Staff can complete a receive with mixed good + exception lines in one submit
- [ ] Exception lines always create SKUMS `inventory_exceptions` for staff queue
- [ ] POS UI labels exceptions as **reported**, not **resolved**
- [ ] SKUMS staff with `store_ops:verify` can confirm / adjust / reject with audit trail
- [ ] Idempotent receive submit does not double-apply stock

### Self-collect vs delivery

- [ ] Same receive UX; delivery_mode only changes copy + collector fields
- [ ] `delivery_method_id` mapped from SKUMS config, not POS

### Permissions & roles

- [ ] Every new store-ops / OFS / receive route declares and enforces scopes
- [ ] POS connector key cannot approve, verify exceptions, or execute 3PL
- [ ] `cashier` cannot request replenishment; can report bad receipt
- [ ] `manager`+ can request replenishment (signal only); cannot approve or verify
- [ ] Request notifications only target `store_ops:approve` holders
- [ ] MCP baseline/lift tools cannot approve or send to Loft
- [ ] Empty API key scopes do not grant god-mode on new keys
- [ ] WorldSyntech app install records `granted_scopes`; execute paths check them
- [ ] Org admin UI passthrough never applied to machine keys

### HQ decision + weekly cadence

- [ ] Default replenishment waves are **Monday and Thursday**
- [ ] Store request never creates OFS order without `store_ops:approve` decision
- [ ] HQ can defer request into next Mon/Thu wave using baseline/lift context
- [ ] MCP recommendation is advisory; human decision is auditable
- [ ] Wave release and ad-hoc lift both go through same send/poll path when executed

---

## Open decisions

| ID | Decision | Default if silent |
|----|----------|-------------------|
| D1 | Auto-apply good qty on POS submit vs hold all until HQ verify | Auto-apply good; hold exceptions |
| D2 | When to post store `in_transit` from Loft status | On shipped / ready_for_collect |
| D3 | Expiry on ASN via API vs ops entry at confirm | Ops entry at confirm until API fields exist |
| D4 | Partial pallet: metadata only vs carton scan | Metadata only in MVP |
| D5 | Ecom ship-from Loft vs store | Loft ATS preferred |
| D6 | Does POS API key include `store_ops:write` or only `pos:write` with server mapping receive under pos:write? | Prefer explicit `store_ops:read` + `store_ops:write` on pos-connector package for clarity |
| D7 | Can inventory manager send to Loft or only 3pl_admin? | Default: inventory manager **approve / wave** only; send requires `store_ops:execute_3pl` (admin/ops) |
| D8 | Empty legacy API keys | Migrate to explicit packages; deny full by default on create |
| D9 | Notification transport for request inbox | In-app (+ Phase N email later); target `store_ops:approve` only |
| D10 | MCP may call a “propose decision” vs read-only analysis | Read-only analysis + label; human must invoke approve API |
| D11 | Wave days configurable per workspace? | Yes; **default Mon + Thu** for LISE |

---

## Implementation status (checkboxes)

### Done on `main` (pushed)

| Phase | Status | Evidence |
|-------|--------|----------|
| **P** Permissions | ✅ | `055`, `scopes.ts`, `scopeAuth.ts`, schemas store_associate/inventory_ops |
| **0** Dictionary | ✅ expanded draft | `docs/LOFT_OPS_DICTIONARY.md` + Loft email; live URLs/IDs still TBD |
| **A** Topology / catalog | ✅ | LOFT-SG seed, pull-products, catalog `pos_location_code` |
| **B** Waves / decide / send | ✅ | `056`, storeReplenishment, decide/send/poll, MCP tools, POS request-stock |
| **C** Receive / exceptions | ✅ core + C.4 | expected-deliveries, receive, verify, ready-for-collect, POS receive |
| **D** Inbound ASN | ✅ | `057`, inbound APIs, poll-inbound, confirm→LOFT-SG, store-ops Inbound tab |
| **E** Floor hygiene | ✅ core | `058` apply/reject, floor UI, cycle count, POS receive gate; logging + operator docs + Help AI |
| **F** Calendars / waves | ✅ core | `061` calendars + cutoffs; allocation preview; POS next-wave |
| **G–H** | ⏳ pending | Connector polish, ecommerce |

### Still open (do not treat as done)

- [ ] **Send** Phase 0 email (`docs/LOFT_OPS_DICTIONARY.md`); paste Loft answers; set live credential + delivery_method_ids
- [ ] Full `requireScope` on every legacy integration route (P.3 completeness)
- [ ] Empty API key scopes → deny/package (breaking change when ready)
- [ ] Phase F wave cutoffs + allocation polish (in progress)
- [x] Phase N bus on top of `store_ops_notifications` (in_app + Slack; email provider later)
- [ ] POS never owns ASN (D.3 remains non-goal)

---

## Progress log

| Date | Note |
|------|------|
| 2026-07-14 | Initial phased PR plan from dual-repo inventory audit + Loft assumption |
| 2026-07-14 | **Finalized:** Phase P permissions/roles integrated with `ORG_PERMISSION_SCOPES.md`; fine-grained `store_ops:approve|verify|execute_3pl|inbound`; POS role matrix; scope gates on every operational PR; merge order leads with P.0/P.1 |
| 2026-07-14 | **Replenishment model:** store request = HQ notification only; Mon/Thu weekly waves as baseline; HQ uses MCP baseline+lift to approve-now vs defer-to-wave; approve ≠ execute_3pl (PRs B.0, B.1b, B.1c) |
| 2026-07-14 | **Build start Phases P + 0 + A:** migration `055_loft_permissions_topology.sql`; `server/utils/scopes.ts` + `scopeAuth.ts`; `docs/LOFT_OPS_DICTIONARY.md`; pull-products; store-scoped POS catalog; POS `pos-store-config` binding |
| 2026-07-14 | **Phase B:** migration `056` waves+inbox+decisions; `storeReplenishment` orchestrator; decide/send/poll APIs; MCP store_ops_* tools; POS Request stock page |
| 2026-07-14 | **Migrations 055+056 applied** (via `--from 055`; 015 checksum drift pre-existing). **B.4** near-expiry gate; **Phase C start:** expected-deliveries, receive apply, exception verify APIs; POS Receive page; HQ Lift now / Defer / Confirm claim UI |
| 2026-07-14 | **Committed** skums `38d4383` + pos `4148095` (no deploy). **C.4:** ready-for-collect queue, pickup_ready_at on poll, fran receive alias, inbox mark-read |
| 2026-07-14 | **Pushed** skums + pos to origin (deploy). **Phase D:** migration 057 ASN; create/send/poll/confirm+promote LOFT-SG; store-ops Inbound ASN tab |
| 2026-07-14 | **Todos updated** (`TODO.md` + this file): P–D marked shipped; next E/F or Phase N; push deploy for todo commit |
| 2026-07-15 | **Phase 0 expand:** full ops dictionary (auth, rate guidance, provisional status maps, ASN/SOW parity, FEFO/M&P, structured Loft email); SOW KIV product locks + checklist refresh |
| 2026-07-15 | **Phase E + logging:** `docs/INVENTORY_AND_PURCHASE_LOGGING.md`; migration `058` apply/reject adjustments; Store Ops floor tab; cycle count; POS free-form receive gated; receive ledger types fixed |
| 2026-07-15 | **Operator docs:** `docs/SKUMS_OPERATOR_RUNBOOK.md`; Help `059` (store-ops, replenishment, receive, floor, inbound, Loft, POS vs CRM); README + related doc links |
| 2026-07-15 | **Assistant Help:** resolve_help excerpts + store-ops scoring; `get_help_article` / MCP `help_get`; migration `060` operator-runbook; Store Ops page context |
| 2026-07-15 | **Commit + deploy** `docs/Commit Summary 15072026.md`; Phase F started |
| 2026-07-15 | **Phase F core:** migration `061` delivery calendars + cutoffs + wave allocations; Store Ops Waves tab; POS next-wave on request form |

---

## Quick links to existing code (starting points)

| Concern | SKUMS | POS |
|---------|-------|-----|
| Permission design | `docs/ORG_PERMISSION_SCOPES.md` | `packages/shared/src/constants/roles.ts` |
| Fulfillment adapter | `fulfillment/worldsyntech-ofs/` | — |
| Integration routes | `server/api/integrations/worldsyntech-ofs/` | — |
| Store-ops schema | `core/db/044_store_operations.sql` | — |
| Store-ops UI | `app/pages/store-ops/`, `useStoreOperations.ts` | — |
| Fran request intake | `server/routes/fran/store-ops/requests.post.ts` | call from POS |
| POS inventory events | `server/api/v1/pos/inventory-events.post.ts` | `stock.tsx`, `stock-movement.ts` |
| POS SKUMS client | — | `dashboard/src/pos/lib/skums-client.ts` |
| Receive exception types | `receiving_session_lines.exception_type` in `044` | must send same enums |
| Inventory ledger | `core/db/016_inventory.sql` | display only |
| Expiry / FEFO planning | `core/db/011_expiry.sql` | optional later batch UI |
| MCP/role precedents | M0–M4, `tests/mcp-scopes.test.mjs` | — |
| Handoff contract | `docs/POS_SKUMS_3PL_STORE_OPS_HANDOFF.md` | implement receive UI against this |

---

## Final ship rule (definition of done for “Loft live”)

1. ~~Phase **P.0 + P.1** merged and new keys least-privileged.~~ ✅ code shipped (enforce empty-key package still open)  
2. Phase **0** dictionary filled enough to map delivery methods + order statuses — ✅ draft + provisional maps; ⏳ official IDs until Loft answers  
3. ~~Path **A → B → C** live for at least one store.~~ ✅ APIs + UI; live Loft credential pilot remaining  
4. ~~Store request → **HQ notification** works; Mon/Thu wave is the default path; MCP can inform baseline/lift.~~ ✅  
5. ~~POS can report bad/missing receipt; SKUMS can verify with audit.~~ ✅  
6. ~~No production path where POS or a POS API key can approve waves, call OFS, or resolve HQ exceptions.~~ ✅ by design/scopes  
7. ~~No production path where MCP auto-approves or auto-sends to Loft.~~ ✅  
8. ~~Inbound ASN → LISE confirm → LOFT-SG promote (Phase D).~~ ✅ code + migration 057  

**Production pilot checklist:** Loft prod URL + delivery_method_ids · Vercel green · **055–060** on prod DB · Floor apply smoke · one store dry-run.
