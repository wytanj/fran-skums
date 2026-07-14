# Fran SKUMS — TODO (implementation queue)

**Date:** 2026-07-14  
**Shipped on `main`:** **M0–M6**, Help Center, **Phase R1** remote MCP, **Loft/3PL Phases P–D** (see `TODO-LOFT.md`)  
**DB:** migrations **001–057** on shared Supabase (055–057 Loft permissions/waves/inbound; apply pending with `node scripts/migrate.mjs --from 055` if a host lags).  
**Held:** **R2 OAuth** (remote MCP stays API-key until org permissioning is solid)  
**Parked:** Live Shopee scrape / Browserbase / brand radar  
**Production:** https://fran-skums.vercel.app  
**Plans:** This file · **`TODO-LOFT.md`** · `docs/ORG_PERMISSION_SCOPES.md` · `docs/LOFT_OPS_DICTIONARY.md` · `mcp/README.md`

---

## Start here next

**Loft logistics MVP (P→D) is implemented and pushed** — KR/HK ASN → Loft stock → Mon/Thu waves / lift → store receive + exception verify.  
**R1 remote MCP** remains available; **R2 OAuth held**.

| Priority | Track | First tasks |
|----------|--------|-------------|
| **A (recommended)** | **Loft Phase E–F** | Floor hygiene (adjustments/counts); store delivery calendars / wave polish — see `TODO-LOFT.md` |
| **B** | **Phase N** — stakeholder notifications | Wire store-ops inbox + email; N1 schema if not using `store_ops_notifications` alone |
| **C** | **Phase P remaining** | Enforce `requireScope` on all legacy routes; empty API keys ≠ full; app install grants UI |
| **D** | **Phase R** | R1 pilot with Claude keys; **R2 OAuth held** |
| **E** | **M6.5** — audit explorer | Filter mcp / store_ops channels |
| **F (parked)** | Scrape / brand radar | Linux + Browserbase smoke |

### Quick smoke

```bash
npm run db:migrate:status    # expect 055–057 applied (use --from 055 if needed)
npm run dev                  # /store-ops · Settings → Claude/MCP
# Remote: POST https://fran-skums.vercel.app/mcp  Authorization: Bearer sk_live_…
node --test tests/scopes-loft.test.mjs tests/store-ops-phase-b.test.mjs tests/store-ops-phase-c.test.mjs tests/inbound-phase-d.test.mjs
```

### Ops leftovers (5–15 min)

- [x] Help **053/054** on shared Supabase project
- [x] Production **XAI_API_KEY**
- [x] Loft **055–057** applied (shared project via `--from 055` / `--from 057`)
- [x] **Pushed** Loft P–D + POS request/receive to origin (Vercel deploy from git)
- [ ] Confirm Vercel production deploy green for latest `main`
- [ ] Fill Vercel **`SUPABASE_DB_URL`** (empty in prod env pull)
- [ ] Optional: `FRAN_MCP_ACTOR_USER_ID` for local MCP attribution
- [ ] Secret rotation / Vercel env audit
- [ ] Note: **015_organizations.sql** checksum-mismatch (historical; use `--from N` for new migrations)

---

## North star (current product)

**Goal (v1 — largely met):** Agents propose work; humans see **DRAFT** in Actions; submit/approve with privilege; audit shows **ui vs mcp**.

**Goal (v2 — cloud MCP):** Non-technical employees connect **Claude (or other remote-MCP clients)** to Fran SKUMS over **HTTPS**, ask catalog/analysis questions and create **drafts**, without local install. Service role never leaves the server. Privileged execute stays in Actions (or admin-only keys).

**Goal (v3 — Loft retail ops):** POS signals only; HQ decides with MCP baseline/lift; Loft executes warehouse; store receive + exception verify in SKUMS.

**Success (v1):** Clone → draft + deep link → Actions UI → role-gated approve.  
**Success (v2 pilot):** Employee pastes connector URL + safe API key (or OAuth later) → `catalog_stats` works in Claude → draft PO deep-links to Actions.  
**Success (v3 MVP):** ASN → LOFT-SG promote → Mon/Thu or lift order → store receive with short/damaged reported to HQ.

