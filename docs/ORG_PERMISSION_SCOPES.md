# Fran SKUMS — Organization & workspace permission scopes

**Status:** Design (pre-implementation)  
**Date:** 2026-07-13  
**Goal:** Define a single scope vocabulary for **humans (UI)**, **API keys**, **remote MCP**, and **apps/integrations** before expanding multi-workspace org setup.

Inspired by [Shopify access scopes](https://shopify.dev/docs/api/usage/access-scopes): resource-oriented `read_*` / `write_*` (and occasional finer actions), least privilege, and apps that **declare required scopes** at install.

---

## 1. What exists today (fragmented)

| Layer | Model | Gaps |
|-------|--------|------|
| **Workspace roles** | `owner` \| `admin` \| `member` \| `viewer` on `workspace_members` | Coarse; RLS mostly role-based, not granular JSON |
| **Org roles** | `owner` \| `admin` \| `member` \| `billing` on `organization_members` | No product/inventory scopes; org admin ⇒ all workspaces |
| **Permission schemas (009)** | JSON areas: products, brands, categories, integrations, credentials, schemas, custom_fields, team, workspace, activity, api | Seeded but **not enforced** on most API routes; types already list inventory/expiry/assistant/organization as areas without full seed |
| **API keys** | Free-form `scopes text[]` (e.g. `products:read`, `pos:write`, empty = full) | Inconsistent naming; not tied to permission schemas |
| **MCP (local + cloud)** | `intel:read`, `study:write`, `pipeline:*`, `po:*`, `projection:run` | Parallel namespace; cloud-safe fixed allowlist |
| **App platform (037)** | `app_definitions.required_scopes`, `workspace_apps` | Apps declare scopes but install doesn’t grant/check a unified ACL |
| **UI enforcement** | `useTeam().can(area, action)` + ad-hoc role checks (Actions approve = owner/admin) | Uneven coverage |

**Principle for the next phase:** one **canonical scope string catalog**. Roles and permission schemas **resolve to sets of scopes**. API keys, MCP, and apps **request/hold subsets** of that catalog.

---

## 2. Design principles (Shopify-inspired)

1. **Resource + verb** — Prefer `read_products` / `write_products` style (we keep colon form for continuity: `products:read` / `products:write`).
2. **Least privilege** — Apps and keys request only what they need; empty scopes must **not** mean god-mode forever (migrate to explicit full packages).
3. **Apps declare scopes** — Each connector (Shopify, Woo, WorldSyntech, MCP connector, POS) has `required_scopes[]` + optional `optional_scopes[]` (like Shopify app install).
4. **Separate actor kinds**
   - **User session** (UI) — org role × workspace role × permission schema
   - **Machine** (API key / MCP) — key scopes only, no implicit org-admin passthrough
   - **App install** — scopes granted at enable-time on `workspace_apps`
5. **Privileged / sensitive** — approve, credentials, billing, MCP execute: explicit scopes + often role gate
6. **Integrations = apps** — Shopify connection is not a free-floating “integration row”; it is a **workspace app** with capability + scopes

---

## 3. Hierarchy: Org → Workspace → App

```text
Organization
  roles: org_owner | org_admin | org_member | org_billing
  scopes (org-level only): organization:*, billing:*, workspaces:create, workspaces:list
        │
        ├── Workspace A  (member roles + permission schema → workspace scopes)
        │     ├── Core “apps” (always on): catalog, inventory, actions, …
        │     ├── Enabled apps: shopify, woocommerce, worldsyntech-ofs, pos-connector, mcp-cloud
        │     └── API keys / MCP tokens (subset of workspace + app scopes)
        └── Workspace B  …
```

**Org admin passthrough (today):** org owner/admin see all workspaces.  
**Target:** keep passthrough for **admin surfaces**, but **data-plane API keys** never inherit org-admin; they must be workspace-scoped keys.

---

## 4. Canonical scope catalog (proposed)

Format: `{resource}:{action}`  
Actions: `read` | `write` | `delete` | `import` | `export` | `execute` | `approve` | `invite` | `manage` | `admin`

### 4.1 Organization (org-level only)

| Scope | Meaning |
|-------|---------|
| `organization:read` | View org profile, members list |
| `organization:write` | Edit org name, logo, settings |
| `organization:billing` | Billing email, plan (future) |
| `organization:members` | Invite/remove org members, change org roles |
| `workspaces:list` | List workspaces in org |
| `workspaces:create` | Create workspace under org |
| `workspaces:delete` | Delete / archive workspace |

### 4.2 Workspace core

| Scope | Meaning |
|-------|---------|
| `workspace:read` | View workspace settings |
| `workspace:write` | Edit workspace settings |
| `workspace:admin` | Danger zone (delete, transfer) |
| `team:read` | List members / invites |
| `team:invite` | Invite users |
| `team:remove` | Remove members |
| `team:roles` | Change roles / assign permission schemas |
| `activity:read` | Activity / audit trail (non-sensitive) |
| `audit:read` | Full audit explorer (MCP/UI channels) |
| `api:read` | List API keys (prefixes only) |
| `api:write` | Create/revoke API keys |

### 4.3 Catalog (products domain)

| Scope | Meaning | Shopify analogue |
|-------|---------|------------------|
| `products:read` | List/get products | `read_products` |
| `products:write` | Create/update products | `write_products` |
| `products:delete` | Delete products | (write + delete policy) |
| `products:import` | Bulk import jobs | — |
| `products:export` | Export CSV | — |
| `products:pos_activate` | Activate for POS / pos_enabled | — |
| `brands:read` / `brands:write` / `brands:delete` | Brands | collections-ish |
| `categories:read` / `categories:write` / `categories:delete` | Categories | collections |
| `schemas:read` / `schemas:write` | Product schemas | metaobject definitions |
| `images:read` / `images:write` | Product images | `read_files` / `write_files` |
| `listings:read` / `listings:write` | Channel listings | product + channel |

### 4.4 Inventory & ops

| Scope | Meaning | Shopify analogue |
|-------|---------|------------------|
| `inventory:read` | Levels, ATS views | `read_inventory` |
| `inventory:write` | Adjustments, reservations | `write_inventory` |
| `inventory:po` | Warehouse inventory POs | draft/order-ish |
| `locations:read` / `locations:write` | Locations | `read_locations` |
| `expiry:read` / `expiry:write` | Expiry batches / LIFO | — |
| `store_ops:read` / `store_ops:write` | View ops; submit requests / receive reports (signals only) | FulfillmentOrder-ish |
| `store_ops:approve` | HQ approve / reject / defer-to-Mon–Thu wave | — |
| `store_ops:verify` | HQ verify receipt exceptions | — |
| `store_ops:execute_3pl` | Send/cancel Loft orders; mutating OFS jobs | — |
| `store_ops:inbound` | KR/HK ASN lifecycle + promote Loft stock | — |
| `inventory:override_expiry` | Override near-expiry gate on outbound | — |
| `forecasting:read` / `forecasting:write` | Forecasts | `read_reports` (partial) |

**Loft note (2026-07-14):** Seeded in migration `055`; packages in `server/utils/scopes.ts`; plan in `TODO-LOFT.md`.

### 4.5 Actions / decision layer (agent handoff)

| Scope | Meaning |
|-------|---------|
| `actions:read` | View Actions inbox (draft/pending POs, pipeline) |
| `actions:submit` | Submit draft internal PO for approval |
| `actions:approve` | Approve/reject PO or pipeline decide |
| `pipeline:read` | List pipeline candidates |
| `pipeline:propose` | Create candidates (MCP/agent) |
| `pipeline:execute` | Execute accepted candidate (**privileged**) |

### 4.6 POS & commerce

| Scope | Meaning | Shopify analogue |
|-------|---------|------------------|
| `pos:read` | POS catalog, scan | product + inventory read |
| `pos:write` | Sales, inventory events | orders write-ish |
| `pos:config` | Registers, locations config | locations |

### 4.7 Intelligence / marketplace / study

| Scope | Meaning |
|-------|---------|
| `intel:read` | Market warehouse, metrics, digests, catalog MCP read |
| `intel:write` | Seeds, cadence, run collect (**privileged**) |
| `study:write` | Create study sessions / briefs |
| `projection:run` | Financial projections |

### 4.8 Agents / assistant / MCP

| Scope | Meaning |
|-------|---------|
| `assistant:use` | In-app Catalog AI |
| `assistant:admin` | Assistant settings, Slack webhook |
| `mcp:safe` | Package: cloud-safe MCP (maps to allowlisted tools) |
| `mcp:full` | Package: local/ops MCP including privileged (**restricted**) |
| `agents:read` / `agents:write` | Agent proposals, attention items |

### 4.9 Apps platform & integrations

| Scope | Meaning |
|-------|---------|
| `apps:read` | List app definitions / workspace apps |
| `apps:write` | Enable/disable apps, edit app config |
| `apps:install` | Install connector apps (grant their required_scopes) |
| `credentials:read` / `credentials:write` | Secrets for connectors (**sensitive**) |
| `integrations:read` | List connections |
| `integrations:write` | Create/update connections |
| `integrations:execute` | Run sync/pull jobs |
| `events:read` | Domain events stream |

### 4.10 Help / docs

| Scope | Meaning |
|-------|---------|
| `help:read` | Help articles (usually all authenticated users) |

---

## 5. Scope packages (role defaults)

Map legacy roles → packages (not exclusive; custom schemas override).

| Role | Package | Includes (summary) |
|------|---------|-------------------|
| **Org owner** | `pkg:org_owner` | All org scopes + all workspace admin on all workspaces |
| **Org admin** | `pkg:org_admin` | Org members/workspaces; all workspace admin except org billing/delete |
| **Org member** | `pkg:org_member` | Org read + only workspaces where also workspace_member |
| **Org billing** | `pkg:org_billing` | `organization:read`, `organization:billing` only |
| **WS owner** | `pkg:ws_owner` | All workspace scopes including `workspace:admin`, `mcp:full` eligible, credentials |
| **WS admin** | `pkg:ws_admin` | Most write + team + api + apps; no workspace delete |
| **WS member** | `pkg:ws_member` | products/inventory write, import, actions:submit, assistant:use, mcp:safe, no credentials, no approve |
| **WS viewer** | `pkg:ws_viewer` | All `*:read` + export optional; no write/approve/api keys |
| **Buyer** *(new optional schema)* | `pkg:buyer` | products:read, intel:read, actions:*, pipeline:propose, po via actions, projection:run |
| **Store associate** *(new)* | `pkg:store` | pos:*, inventory:read, store_ops:*, products:read, no catalog admin |
| **Finance** *(new)* | `pkg:finance` | actions:approve, projection:*, inventory:read, products:read, audit:read |

---

## 6. Integrations as apps (Shopify-style install)

### Model

```text
app_definitions
  app_key: shopify | woocommerce | worldsyntech-ofs | pos-connector | mcp-cloud | catalog-ai
  app_type: connector | first_party | agent | …
  required_scopes: text[]     -- e.g. ['products:read','products:write','inventory:read']
  optional_scopes: text[]     -- future
  provided_capabilities: …
  consumed_capabilities: …

workspace_apps
  status: configuring | enabled | …
  granted_scopes: text[]      -- intersection of required + admin-approved optional
  config / credentials ref
```

### Example required scopes per app

| App key | required_scopes (proposed) |
|---------|----------------------------|
| `core-catalog` | products:\*, brands:\*, categories:\* (core always on) |
| `core-inventory` | inventory:\*, locations:\* |
| `core-actions` | actions:\*, pipeline:read |
| `shopify` | products:read, products:write, inventory:read, inventory:write, listings:write, integrations:execute |
| `woocommerce` | same family as shopify |
| `worldsyntech_ofs` | inventory:read/write, store_ops:read/write/execute_3pl/inbound, integrations:execute, locations:read, products:read (installer needs credentials:write + apps:install) |
| `pos` / `pos_connector` | pos:read/write, store_ops:read/write, products:read — **no** approve/verify/execute_3pl |
| `mcp-cloud` | mcp:safe (= catalog + help + draft packages) |
| `catalog-ai` | assistant:use, products:read, inventory:read, actions:read, help:read |
| `marketplace-intel` | intel:read, study:write (write seeds = intel:write admin) |

**Install flow (target):** Admin enables app → system checks user has `apps:install` + all `required_scopes` → store `granted_scopes` on `workspace_apps` → connection credentials stored separately under `credentials:*`.

---

## 7. MCP / API key mapping

| Token type | Max scopes |
|------------|------------|
| Claude / MCP connector key | `mcp:safe` package only (R1 already enforces) |
| POS connector key | `pos:read`, `pos:write` |
| Integration worker key | app’s `granted_scopes` only |
| Dev local MCP (`FRAN_MCP_PROFILE=full`) | env override; not for staff |

**A2 (2026-07-15):** Web login and MCP must not diverge — see **`docs/MCP_USER_PERMISSION_DESIGN.md`**.  
Effective key scopes = `key scopes ∩ bound_user (or creator) web scopes ∩ cloud ceiling`.  
Workspace owner/admin (`api:write`) creates and **revokes** keys. Catalog AI uses the same user scope resolver.

**Unify strings over time:**

| Today MCP | Canonical |
|-----------|-----------|
| `intel:read` | keep (or alias `marketplace:read`) |
| `po:draft` | map UI to `actions:*` + internal PO write; keep MCP name as alias |
| `pipeline:propose` | keep |

---

## 8. Enforcement roadmap (after catalog freeze)

1. **P0 — Catalog freeze** — This doc + seed expansion of `permission_schemas` JSON + TypeScript `PermissionArea` alignment.  
2. **P1 — Resolve helper** — `resolveScopes({ userId, workspaceId })` and `resolveScopesForApiKey(key)` return `Set<string>`.  
3. **P2 — Gate UI** — `can('products','write')` implemented via scopes; Actions approve requires `actions:approve`.  
4. **P3 — Gate API** — `requireApiKey(event, 'products:read')` validated against catalog; reject empty=full.  
5. **P4 — Apps install** — connectors must declare + grant scopes; Shopify-style least privilege.  
6. **P5 — Org workspace matrix** — org roles + per-workspace membership + optional “workspace groups”.

---

## 9. Gaps vs current seeds (must add to permission_schemas)

Missing from 009 seeds but present in product:

- inventory, expiry, forecasting, store_ops  
- actions / pipeline / internal PO  
- pos  
- assistant, mcp packages  
- apps, events, audit  
- organization  
- listings, images, projections, intel/study  

---

## 10. Non-goals (this design phase)

- Implementing full RLS rewrite  
- Billing SKUs  
- R2 OAuth (held)  
- Per-row ABAC (brand-level ACLs) — later if needed  

---

## 11. Decision checklist (for sign-off)

- [ ] Adopt `{resource}:{action}` as sole public scope string format  
- [ ] Empty API key scopes → **deny** or **viewer package** (not full) after migration  
- [ ] Org admin passthrough stays for UI; **never** for machine keys  
- [ ] Integrations ship only as `workspace_apps` with `required_scopes`  
- [ ] Sensitive: `credentials:*`, `actions:approve`, `pipeline:execute`, `mcp:full`, `intel:write`  
- [ ] New role schemas: buyer, store associate, finance (optional packages)
