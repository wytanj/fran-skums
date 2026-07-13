# Fran SKUMS — TODO (implementation queue)

**Date:** 2026-07-13  
**Shipped on `main`:** **M0–M6** — MCP-ready Actions (M0–M4), import/POS draft safety (**M5**), catalog Q&A + agent context unify (**M6**)  
**DB (local SUPABASE_DB_URL):** migrations **001–052 applied** (052 audit channels ✅).  
**Parked:** Live Shopee scrape / Browserbase / brand radar  
**Production:** https://fran-skums.vercel.app  
**Plans:** This file · `docs/Commit Summary 13072026.md` · `mcp/README.md` · `Major Update.md`

---

## Start here next

**M0–M6 shipped.** Catalog AI drawer + MCP `catalog_*` can answer questions on large imports (exact totals). Next product track:

| Priority | Track | First tasks |
|----------|--------|-------------|
| **A (recommended)** | **Phase N** — stakeholder notifications | N1 schema: `notification_policies` + `notification_deliveries`; wire `po.submitted` → in_app (then Slack/email) |
| **B** | **M6.5** — audit explorer | Actions subtab: filter audit by channel / tool / entity |
| **C (parked)** | Scrape / brand radar | Only after Linux + Browserbase smoke; not blocking product |

### Quick smoke (catalog + MCP)

```bash
npm run db:migrate:status    # expect 052 applied
npm run dev                  # Catalog AI drawer: "How many products?"
npm run mcp                  # stderr: scopes=safe; tools include catalog_stats
node --test tests/m5-pos-consistency.test.mjs tests/m6-catalog-agent.test.mjs
# In app: Catalog AI → census questions; product page → Activate for POS
# MCP: catalog_stats / catalog_search / catalog_get
```

### Ops leftovers (5–15 min)

- [ ] Confirm **Vercel production Supabase** also has **052** (if different project from local migrate)
- [ ] Confirm production has **XAI_API_KEY** (assistant chat + MCP briefs)
- [ ] Optional: `FRAN_MCP_ACTOR_USER_ID=<profiles.id>` in `.env` for human attribution on MCP audits
- [ ] Secret rotation / Vercel env audit (service role, cron secrets) — hygiene
- [ ] Note: **015_organizations.sql** still `checksum-mismatch` on local runner (pre-existing; do not re-apply blindly)

---

## North star (current product)

**Goal:** Agents propose work in chat (e.g. clone PO, drop brands); humans see **DRAFT** in Actions; submit/approve only with privilege; audit shows **ui vs mcp**.

**Success (v1 — largely met):** Clone → draft + deep link → Actions UI → role-gated approve; `audit_events.source_type` distinguishes channels.

---

## Migrations (local)

| Status | Notes |
|--------|--------|
| **052 applied** | `audit_source_channels` — ui/mcp/api/… on `audit_events` |
| **No pending** | `npm run db:migrate` reports only 015 checksum-mismatch (historical file drift) |
| **Next SQL** | None for M0–M4; Phase **N1** will add notification tables when started |

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
- [ ] M6.5 Audit explorer UI (nice-to-have): filter by channel / tool / entity

### Phase M6.5 — Audit explorer UI (deferred)

- [ ] Page or Actions subtab: filter by channel, entity_type, tool_name, actor
- [ ] Link from any entity → filtered audit trail

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
- [ ] Pipeline execute in UI vs full-MCP only (still MCP full for execute)  
- [ ] Optional later: unify `pipeline_candidates` + `agent_proposals`  
- [ ] Phase N: email provider choice (Resend / SES / Postmark)

---

## Suggested build order

```text
M0–M4 + M3.5     ✅ shipped (main)
DB 052           ✅ local applied; verify prod if needed
─────────────────
Next pick:
  N1  notification_policies + deliveries schema
  N2  po.submitted / po.approved → in_app (+ Slack)
  N3  email templates + deep links
  or M6.5 audit explorer
─────────────────
Parked: Browserbase smoke, brand radar, scrape scale
```

**Recommended next:** **N1** (notifications).  
**Catalog Q&A now:** in-app **Catalog AI** drawer, or MCP `catalog_stats` / `catalog_search` / `catalog_get`.

---

## Already done (don’t redo)

| Area | Delivered |
|------|-----------|
| MI 0–5 | Seeds, jobs, study, MCP, internal PO machine, projections |
| MCP M0–M4 | Safe scopes, audit channels, clone tools, Actions UI, roles |
| M5 | Import draft/POS-off; pipeline draft products; Activate for POS UI |
| M6 | Shared `core/catalog`; Catalog AI + MCP `catalog_*`; page context; study match pool |
| Import | Dirty multi-provider + large-job progress |
| Collect research | Browserbase adapter; live scrape **KIV** |
| Ops | Workspace, MCP id, migrations through **052** (local) |

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
- MCP: `mcp/README.md`  
- Platform: `Major Update.md`  
- Commit: `docs/Commit Summary 12072026.md`  
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