---

## Migrations (local)

| Status | Notes |
|--------|--------|
| **052–054 applied** | audit channels, help, connect-claude |
| **055–057 applied** | Loft permissions/topology; waves/inbox; inbound ASN |
| **015 checksum-mismatch** | Historical; do not re-apply blindly — use `node scripts/migrate.mjs --from 055` |
| **Next SQL** | Phase E cycle counts / N1 email deliveries if email bus lands |

---

## Completed (M0–M4) — do not redo

### Phase M0 — Prep ✅

### Phase M0 — Prep ✅

- [x] Safe/full MCP scope profiles; default **safe**
- [x] Startup logs; client/actor helpers
- [x] Tests: `tests/mcp-scopes.test.mjs`
- [ ] Optional: `FRAN_MCP_ACTOR_USER_ID` (attribution)

### Phase M1 — Audit ✅

- [x] Migration **052** applied (local)
- [x] `recordAudit` / MCP instrumentation / UI+API channels
- [x] Tests: `tests/audit-record.test.mjs`
- [ ] (Later) trigger GUC `skums.channel`
- [ ] Confirm 052 on **production** Supabase if different DB

---

### Phase M2 — MCP draft-first tools (clone PO story) ✅

**Why:** Agent must not invent multi-step unsafe writes.

- [x] `po_preview_clone` — read only keep/drop preview
- [x] `po_clone_as_draft` — always DRAFT + metadata + audit + deep_link
- [x] Tool descriptions hardened (DRAFT / PRIVILEGED)
- [x] `FRAN_MCP_MODE=safe` hard-blocks privileged scopes
- [x] `pipeline_preview_execute` dry-run
- [x] Lifecycle events on submit/decide/execute (`po.submitted`, `po.approved`, …)
- [x] Tests: `tests/po-clone.test.mjs` + mode=safe in mcp-scopes

**Done when:** Agent can preview + create draft IPO without submit; dropped brands visible in metadata.

---

### Phase M3 — Approvals / Actions UI (humans see drafts) ✅

**Why:** MCP objects are invisible in the app today.

- [x] Sidebar **Actions** → `/actions`
- [x] Inbox tabs: draft / pending / pipeline proposed / accepted / recent
- [x] Status + channel badges
- [x] Internal PO detail `/actions/internal-pos/:id` (submit, approve/reject, history, clone exclusions)
- [x] Pipeline detail `/actions/pipeline/:id` (accept/reject/defer)
- [x] Deep links from MCP clone/create
- [x] Lifecycle audit events from UI submit/decide (hooks for Phase N)
- [ ] Role-gate approve (M4)
- [ ] UI execute for pipeline (optional; MCP full-profile for now)

**Done when:** After MCP clone, user opens SKUMS → sees DRAFT + MCP badge without SQL.

---

### Phase M3.5 — UI polish (before M4) ✅

- [x] Channel badges from **audit_events** (mcp/ui/api), tool_name on cards
- [x] Actions counts strip + empty/loading copy; channel filter
- [x] Dashboard **Actions queue** (draft/pending decision POs)
- [x] Inventory PO tab note + link to Actions (warehouse vs decision PO)
- [x] Draft PO: edit notes + qty/unit cost; save draft
- [x] Copy deep link on PO + pipeline detail
- [x] Relative times; confirm text on status transitions

### Phase M4 — Roles, scopes, chat contract ✅

- [x] Role matrix (UI):
  - Member: view inbox, edit/submit draft  
  - Owner/admin: approve/reject PO + pipeline decide  
- [x] Enforce on Actions detail buttons + `useActions` throws if unauthorized
- [x] Refresh `memberRole` on workspace switch
- [x] Agent system-prompt blurb in `mcp/README.md` (safe clone flow)
- [ ] Optional: in-app Assistant read tools for draft inbox
- [ ] Attention item / email notifs → Phase N
- [ ] (Prep for N) stakeholder roles beyond owner/admin (finance, buyer)

