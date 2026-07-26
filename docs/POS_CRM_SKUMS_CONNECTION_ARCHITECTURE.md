# Architecture: POS + CRM via SKUMS workspace key

**Status:** Design (target)  
**As of:** 2026-07-24  
**Related:** `docs/LOYALTY_FWB_ARCHITECTURE.md` · `fran-pos/docs/fran-pos-crm-skums-contract.md` · `docs/MCP_USER_PERMISSION_DESIGN.md` · A2 API keys

---

## 1. Goals

| Goal | Meaning |
|------|---------|
| **One operator secret on the register** | POS is configured with a **SKUMS workspace API key** (package `pos_connector` or successor), not a pile of CRM + SKUMS + Loft secrets in the browser. |
| **POS requires commerce + loyalty** | Live register cannot sell “half-configured”: SKUMS catalog/quote **and** CRM loyalty facade must both be ready (or cashier explicitly chooses non-member/tourist with no earn). |
| **SKUMS stays a hub, not a monolith** | Many apps (POS, CRM, Loft, MCP, web, reports) attach to a **workspace**. SKUMS **does not** depend on POS or CRM product code, schemas, or deploy order. |
| **CRM stays loyalty SoR** | Points ledger, tiers, policy publish, vouchers stay in CRM. SKUMS does not become the points database. |
| **Ownership unchanged** | POS = checkout UX · CRM = member/loyalty decisions · SKUMS = catalog, price, stock, sale facts, store-ops. |

---

## 2. Anti-pattern (what we have / must leave)

```text
Browser POS ──► SKUMS (api key)
     └──► CRM  (separate URL + optional secrets)   ❌ dual connection, dual auth, dual failure modes
```

Problems:

- Cashier setup is two integrations that can disagree on `workspaceId`.
- CRM credentials (or open demo endpoints) end up in POS localStorage / `VITE_*`.
- SKUMS sale and CRM `commit_sale` can drift on identity without a shared workspace binding.
- Every new app invents its own pair-wise wiring.

---

## 3. Target topology

```text
                    ┌─────────────────────────────────────┐
                    │           SKUMS workspace            │
                    │  identity · catalog · inventory ·    │
                    │  sales · store-ops · API keys ·      │
                    │  workspace_apps / integrations       │
                    └───────────────┬─────────────────────┘
           pos_connector key        │ server-side only
           (register)               │ CRM app link + service creds
                │                   │
                ▼                   ▼
         ┌────────────┐      ┌────────────┐
         │  Fran POS  │      │  Fran CRM  │
         │  checkout  │      │  loyalty   │
         └────────────┘      └────────────┘
                │                   ▲
                │  loyalty calls    │
                └───────────────────┘
           only via SKUMS POS loyalty facade
           (same API key as catalog/sale)
```

**POS holds one connection:** SKUMS base URL + workspace API key.

**CRM is not configured on the register** as a second product login. CRM is **linked once per workspace** in SKUMS (HQ Integrations / Apps).

**Other apps** (MCP, Loft worker, web) use their own key packages against the same workspace. They never import POS/CRM.

---

## 4. Core design principles

### 4.1 SKUMS = workspace bus, not app mesh

| SKUMS owns | SKUMS does **not** own |
|------------|------------------------|
| Workspace id, members, API keys | POS UI / PIN roles |
| Product, price, ATS, sale ingest | Points ledger / tier jobs |
| Optional **app links** (CRM base URL, status) | Campaign authoring |
| **Facades** for POS-safe routes | Hard compile dependency on fran-pos / fran-crm packages |

App links are **data + HTTP adapters**, same pattern as WorldSyntech/Loft: connection row, credentials encrypted server-side, health check. No `import from 'fran-crm'`.

### 4.2 Capability packages, not “POS knows CRM”

| Package / app | Consumer | Can call |
|---------------|----------|----------|
| `pos_connector` | Register | SKUMS catalog, quote, reservation, sale, **loyalty proxy** |
| `crm_runtime` (server) | SKUMS→CRM only | CRM loyalty APIs with service identity |
| `mcp:ops_safe` | Claude | Scoped SKUMS tools — no CRM secrets |
| `store_ops:*` | HQ UI / keys | Replenishment — no POS |

POS key never includes raw CRM credentials.

### 4.3 POS readiness = AND of two capabilities

Live register gate (before open sale / before payment):

```text
ready_for_member_loyalty =
  skums_ok          -- key valid, catalog or quote ping
  AND crm_link_ok   -- workspace CRM app enabled + SKUMS→CRM health

ready_for_sale =
  skums_ok
  AND ( crm_link_ok  OR  session is non_member/tourist  OR  loyalty_optional flag )
```

