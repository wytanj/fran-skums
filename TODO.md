# Fran SKUMS — TODO (implementation queue)

**Date:** 2026-07-12  
**Active focus:** **MCP-ready SKUMS** — draft-first mutations, Approvals UI, audit (manual vs MCP)  
**Parked:** Live Shopee scrape / Browserbase / brand radar (until Linux + capacity)  
**Production:** https://fran-skums.vercel.app  
**Plans:** This file (ops queue) · `Major Update.md` (platform) · `mcp/README.md`

---

## North star (now)

**Goal:** Agents (Cursor/Claude via MCP) can propose work in natural language — e.g. *“copy previous PO but remove Anua and 3CE”* — and humans always see:

1. **What** was created (object + status chip: DRAFT / PENDING / …)  
2. **Who/how** (UI vs MCP vs API) with tool name when relevant  
3. **No silent production mutation** without explicit submit / approve / execute  

**Success:** Clone-PO story ends in a **visible draft** internal PO; submit/approve only with clear privilege or UI click; audit log can answer “manual or MCP?”

---

## Implement next (ordered)

### Phase M0 — Prep (hours) ✅

- [x] Lock **recommended MCP scope profiles** in `mcp/README.md` + `mcp/src/context.mjs`:
  - **safe (default):** `intel:read`, `study:write`, `pipeline:propose`, `po:draft`, `projection:run`  
    — **no** `po:submit`, `po:decide`, `pipeline:decide`, `pipeline:execute`, `intel:write`
  - **full (ops):** `FRAN_MCP_PROFILE=full` / `FRAN_MCP_SCOPES=full` / `*`
- [x] Empty scopes no longer mean “all” — default **safe**
- [x] Startup logs profile + client; helpers `getMcpClientName` / `getMcpActorUserId`
- [x] `.env.example` + local `.env` set to safe + `FRAN_MCP_CLIENT=cursor`
- [x] Tests: `tests/mcp-scopes.test.mjs`
- [ ] Optional: set `FRAN_MCP_ACTOR_USER_ID` to your `profiles.id` when ready for M1 audit

---

### Phase M1 — Audit: manual vs MCP (foundation) ✅

**Why first:** Without this, drafts exist but you can’t prove origin.

- [x] **Migration 052:** extend `audit_events.source_type` with  
  `ui | mcp | assistant | cron | worker` (+ index)
- [x] **Helper** `core/audit/record.mjs` + `server/utils/audit.ts`  
  `recordAudit` / `auditMcpMutation` / `mutationEnvelope`
- [x] **MCP:** mutating tools audit with `channel: mcp`, `tool_name`, `request_id`, client/actor
- [x] **UI:** product create/update → `source_type=ui` + `actor_user_id`  
- [x] **API:** product create + internal PO create → `source_type=api`
- [x] Mutation responses include envelope: `object_type`, `id`, `status`, `is_draft`, `channel`, `next_allowed_actions`
- [x] Tests: `tests/audit-record.test.mjs`
- [ ] **You:** apply `core/db/052_audit_source_channels.sql` on Supabase if not auto-migrated
- [ ] (Later polish) DB trigger reads `current_setting('skums.channel')` when set

**Done when:** `select source_type, metadata from audit_events where entity_id = $po` shows `mcp` vs `ui` vs `api`.

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

### Phase M5 — Consistency (import / catalog / POS)

- [ ] Import: prefer draft products or pending approval (stop demo auto-active + POS-on for wholesale dumps)
- [ ] Pipeline `catalog_product` execute stays **product.status=draft**; UI “Activate for POS”
- [ ] Confirm POS catalog never lists drafts / non-`pos_enabled`
- [ ] Optional row columns: `created_channel`, `updated_channel` on hot tables for list badges without join

---

### Phase M6 — Audit explorer UI (nice-to-have after M3)

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
| POS safe | Agent products stay draft / non-POS until promoted |

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

## Architecture decisions to lock while implementing

- [ ] Default MCP install = **safe** scopes  
- [ ] Accept ≠ execute (keep two steps on pipeline)  
- [ ] Internal PO vs inventory PO: separate UI labels; merge later only if product requires  
- [ ] Who may `po:decide` / `pipeline:execute` (recommend owner/admin only)  
- [ ] Optional later: unify `pipeline_candidates` + `agent_proposals` into one Actions spine  

---

## Suggested build order (strict)

```text
M0  Scope profiles                           ✅
M1  Audit channels                           ✅ (apply migration 052 on DB if needed)
M2  PO clone / preview tools                 ✅
M3  Actions UI                               ✅
M3.5 UI polish                               ✅
M4  Roles + agent prompt                     ✅
N1–N3 Stakeholder notifs                     ← next product track
M5  Import/catalog/POS draft consistency
M6  Audit explorer (optional)
── scrape / brand radar still parked ──
```

**Next:** Phase N (notifs) or M5 (import consistency), or ship/commit current work.

---

## Already done (don’t redo)

| Area | Delivered |
|------|-----------|
| MI 0–5 | Seeds, jobs, Shopee parse, metrics, study, MCP tools, internal PO status machine, projections |
| Collect research | Browserbase adapter + smoke; local captcha paths documented; **live collect KIV** |
| Import | Dirty multi-provider pipeline + large-job progress UI |
| Ops | Workspace, MCP workspace id, mock smoke, migration 051 |
| PO server rules | Update/add lines only when `status=draft`; submit → pending_approval |
| Pipeline | proposed → accepted → execute; catalog product defaults **draft** |
| Audit table | `audit_events` exists — needs channel attribution (M1) |

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