**Done when:** Safe MCP profile + UI roles match the story; chat copy never implies committed.

---

### Phase N — Stakeholder notifications (plan now; build after M3–M4)

**Why document before M3:** Complex notifs (e.g. email finance when a decision PO needs approval, or “invoice / PO ready for next action”) must **not** be bolted onto random UI clicks. They hang off **lifecycle events + stakeholder graph + delivery adapters**.

#### N0 — Principles (lock these)

| Principle | Meaning |
|-----------|---------|
| **Notify on lifecycle, not on every field edit** | e.g. `draft → pending_approval`, not every `po_add_lines` |
| **Never auto-email on MCP draft create** | Draft = private workbench; email only after submit (or explicit “Request review”) |
| **Deep link or no email** | Every email CTA → Actions URL from M3 |
| **Idempotent delivery** | Same `(event_id, recipient, channel)` delivered once |
| **Channel pluggable** | In-app / email / Slack / webhook first; SMS later if ever |
| **Audit both ways** | “notification requested” + “notification delivered/failed” in `audit_events` or `notification_deliveries` |
| **No secrets in MCP agent** | Agent does not send email; system does after human/policy gate |

#### N1 — Domain model (schema sketch)

```text
notification_policies
  workspace_id
  event_type          -- e.g. po.submitted, po.approved, pipeline.accepted
  enabled
  channels[]          -- email, slack, in_app
  recipient_rules     -- jsonb: roles | user_ids | dynamic (po.created_by, workspace owners)
  template_key
  quiet_hours / throttle (optional)

notification_deliveries
  id, workspace_id
  event_type, entity_type, entity_id
  channel             -- email | slack | in_app | webhook
  recipient           -- email or user_id or webhook_url id
  status              -- pending | sent | failed | skipped
  provider_ref        -- Resend/SendGrid/Slack ts
  payload_snapshot    -- subject, body meta (no secrets)
  idempotency_key
  created_at, sent_at, error

workspace_notification_settings
  default_from / reply-to
  email_provider config ref
  slack_webhook (already partial on assistant settings)
```

Reuse where possible: `product_attention_items` for **in-app** queue; `audit_events` for provenance; existing Slack webhook on assistant settings as **v1 Slack channel**.

#### N2 — Event catalog (start small)

| Event | When | Default recipients (policy) | Channels v1 |
|-------|------|-----------------------------|-------------|
| `po.submitted` | draft → pending_approval | owners/admins + optional “finance” role | in_app + email |
| `po.approved` / `po.rejected` | decide | submitter + watchers | in_app + email |
| `pipeline.proposed` | MCP/agent propose | optional watchers | in_app only |
| `pipeline.accepted` | human/agent decide | execute owners | in_app |
| `pipeline.executed` | execute done | requester | in_app + email |
| `import.completed` / `import.failed` | large import job | uploader | in_app |
| Later: `invoice.*` / supplier docs | when invoice entity exists | AP stakeholders | email |

**Invoice note:** Today “invoice” may mean **internal/decision PO** or a future AP invoice object. Phase N should use **entity_type + event_type**, so when true invoices land, same bus works (`invoice.ready_for_payment`, etc.).

#### N3 — Delivery pipeline

```text
status transition (service)
  → write audit_events (already M1)
  → enqueue notification_outbox (or insert deliveries pending)
  → worker/cron: resolve policy → expand recipients → render template → send
  → update delivery status + audit
```

v1 can be **synchronous** for in_app + Slack; email should be **async** (queue) once volume > toy.

Providers (decide later, do not hardcode in M3):

- Email: Resend / Postmark / SES  
- Slack: existing workspace webhook pattern  
- Webhook: outbound to n8n/Zapier for weird stakeholder workflows  

#### N4 — Templates & UX

