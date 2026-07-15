# MCP roles ↔ web login permissions (A2 design)

**Status:** Design for review  
**Date:** 2026-07-15  
**Owner intent:** Web login power and MCP key power must not diverge. A workspace **superadmin/owner** (e.g. Jeremy) can create and **revoke** API keys. Staff MCP connectors only get what that person could do in the SKUMS UI.

**Related:** `docs/ORG_PERMISSION_SCOPES.md` · `mcp/src/toolScopes.mjs` · `server/utils/scopeAuth.ts` · `server/utils/scopes.ts`

---

## 1. Problem

| Today | Issue |
|-------|--------|
| Web | `workspace_members.role` + `permission_schemas` → UI `can(area, action)` (uneven enforcement) |
| MCP cloud | API key scopes → `resolveCloudMcpScopes` → always **cloud-safe max**; empty key historically “full” but cloud still strips privileged tools |
| Catalog AI | Session user tools; not the same gate as MCP |
| Keys | Workspace-scoped; RLS: **admins** manage; `created_by` stored but **not** used to cap key power |

**Risk:** Someone creates a Claude key with `mcp:safe` (draft store request, draft PO, intel) even if their **login role is viewer**. Or a shared key outlives an employee.

**Principle (non-negotiable):**

> **Effective MCP power ≤ effective web power for the same actor in that workspace.**  
> Machine keys never exceed the **issuer’s** (or **bound user’s**) resolved scopes. Cloud never grants privileged ops regardless.

---

## 2. Actors (three kinds — one scope catalog)

```text
┌─────────────────┐     resolveScopesForUser      ┌──────────────────┐
│ User session    │ ────────────────────────────► │ granted scopes[] │
│ (web / Catalog  │   role + permission_schema    │ same catalog     │
│  AI)            │                               └────────┬─────────┘
└─────────────────┘                                        │
                                                           │ same
┌─────────────────┐     resolveScopesForApiKey             │ vocabulary
│ API key / MCP   │ ────────────────────────────►          ▼
│ (Claude, POS,   │   key.scopes ∩ max_for_key    ┌──────────────────┐
│  workers)       │   (capped by bound user)      │ requireScope /   │
└─────────────────┘                               │ toolScopes map   │
                                                  └──────────────────┘
```

Canonical strings already live in `ORG_PERMISSION_SCOPES.md` and `server/utils/scopes.ts` (`SCOPE_PACKAGES`, `permissionsMapToScopes`).

MCP-only aliases stay as **aliases**, not a second ACL:

| MCP tool scope (today) | Canonical / web meaning |
|------------------------|-------------------------|
| `intel:read` | products + market + help reads |
| `inventory:read` / store_ops:* | same as UI store-ops / inventory |
| `po:draft` | `actions:write` / draft internal PO |
| `po:submit` / `po:decide` | `actions:submit` / `actions:approve` |
| `pipeline:propose` | actions pipeline propose |
| `pipeline:execute` | privileged — owner/admin + full MCP only |
| `store_ops:write` | create request / receive signal (UI same) |
| `store_ops:approve` / `execute_3pl` | HQ only — **never on cloud MCP** |

---

## 3. Role packages → MCP connector templates

One package per **workspace login role** (and optional schemas). Creating an MCP key picks a **template ≤ creator’s scopes**.

| Web role / schema | MCP key template | Cloud tools (examples) | Explicitly never on cloud |
|-------------------|------------------|------------------------|---------------------------|
| **Owner / Admin** (superadmin of workspace) | `mcp:ops_safe` (default connector) | Full cloud-safe set: catalog composites, inventory status, ops_snapshot, draft PO, draft store request, study propose, capabilities | approve, execute_3pl, po_submit, pipeline_execute, seed write |
| **Member** | `mcp:member` | Catalog read/export/data_ops, inventory ATS/status, help, ops_snapshot **read**, draft store request if schema has `store_ops:write`, draft PO if `actions` write/submit | approve, execute_3pl, api key admin, credentials |
| **Viewer** | `mcp:viewer` | Read-only: catalog health/sample/search, inventory_ats **read**, ops_snapshot read, help, capabilities | All writes, drafts, study write |
| **Store associate** schema | `mcp:store` | product search, inventory_ats, store_ops list + **create draft request**, help | catalog bulk, PO, pipeline, approve |
| **Buyer** schema (optional) | `mcp:buyer` | catalog research, intel read, pipeline propose, PO draft | store_ops approve, Loft |
| **Finance** schema | `mcp:finance` | projections, PO list/get, actions read | execute_3pl, catalog write |