Recommended **default for Fran**: loyalty required for **member** path; non-member/tourist always allowed if SKUMS ok.

Settings UX:

1. Connect SKUMS (required).  
2. SKUMS shows “Loyalty (Fran CRM): linked / not linked / degraded”.  
3. POS does **not** ask for CRM URL when using workspace-key mode.

### 4.4 One workspace id everywhere

```text
POS company  ←bound to→  SKUMS workspace_id  ←linked to→  CRM workspace_id
```

- Binding stored on SKUMS (and mirrored in POS company settings as **workspace id only**, not CRM id as authority).  
- CRM receives `workspaceId` = **CRM’s** id from the **server-side link map**, not free-typed on the register.  
- Sale `idempotency_key` / `sale_id` shared: POS → SKUMS sale + POS → CRM commit via facade with same ids.

---

## 5. Request paths

### 5.1 Commerce (unchanged ownership)

```text
POS  --(SKUMS API key)-->  SKUMS  /fran/pos/* catalog · quote · reserve · sale
```

### 5.2 Loyalty (target)

```text
POS  --(same SKUMS API key)-->  SKUMS  /fran/pos/loyalty/*
                                      │
                                      │ server-to-server
                                      │ (CRM app connection + signing)
                                      ▼
                                   Fran CRM  /fran/pos/* · policy · commit_sale
```

Suggested SKUMS facade routes (names illustrative):

| POS calls SKUMS | SKUMS forwards to CRM |
|-----------------|------------------------|
| `POST /fran/pos/loyalty/member/resolve` | CRM member resolve |
| `POST /fran/pos/loyalty/counter-session` | CRM counter session |
| `GET  /fran/pos/loyalty/policy/active` | CRM policy `format=pos` |
| `POST /fran/pos/loyalty/commit-sale` | CRM commit_sale |
| `POST /fran/pos/loyalty/vouchers/*` | CRM vouchers |

POS client collapses to **one** `createSkumsClient`; loyalty methods are siblings of quote/sale.

### 5.3 Why not POS → CRM with SKUMS-minted JWT only?

Acceptable **variant B** (optional later):

```text
POS → SKUMS POST /fran/pos/session/bootstrap
   ← short-lived loyalty_token (aud=crm, workspace, store, register)
POS → CRM Authorization: Bearer loyalty_token
```

Still: POS only ever proved identity with the **SKUMS key**. CRM trusts SKUMS as issuer, not the register.

**Prefer facade first** (variant A): fewer CORS/secrets on register; one place to audit; offline queue can target SKUMS only.

---

## 6. Auth & trust

```text
Register API key (pos_connector)
  → SKUMS validates key → workspace_id, scopes, bound store/company
  → SKUMS loads workspace_app "fran_crm" connection
  → SKUMS calls CRM with:
        - CRM service credential (server secret), and/or
        - signed SKUMS assertion { workspace_map, store_id, register_id, request_id }
  → CRM checks assertion issuer = SKUMS, maps to CRM workspace, executes loyalty
```

| Actor | Trusts |
|-------|--------|
| POS | SKUMS key validity + TLS |
| SKUMS | API key table + CRM connection health |
| CRM | SKUMS service identity / shared secret / JWT issuer — **not** random browser keys |

**Never:** CRM service role or DB URL in POS.  
**Never:** SKUMS requiring CRM to boot.

---

## 7. Failure modes

| Failure | POS behavior |
|---------|----------------|
| SKUMS down | No live catalog/quote; existing offline sale policy only |
| CRM link missing | Block **member** loyalty; allow non-member/tourist if policy allows |
| CRM degraded | Cached policy TTL (already designed); earn **queued**; redeem may require live |
| commit_sale fails after pay | Sale already local + SKUMS outbox; loyalty queued with same sale_id (non-blocking pay) |

Pay must never hard-block solely on CRM (existing principle). **Open register for member marketing mode** may still require CRM healthy at shift start.

---

## 8. SKUMS multi-app model (no POS/CRM dependency)

```text
workspace
  ├── api_keys (packages: pos_connector, mcp:*, store_ops:*, …)
  ├── workspace_apps / integration_connections
  │     ├── worldsyntech_ofs (Loft)
  │     ├── fran_crm        (loyalty runtime link)   ← optional app
  │     ├── pos_register_fleet (optional metadata)
  │     └── …
  ├── products · inventory · sales · store_ops
  └── facades
        ├── /fran/pos/*          (commerce + loyalty proxy)
        ├── /api/v1/*            (generic)
        └── /mcp                 (agents)
```