- Templates: subject + body with vars `{po_number}`, `{status}`, `{deep_link}`, `{actor}`, `{channel_created}`  
- Preferences: per-user mute / digest (daily) later  
- UI: on PO detail — “Notify approvers” button (manual trigger) + “Stakeholders” list  
- MCP: **no** `send_email` tool in safe mode; optional full-mode `notify_request_review` that only creates a `pending` delivery for policy engine  

#### N5 — Build order relative to M-phases

```text
M2  clone draft tools
M3  Actions UI + deep links + event names on transitions   ← enables N
M4  roles / who can approve                               ← recipient rules
N1  schema: policies + deliveries
N2  wire po.submitted / po.approved → in_app + Slack (email optional)
N3  email provider + templates for PO approval
N4  digests, mute, invoice events when AP exists
```

**Do not block M2/M3 on email.** Do **design M3/M4** so N is a thin layer on top.

#### N6 — Success criteria (notifications)

| Check | Pass |
|-------|------|
| Draft PO from MCP | **No** email storm |
| Human submits PO | Approvers get in_app (+ email when enabled) with **working deep link** |
| Duplicate submit retry | One delivery per idempotency key |
| Audit | Can see who was notified, channel, success/fail |
| Agent | Cannot bypass policy to mail arbitrary addresses in safe mode |

---

---

### Phase M5 — Consistency (import / catalog / POS) ✅

- [x] Import: prefer draft products (stop demo auto-active + POS-on for wholesale dumps)
- [x] Pipeline `catalog_product` execute stays **product.status=draft** + POS-off; UI “Activate for POS”
- [x] Confirm POS catalog never lists drafts / non-`pos_enabled` (default catalog)
- [ ] Optional row columns: `created_channel`, `updated_channel` on hot tables for list badges without join

---

### Phase M6 — Catalog Q&A + agent context unify ✅

**Why:** Demo-era in-app Assistant and MCP were separate stacks; 10k imports were invisible to both AI surfaces at scale.

- [x] Shared `core/catalog` (`catalogSearch` / `catalogStats` / `catalogGet` / match pool)
- [x] In-app tools: `get_catalog_stats`, improved `search_products`/`get_product`, `get_actions_queue`
- [x] Prompt: distinguish **Catalog Assistant** vs **MCP**; inject live catalog snapshot; never invent totals
- [x] MCP safe tools: `catalog_stats`, `catalog_search`, `catalog_get`
- [x] Page `setContext` on products / actions / import / expiry
- [x] Drawer UX rename + catalog question chips; Settings blurb
- [x] `study_match_catalog` uses token DB pool (not last 200 updated only)
- [x] Help Center: migration **053**, `/help` + `/help/:slug`, nav item, `resolve_help` / `list_help_articles`
- [ ] When shipping features: add/update rows in `help_articles` (upsert by slug in `053` seed or new migration)
- [ ] M6.5 Audit explorer UI (nice-to-have): filter by channel / tool / entity

### Phase M6.5 — Audit explorer UI (deferred; higher value after Phase R)

- [ ] Page or Actions subtab: filter by channel, entity_type, tool_name, actor
- [ ] Link from any entity → filtered audit trail
- [ ] Useful for cloud MCP: filter `source_type=mcp`, `client_name`, tool_name

---

### Phase R — Remote / cloud MCP (non-technical employees)

**Why:** Local stdio MCP requires Node, repo, and env. Staff who already pay for Claude need a **public HTTPS MCP** + auth bound to a workspace — not `FRAN_MCP_WORKSPACE_ID` + service role on a laptop.

**Contrast with shipped MCP v1 (M0–M4):**

| | Today (local) | Phase R (cloud) |
|--|---------------|-----------------|
| Transport | stdio | Streamable HTTP (HTTPS) |
| Who runs server | Developer machine | Fran cloud (Vercel first) |
| Auth | Service role + fixed workspace env | API key (R1) → OAuth (R2) |
| Employee setup | Impossible | URL + key or “Sign in with Fran” |
| Default power | Safe scopes | **Cloud-safe allowlist** (no submit/execute) |
| Tool code | `mcp/src/*` | **Reuse** handlers; new gateway only |