**Owner/admin special powers (web, not MCP cloud tools):**

| Action | Scope | Who |
|--------|-------|-----|
| List / create / **revoke** API keys | `api:read` / `api:write` | owner, admin (and `api:write` in schema) |
| Assign permission schemas / roles | `team:roles` | owner, admin |
| Bind key to a user | `api:write` | owner, admin |

Jeremy as **workspace owner** → full `api:write` → can revoke any workspace key (RLS already: `get_my_admin_workspace_ids()`).

---

## 4. Key model changes (schema + rules)

### 4.1 Fields (migration)

```text
api_keys
  ...existing...
  created_by          -- already exists
  bound_user_id       uuid null  -- “this key acts as this member”
  key_kind            text       -- 'mcp_connector' | 'pos' | 'integration' | 'general'
  max_package         text       -- e.g. mcp:viewer | mcp:member | mcp:ops_safe
  revoked_at          timestamptz null
  revoked_by          uuid null
```

### 4.2 Cap rule (core invariant)

```text
effective_key_scopes =
  expand(key.scopes | key.max_package)
  ∩ expand(bound_user_id ?? created_by → resolveScopesForUser)
  ∩ CLOUD_SAFE_CEILING          -- if cloud MCP
```

- If **bound_user** loses membership or is demoted → next request re-resolves; if empty, **401/403**.
- Optional hard mode: on role change, auto-`is_active=false` keys bound to that user (settings flag).

### 4.3 Cloud ceiling (unchanged philosophy)

Even owner-bound keys on **remote** `/mcp`:

- No `po_submit`, `po_decide`, `pipeline_decide/execute`, `bi_upsert_seed`, `bi_run_seed_now`
- No `store_ops:approve`, `store_ops:verify`, `store_ops:execute_3pl`

Privileged ops stay: **UI** or **local full-profile MCP** with explicit env + human.

### 4.4 Catalog AI (in-app)

Same rule without a key:

```text
effective_assistant_scopes = resolveScopesForUser(session)
→ filter assistant tools the same way toolScopes filters MCP tools
```

So a **viewer** session cannot get write tools in Catalog AI either.

---

## 5. “What can I do?” path (already half-built)

| Step | Mechanism |
|------|-----------|
| 1 | Auth: Bearer / URL key → workspace + key row |
| 2 | `effective_key_scopes` (cap rule above) |
| 3 | `capabilities` → `key_permissions.permitted_actions` (`mcp/src/toolScopes.mjs`) |
| 4 | `tools/list` only lists tools that key can call |

**After A2:** response also includes:

```json
{
  "actor": {
    "kind": "api_key",
    "key_id": "...",
    "key_name": "Jeremy Claude",
    "bound_user_id": "...",
    "bound_user_role": "owner",
    "web_equivalent": "workspace owner (cloud-safe ceiling)"
  },
  "key_permissions": { "permitted_actions": ["..."], "granted_scopes": ["..."] }
}
```

---

## 6. Revoke API keys (owner/admin)

### Today

- Settings → API keys: delete / deactivate  
- RLS: admins only (`get_my_admin_workspace_ids`)  
- Owner (Jeremy) already qualifies as admin for that workspace  

### A2 product requirements

1. **Revoke** = `is_active=false` + `revoked_at` / `revoked_by` (prefer soft revoke over hard delete for audit).  
2. Only users with **`api:write`** (owner/admin package) can revoke.  
3. List shows `created_by`, `bound_user`, last used, package.  
4. Optional: “Revoke all keys for user X” when removing a member.  
5. MCP calls on revoked key → **401** immediately (already if `is_active` checked — verify `authenticateApiKey`).

No MCP tool to revoke keys (would be recursive/abusable); revoke stays **web Settings** (or future admin API with session + `api:write`).

---

## 7. UX flows

### 7.1 Owner creates Claude key for self

1. Settings → Create Claude / MCP key  
2. Template default `mcp:ops_safe` (≤ owner scopes)  
3. `bound_user_id = self`, `created_by = self`  
4. Copy URL + key once  
5. Claude `capabilities` → full cloud-safe action list  

### 7.2 Owner creates key for a store manager

1. Pick member (bound_user)  
2. Template default **min(member package, mcp:store)** — cannot pick owner package  
3. Manager only sees store-aligned tools in Claude  

### 7.3 Demote or remove member