Rules for SKUMS engineering:

1. **Optional features behind app enablement** — if `fran_crm` not linked, loyalty facade returns `503 loyalty_not_configured` with stable error code.  
2. **No CRM tables in SKUMS** for points/tiers (refs only: `member_ref`, `policy_version_id`, `commit_id` on sale metadata).  
3. **No POS schema** in SKUMS beyond sale/outbox contracts.  
4. New apps (mobile, web checkout) reuse the same workspace key packages + facades; they do not pair-wire to CRM.

---

## 9. POS product requirements (checklist)

| Requirement | Implementation sketch |
|-------------|------------------------|
| Single Integrations card primary | **SKUMS** (URL + key) required |
| CRM card | Hide or replace with “Loyalty status (from SKUMS)” read-only |
| Boot | `GET /fran/pos/capabilities` or health: `{ skums: ok, loyalty: ok\|missing\|degraded }` |
| Live sale | Require `skums: ok`; require `loyalty: ok` when starting **member** session |
| Client code | One HTTP client; remove browser `VITE_FRAN_CRM_URL` as production path |
| Outbox | Commerce events → SKUMS; loyalty commit → SKUMS facade (or replay queue) |

---

## 10. CRM product requirements

| Requirement | Notes |
|-------------|--------|
| Service auth from SKUMS | Not only end-user Supabase JWT for POS traffic |
| Workspace map | CRM workspace ↔ external `skums_workspace_id` |
| Idempotent commit_sale | Same `sale_id` / idempotency as POS/SKUMS |
| Demo mode | Allowed when SKUMS link points at demo CRM; still via facade |

---

## 11. Migration from today’s dual URL

| Phase | Work |
|-------|------|
| **M0** | Dual URL local dev (deprecated for prod) | Dev shim still available |
| **M1** | SKUMS `workspace_crm_links` + `/fran/pos/loyalty/*` + capabilities | **Done** (mig **073**, env `FRAN_CRM_BASE_URL`) |
| **M2** | POS prefer SKUMS loyalty when connector set | **Done** (`fran-crm-client` skums mode) |
| **M3** | POS readiness gate: member path needs loyalty_ok | **Done** (Sale banner + block Find member) |
| **M4** | HQ CRM-link UI; remove browser CRM URL from production | **Next** |
| **M5** | Test-workspace live demo runbook + prod Fran workspace checklist | After M4 / ops |

Local test can still run CRM on `:3000` **behind** SKUMS proxy once M1 exists; until then, dual URL is a **dev shim**, not the architecture.

---

## 12. Sequence (member sale)

```text
Cashier opens shift
  POS → SKUMS capabilities  → skums_ok, loyalty_ok

Cashier tags member
  POS → SKUMS loyalty/member/resolve  → CRM resolve
  POS → SKUMS loyalty/counter-session → CRM session

Basket changes
  POS → SKUMS basket/quote            → price/stock
  POS → SKUMS loyalty/policy/active   → CRM policy (cached)
  POS evaluates earn locally (policy bundle)  // optional; or CRM preview later

Payment succeeds
  POS → local receipt + outbox
  POS → SKUMS sale ingest             → commerce SoT
  POS → SKUMS loyalty/commit-sale     → CRM ledger (same sale_id)
```

---

## 13. Decision summary

| Question | Answer |
|----------|--------|
| How are POS and CRM connected? | **Through SKUMS workspace** — POS key + CRM app link; not POS↔CRM dual secrets. |
| What must POS require? | **SKUMS connection always**; **loyalty facade healthy** for member FWB path. |
| Does SKUMS depend on POS/CRM? | **No** — optional app link + HTTP facade; core commerce works without them. |
| Who owns points? | **CRM**. |
| Who owns catalog/stock/sale? | **SKUMS**. |
| Who owns checkout UX? | **POS**. |

---

## 14. Next implementation slice (when scheduled)

1. SKUMS migration: `workspace_app_links` or reuse `integration_connections` for `fran_crm`.  
2. SKUMS `GET /fran/pos/capabilities` (`skums`, `loyalty`).  
3. SKUMS proxy routes under `/fran/pos/loyalty/*`.  
4. POS: single client + readiness gate; deprecate Integrations CRM URL for prod.  
5. CRM: service auth for SKUMS caller.

Until then, local dual-URL testing (`CRM_POS_LIVE_TEST.md`) remains a **dev bridge**, not the target production architecture.