**Reuse:** `mcp/src/tools.mjs` handlers, `core/catalog`, scopes concept, `api_keys` + `requireApiKey`, `audit_events`, Actions for human approval.  
**Do not reuse for clients:** `SUPABASE_SERVICE_ROLE_KEY`, single global `FRAN_MCP_WORKSPACE_ID` in employee config.

#### R0 — Lock decisions (½ day)

- [ ] Default cloud profile = **safe only** (catalog read, help, BI/market read, study?, draft PO/pipeline propose, projections create — **no** po_submit / pipeline_execute / bi_run_seed_now)
- [ ] Hosting = **same Nuxt app on Vercel** for MVP (`/mcp` or `/api/mcp`); dedicated service only if timeouts bite
- [ ] Auth v1 = **workspace API keys** (existing `api_keys`); map scopes to MCP scopes
- [ ] Auth v2 = **OAuth 2.1** + SKUMS login (Claude connector UX)
- [ ] Keep local `npm run mcp` forever for engineers

#### R1 — Remote MCP MVP (pilot) ✅ implemented (pending deploy + human pilot)

- [x] Shared runtime: `runWithMcpRequestContext` ALS — workspace/scopes from API key
- [x] HTTP JSON-RPC MCP: `POST/GET /mcp`, `GET /mcp/tools`
- [x] Auth: Bearer / X-API-Key → `authenticateApiKey` → `resolveCloudMcpScopes`
- [x] Privileged tools filtered from cloud `tools/list` + blocked on call
- [x] Audit via existing MCP mutation path + client name from key / `x-mcp-client`
- [x] Settings: **Create Claude / MCP key** + copy snippet
- [x] Help: migration **054** `connect-claude`; tools `help_resolve` / `help_list`
- [x] Tests: `tests/remote-mcp.test.mjs`
- [ ] Deploy production + run **054** on Supabase
- [ ] Pilot: 2–3 non-engineers on Claude custom integration

**Done when:** Employee with only Claude + a safe key can ask “how many products?” and get exact totals; no local Node.

#### R2 — OAuth for non-technical default ⏸ HELD

**Hold until Phase P (org scopes) is designed/enforced** so OAuth consents grant the right scope packages.

- [ ] OAuth authorize + token endpoints (PKCE); consent screen (workspace + scopes)
- [ ] Claude connector uses OAuth instead of long-lived keys
- [ ] Revoke UI: connectors / tokens per user
- [ ] actor_user_id from token for audit

#### R3 — Hardening (after R2 or late R1 pilot)

- [ ] Rate limits per key/user
- [ ] Usage strip in Settings (tool call counts)
- [ ] Optional dedicated gateway if timeouts block study tools
- [ ] Document other remote-MCP clients as they support HTTPS MCP

**Explicit non-goals for R1:** live scrape, full privileged cloud keys for all staff, replacing Catalog AI or Actions UI.

---

### Phase P — Organization permission scopes (before full org workspace rollout)

**Why:** Org + workspace exist (`015`, `009`) but scopes are fragmented (role strings, half-used permission JSON, free-form API key scopes, separate MCP scopes, app `required_scopes` unused at install). Full multi-workspace org setup needs one catalog.