1. Role → viewer or remove membership  
2. Bound keys: re-cap or deactivate  
3. Manager’s Claude immediately loses drafts / store write  

### 7.4 Revoke compromised key

1. Owner opens Settings → API keys → Revoke  
2. All MCP traffic for that prefix fails auth  

---

## 8. Implementation plan (phased)

### A2.0 — Design sign-off (this doc)

- [ ] Agree role ↔ MCP template matrix  
- [ ] Agree cap rule: `key ∩ bound_user ∩ cloud_ceiling`  
- [ ] Agree revoke = soft + `api:write`  

### A2.1 — Single resolver for “effective scopes”

- [ ] `resolveEffectiveScopes({ kind: 'user'|'key', ... })` in `server/utils/scopeAuth.ts`  
- [ ] Expand packages via `SCOPE_PACKAGES` + `mcp:*` templates  
- [ ] Map permission_schemas JSON → scopes (already `permissionsMapToScopes`)  
- [ ] Unit tests: viewer cannot get store_ops:write on key even if key row says so  

### A2.2 — API keys UX + schema

- [ ] Migration: `bound_user_id`, `key_kind`, `max_package`, `revoked_at/by`  
- [ ] Settings: create key wizard (template + bind user); revoke button  
- [ ] Enforce creator must have `api:write`; scopes requested ⊆ creator scopes  

### A2.3 — MCP + Catalog AI gate

- [ ] `authenticateRemoteMcp` uses `resolveEffectiveScopes` (not raw key array only)  
- [ ] `capabilities` returns actor + web_equivalent  
- [ ] Catalog AI tool list filtered by session scopes  
- [ ] Align Settings `MCP_SAFE_SCOPES` with server `MCP_SCOPE_PROFILES.safe`  

### A2.4 — Member lifecycle

- [ ] On role change / remove: re-cap or revoke bound keys  
- [ ] Audit events: `api_key.created`, `api_key.revoked`, `api_key.recapped`  

### A2.5 — Optional later

- [ ] R2 OAuth: consent screen lists scopes = same packages  
- [ ] Per-user personal access tokens (same cap rules)  
- [ ] Empty key scopes **≠ full** (breaking change; migrate existing keys)  

---

## 9. Mapping table: permission_schema area → MCP tools

| Schema area.action | MCP tools (representative) |
|--------------------|----------------------------|
| products.read | catalog_*, product get/search |
| products.export | catalog_export_csv |
| inventory.read | inventory_ats, product_inventory_status |
| store_ops.read | store_ops_list_*, ops_snapshot, recommend |
| store_ops.write | store_ops_create_draft_request |
| store_ops.approve | *(UI only / full local MCP)* |
| store_ops.execute_3pl | *(UI only / full local MCP)* |
| actions.write / submit | po_create_draft, clone, pipeline_propose |
| actions.approve | po_decide *(not cloud)* |
| intel.read | market_*, bi_list_*, bi_export_* |
| intel.write | bi_upsert_seed, bi_run_seed_now *(not cloud)* |
| assistant.use | Catalog AI chat |
| api.write | Settings key management *(web)* |
| help (implicit) | help_resolve/get/list |

---

## 10. Non-goals (this design)

- Giving MCP power **above** web for convenience  
- Cloud approve / Loft execute via Claude  
- Replacing RLS with scopes only (scopes gate API/MCP; RLS stays for tables)  
- Full ABAC (brand-level ACLs)  

---

## 11. Decision checklist (sign-off)

| # | Decision | Proposal |
|---|----------|----------|
| D1 | Cap keys by bound user? | **Yes** — default bind to creator; optional bind to another member ≤ creator |
| D2 | Viewer MCP? | **Yes** — read-only template |
| D3 | Can member create MCP keys? | **No** — only `api:write` (owner/admin) unless schema grants api:write |
| D4 | Soft revoke vs delete? | **Soft revoke** preferred; delete optional for cleanup |
| D5 | Catalog AI same as web? | **Yes** — session scopes filter tools |
| D6 | Empty API key scopes? | **Stop meaning full**; treat as deny or force package migration |

---

## 12. Recommended build order after sign-off

1. A2.1 resolver + tests (no UI)  
2. A2.2 key fields + Settings revoke/bind  
3. A2.3 wire MCP auth + Catalog AI filter  
4. A2.4 lifecycle hooks  

**Fast path already live:** `capabilities` → `key_permissions` for whatever scopes the key currently has. A2 makes those scopes **honestly equal to web login**.