**Design doc:** [`docs/ORG_PERMISSION_SCOPES.md`](docs/ORG_PERMISSION_SCOPES.md)  
**Inspiration:** [Shopify access scopes](https://shopify.dev/docs/api/usage/access-scopes) — resource `read_*`/`write_*`, least privilege, apps declare required scopes at install.  
**Integrations = apps:** connectors (Shopify, Woo, 3PL, POS, MCP cloud) are `workspace_apps` with `required_scopes` / `granted_scopes`, not ad-hoc free access.

#### P0 — Freeze scope catalog (design only) ✅ draft

- [x] Inventory current layers (roles, permission_schemas, API keys, MCP, app platform)
- [x] Propose canonical `{resource}:{action}` catalog (org + workspace + apps)
- [x] Role packages (owner/admin/member/viewer + buyer/store/finance)
- [x] Example app required_scopes (shopify, pos-connector, mcp-cloud, …)
- [ ] **Sign-off** on decisions in doc §11 (empty key ≠ full, org passthrough rules, sensitive scopes)

#### P1 — Schema + types

- [ ] Expand global `permission_schemas` seeds (inventory, actions, pos, apps, assistant, intel, …)
- [ ] Align `PermissionArea` / `PermissionSet` in `app/types`
- [ ] Optional: `scope_definitions` table or codegen from catalog doc
- [ ] `workspace_apps.granted_scopes text[]` (if not present) + install check against `required_scopes`

#### P2 — Resolve + enforce

- [ ] `resolveScopes({ userId, workspaceId })` / `resolveScopesForApiKey(key)`
- [ ] Gate UI `can()` via scopes; Actions approve → `actions:approve`
- [ ] Gate `requireApiKey` against catalog; stop treating empty scopes as unlimited (migration path)
- [ ] Map MCP scopes as aliases into canonical set

#### P3 — Org workspace matrix

- [ ] Clarify org roles vs workspace membership (member only sees assigned workspaces)
- [ ] Org admin passthrough: UI admin only, never machine keys
- [ ] Invite flows: org invite + workspace invite + permission schema selection

**Done when:** Enabling Shopify (or MCP cloud) for a workspace requires explicit scope grant; a viewer cannot create API keys; a member cannot approve Actions without `actions:approve`.

---

## Definition of done (MCP-ready v1)

| Check | Pass |
|-------|------|
| Clone story | `po_preview_clone` + `po_clone_as_draft` → draft only |
| Visibility | Actions inbox shows DRAFT + MCP badge |
| No silent live mutate | Safe scopes/mode block submit/decide/execute |
| Attribution | `audit_events` distinguishes `ui` vs `mcp` (+ tool_name) |
| Escalate | Human (or full-scope) submit → approve → (pipeline) execute |
| POS safe | Agent/import products stay draft / non-POS until **Activate for POS** | ✅ M5 |

### Definition of done (MCP cloud pilot — Phase R1)

| Check | Pass |
|-------|------|
| Public URL | HTTPS MCP endpoint on production (or stable preview) |
| No laptop | Employee does not run `npm run mcp` |
| Auth | Valid API key required; invalid → 401 |
| Isolation | Key A cannot read workspace B |
| Safe only | Submit/decide/execute blocked on cloud path |
| Catalog Q&A | `catalog_stats` / `catalog_search` work in Claude |
| Handoff | Draft tools still return Actions deep links |
| Audit | Tool calls appear with `source_type=mcp` |

---

## Explicitly parked (do not start until MCP v1 done)

### Live scrape / Browserbase / brand radar

- [ ] Browserbase smoke on Linux (`BROWSERBASE_OS=linux`) → `LIVE_SMOKE_OK`  
- [ ] Seed pack `skincare_trend_v1`, brand rollup, weekly shortlist  
- [ ] Cron collect worker, Lazada clone  
- [ ] Local Puppeteer / cookie / profile as production (research only; captcha-walled)

See historical notes at end of this file if needed.

### Other backlog

- [ ] Phase 6 reconciliation (POS vs 3PL vs warehouse)  
- [ ] Intelligence BI charts UI  
- [ ] Server-side 59k import worker  
- [ ] Import LLM mapping / saved provider profiles  
- [ ] LOFT SOW commercial KIV  
- [ ] Secret rotation / Vercel env audit (still good hygiene anytime)

---

## Architecture decisions (status)

- [x] Default MCP install = **safe** scopes  
- [x] Accept ≠ execute (two steps)  
- [x] Internal PO (Actions) vs inventory PO (Inventory) — separate UI labels  
- [x] UI approve: owner/admin only; member can submit drafts  
- [x] Help Center in Supabase; assistant routes nav Qs to `/help/*`  
- [x] **Cloud MCP transport** = HTTPS JSON-RPC on `/mcp` (R1)  
- [x] **Cloud MCP auth v1** = workspace API keys + cloud-safe allowlist  
- [x] **Cloud MCP never exposes** service role to clients  
- [ ] **R2 OAuth** — held until Phase P scope packages exist for consent UI  
- [ ] **Canonical permission scopes** — see `docs/ORG_PERMISSION_SCOPES.md` (sign-off P0)  
- [ ] **Integrations as apps** — install grants `required_scopes` only  
- [ ] Empty API key scopes ≠ unlimited (breaking change; migrate carefully)  
- [ ] Pipeline execute in UI vs full-MCP only (still MCP full / local for execute)  
- [ ] Optional later: unify `pipeline_candidates` + `agent_proposals`  
- [ ] Phase N: email provider choice (Resend / SES / Postmark)

---

## Suggested build order

```text
M0–M6 + Help + R1   ✅ shipped (main)
DB 052–054          ✅ shared Supabase
Local stdio MCP     ✅ engineers
Remote /mcp + key   ✅ cloud-safe (R2 OAuth held)
─────────────────
Next (recommended):
  P0  sign-off scope catalog (docs/ORG_PERMISSION_SCOPES.md)
  P1  expand permission_schemas + types + app granted_scopes
  P2  resolveScopes + enforce UI/API
  P3  org ↔ workspace membership matrix
─────────────────
Then / parallel:
  R1 pilot (Claude keys) · N1–N3 notifications · M6.5 audit explorer
  R2 OAuth (after P)
─────────────────
Parked: Browserbase, brand radar
```

**Recommended next:** **Phase P0 sign-off** → **P1 schema**.  
**Cloud AI today:** Settings → Claude/MCP key → `https://…/mcp`.  
**Do not start R2** until scope packages are real enough to put on an OAuth consent screen.

---

## Already done (don’t redo)

| Area | Delivered |
|------|-----------|
| MI 0–5 | Seeds, jobs, study, MCP, internal PO machine, projections |
| MCP M0–M4 | Safe scopes, audit channels, clone tools, Actions UI, roles |
| M5 | Import draft/POS-off; pipeline draft products; Activate for POS UI |
| M6 | Shared `core/catalog`; Catalog AI + MCP `catalog_*`; Help Center **053** |
| R1 | Remote MCP `POST /mcp`, cloud-safe keys, Settings connector, help **054** |
| Local MCP | stdio `npm run mcp`; env workspace + service role |
| Import | Dirty multi-provider + large-job progress |
| Collect research | Browserbase adapter; live scrape **KIV** |
| Ops | Migrations through **054** |

---

## Quick commands

```bash
npm run workspace:id
npm run dev
npm run mcp

# After M1/M2: run MCP-related tests you add
node --test tests/import-pipeline.test.mjs tests/imports-api.test.mjs

# Parked live smoke (when Linux ready)
node scripts/_smoke_shopee_browserbase.mjs
```

## Links

- Production: https://fran-skums.vercel.app  
- Remote MCP: `https://fran-skums.vercel.app/mcp` · Help: `/help/connect-claude`  
- Org scopes design: `docs/ORG_PERMISSION_SCOPES.md`  
- MCP: `mcp/README.md`  
- Platform: `Major Update.md`  
- Marketplace (parked): `marketplace/README.md`  

---

## Appendix — brand approach radar (parked reference)

**Goal (later):** Monday shortlist of rising K-beauty / skincare brands from sparse Shopee SERP sampling.

| Build (when unparked) | Notes |
|------------------------|--------|
| Seed pack `skincare_trend_v1` | ~30 keywords × SG+PH; mock first |
| Brand extract + rollup | SERP share, sold growth, mall mix, multi-market echo |
| Leaderboard API + MCP + digest | Approach / watch / ignore |
| Browserbase production collect | After Linux smoke green |

**Not required for MCP-ready v1.**
