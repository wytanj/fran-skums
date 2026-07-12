# Fran SKUMS — TODO (review queue)

**Date:** 2026-07-11  
**Context:** Marketplace intelligence phases **0–5** are implemented, committed (`3aad5bd`), and deployed to Vercel (`https://fran-skums.vercel.app`).  
**Plan of record:** `Major Update.md`

Use this list for tomorrow’s pass. Check boxes as you go.

---

## 0. Do first (unblocks everything else)

- [x] **Create a Fran workspace** (DB currently had zero workspaces at last check)
  1. `npm run dev` → sign up / log in
  2. Complete **onboarding** (creates workspace via `create_workspace`)
  3. `npm run workspace:id` (or `node scripts/print-workspace-id.mjs`)
  4. Add to `.env`: `FRAN_MCP_WORKSPACE_ID=<uuid>`
  - Workspace: `c21c057f-ea01-4e19-bc79-fafcf2626b19` (set in `.env` 2026-07-11)
  - Also fixed `create_workspace` overload ambiguity (migration **051**)
- [ ] **Rotate secrets** that were pasted in chat (if not already)
  - Supabase **service role** key
  - Confirm `.env` is never committed (still gitignored)
- [ ] **Confirm production env on Vercel** matches what APIs need:
  - `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - `XAI_API_KEY`
  - `MARKETPLACE_CRON_SECRET` and/or `QUEUE_PROCESSOR_KEY` *(not in local `.env` yet)*
  - Optional later: `SHOPEE_SG_SESSION_JSON`, Cloudflare browser tokens
- [x] **Confirm migrations 047–051** on the Supabase project wired by local `SUPABASE_DB_URL`  
  (All applied including 051 overload fix. Re-check if Vercel uses a *different* DB.)

---

## 1. Smoke path (30–45 min once workspace exists)

End-to-end without real Shopee (mock collector):

- [x] Local mock collect via `node scripts/_smoke_marketplace_phase2.mjs` → `SMOKE_OK`  
  (seed `anua official` / mock, 3 shops, 3 listings, 3 snapshots, metrics daily)
- [ ] HTTP path (needs workspace **API key** + `MARKETPLACE_CRON_SECRET`):
  - [ ] `POST /api/v1/marketplace/seeds` with `target: "anua official"`, `collector_id: "mock"`, `schedule_kind: "daily"`
  - [ ] `POST /api/internal/marketplace/scheduler-tick` (or seed `.../run`)
  - [ ] `POST /api/internal/marketplace/process-jobs` → expect completed job + snapshots
  - [ ] `POST /api/internal/marketplace/metrics-tick`
  - [ ] `GET /api/v1/marketplace/export?search_query=anua%20official`
- [x] Study + pipeline via MCP tools (service role):  
  `study_start` → offline `study_brief` → `study_propose` → `pipeline_decide` (`accepted`) → `pipeline_execute`  
  → catalog product draft + watchlist seed linked
- [x] PO via MCP: draft (`quantity` not `qty`) → `po_submit` → `po_decide` (`approved`) → `projection_from_po`
- [x] MCP: `FRAN_MCP_WORKSPACE_ID` set; 37 tools; BI list/export/metrics against smoke data

Optional local smoke: `node scripts/_smoke_marketplace_phase2.mjs` (needs workspace + service role).

---

## 2. Live Shopee collect

### Done this session

- [x] Cookie export format validated (`sample-cookie.json` — EditThisCookie style; loader OK; has `SPC_ST` / `SPC_U`)
- [x] Seed `anua official` → `collector_id: "shopee_puppeteer"` (workspace `c21c057f-…`)
- [x] Live unattended attempt: cookies accepted (`is_logged_in=true`) but Shopee **traffic/captcha wall**  
  (`/verify/traffic/error`, `/verify/captcha?scene=crawler_item`) — not a missing-ID problem
- [x] Session-health detector improved (traffic / captcha / “page unavailable” → `blocked`)
- [x] Interactive local smoke path: `node scripts/_smoke_shopee_live.mjs`  
  - Loads `./sample-cookie.json` (no env cookie required)  
  - Opens system Chrome (`channel: 'chrome'`)  
  - Waits for manual captcha + optional **Enter** in TTY  
  - Writes jobs/snapshots via service role  
- [x] First interactive agent-run timed out still on captcha (`session_health=blocked`, 0 cards)  
  → **you must run the script in your own terminal** so you can solve captcha and press Enter

### Your next action (local interactive — profile path)

Cookie-export smoke (`_smoke_shopee_live.mjs`) hit traffic wall even with `is_logged_in=true`.  
**Prefer the persistent profile smoke** (login once inside Puppeteer’s Chrome; no cookie file):

```bash
# From repo root, in a real terminal (so Chrome + stdin work):
node scripts/_smoke_shopee_profile.mjs
```

Defaults now: **direct SERP** (`shopee.sg/search?keyword=anua`), **force Enter** (won’t race-close), hold Chrome open on fail.

1. Chrome opens → search URL (not homepage)  
2. Log in / solve captcha until product cards show  
3. Press **Enter** (required — does not auto-continue when page looks “ok”)  
4. Expect `LIVE_SMOKE_OK` + non-zero snapshots  

Local Puppeteer hit permanent captcha loop → **escalated to Browserbase**.

```bash
# Preferred live path (cloud browser + SG residential proxy):
node scripts/_smoke_shopee_browserbase.mjs
```

Watch session replay at the URL printed (`https://browserbase.com/sessions/<id>`).

- [x] Persistent Chrome profile smoke (`scripts/_smoke_shopee_profile.mjs`) — local blocked
- [x] **Browserbase adapter** (`collector_id: browserbase`) + smoke script
- [ ] Browserbase live smoke succeeds (`LIVE_SMOKE_OK`) with real SERP cards  
- [ ] Validate Mall / Preferred / normal badges on real SERP for `anua` / `anua official`

### Longer-term collect options

- [ ] **Cloudflare Browser Run** — fallback only; set CF env; seed `cloudflare_browser_run`
- [ ] **Warm always-on PC worker** — only if Browserbase fails / cost too high
- [x] **Persistent Chrome profile** — local research path; not production
- [ ] **CDP attach to real user Chrome** — last-resort local
- [x] **Browserbase adapter** — implemented; production cron still TBD
- [ ] **Hosted worker** (Fly / Railway / Cloud Run) for nightly collect once a stable path exists
- [ ] Wire cron once unattended path works:
  - hourly/daily: `scheduler-tick`
  - after enqueue: `process-jobs` (or dedicated worker loop)
  - daily: `metrics-tick`
- [ ] Session health ops: login wall / captcha → alert + pause seeds (runbook)  
  (detector improved; alerting not wired)

---

## 3. Product / phase backlog (from Major Update)

### Phase 6 — Reconciliation (not built)

- [ ] Design recon report types: `pos_vs_inventory`, `warehouse_vs_3pl`, `store_receive_vs_outbound`, `market_vs_retail`, `inbound_discrepancy`
- [ ] Schema: `recon_reports` + `recon_report_lines`
- [ ] Engines: compute variances in code; Grok narrative only
- [ ] HTTP: `/api/v1/recon/*`
- [ ] MCP tools: `recon_generate`, `recon_get`, `recon_list`, `recon_explain`, `recon_export`

### Phase 7 — Hardening / scale

- [ ] Daily shallow vs weekly deep seed policies
- [ ] BI digests with Grok (table exists; generation thin)
- [ ] Alerts → Slack / attention items
- [ ] Per-workspace browser + token budgets
- [ ] Second country (e.g. PH) only after SG stable
- [ ] Official shop seed list for brands Fran cares about

### UI (deferred)

- [ ] `app/pages/intelligence/*` — seeds, study, POs, projections, recon
- [ ] Sidebar entry for Intelligence / Marketplace BI

### Collectors / workers (partial)

- [ ] Dedicated `workers/marketplace-worker` package (claim loop, not only HTTP process-jobs)
- [ ] Cloudflare Browser Run production path hardened
- [ ] Optional Browserbase adapter if CF IPs blocked
- [ ] Detail-page pull for `detail_top_n` listings
- [x] Local interactive puppeteer smoke (`scripts/_smoke_shopee_live.mjs` + captcha wait)

---

## 4. Architecture / product decisions to lock

- [ ] **Liability / ops:** finish LOFT SOW open items (`docs/LOFT_SOW_KIV.md`) — not code-blocking but commercial
- [ ] Default collector for production seeds: mock vs puppeteer (interactive) vs cloudflare
- [ ] Who may `po:decide` / `pipeline:execute` (roles vs API key scopes)
- [ ] Whether internal POs later convert into inventory `purchase_orders` + LOFT inbound
- [ ] MCP transport: stdio only vs hosted HTTP for remote agents
- [ ] Grok models: brief vs digest vs projection commentary (cost tiers)

---

## 5. Security & hygiene

- [ ] Rotate any keys shared in chat
- [ ] Ensure Vercel env has no accidental commit of secrets
- [ ] Keep `sample-cookie.json` local (do not commit) — real Shopee session
- [ ] Review API key scopes for production keys (`intel:*`, `study:*`, `pipeline:*`, `po:*`, `projection:run`)
- [ ] Rate-limit cron endpoints; keep secrets off browser clients
- [ ] Document competitive-scrape ToS posture for Fran (internal BI only)

---

## 6. Docs / cleanup (low priority)

- [ ] Slim pointer doc `docs/FRAN_MARKET_INTELLIGENCE_ARCHITECTURE.md` → `Major Update.md` if wanted
- [ ] Remove or promote smoke scripts into formal npm scripts (`smoke:marketplace`, `smoke:shopee-live`)
- [ ] Add Nuxt `database.types.ts` (build warns missing) when ready
- [ ] Update `STRUCTURE.md` / root `README.md` with marketplace + MCP entrypoints

---

## 7. Already done (don’t redo)

| Phase | Delivered |
|-------|-----------|
| 0 | Seeds/jobs schema, scheduler enqueue, mock collector, types |
| 1 | Shopee parse, writers, puppeteer/CF adapters, process-jobs, snapshots |
| 2 | Metrics daily, export CSV/JSON, richer filters |
| 3 | Study brief/match, pipeline propose/decide/execute |
| 4 | MCP stdio server (`npm run mcp`), 30+ tools |
| 5 | Internal POs + projection engine + MCP/HTTP |
| Ship | Git `main` + Vercel production deploy |
| Ops | Workspace created; MCP workspace id; mock+MCP smoke; migration 051 overload fix |
| Live | Cookie validated; interactive smoke script; captcha wall documented |

---

## 8. Suggested order (updated 2026-07-11 evening)

1. ~~Workspace + `.env` workspace id~~ done  
2. ~~Mock + MCP smoke (section 1 core)~~ done  
3. **You:** `node scripts/_smoke_shopee_browserbase.mjs` → `LIVE_SMOKE_OK` (§2)  
4. Then product build (Phase 6 / UI / worker) **or** cron on browserbase seeds  
5. Secret rotation + Vercel env audit (§0 / §5) if keys were shared  
6. LOFT SOW KIV commercial follow-ups when you have bandwidth  

---

## Quick commands

```bash
# Workspace id for MCP
npm run workspace:id

# Local app
npm run dev

# MCP server
npm run mcp

# Mock marketplace smoke (no Shopee)
node scripts/_smoke_marketplace_phase2.mjs

# Live Shopee smoke — preferred: Browserbase cloud browser
node scripts/_smoke_shopee_browserbase.mjs

# Live Shopee smoke — local profile / cookie (usually captcha-walled)
node scripts/_smoke_shopee_profile.mjs
node scripts/_smoke_shopee_live.mjs

# Migrations (if needed on another DB)
npm run db:migrate:status
npm run db:migrate -- --from 047 --to 051

# Tests
node --test tests/marketplace-intelligence-phase*.test.mjs
```

## Links

- Production: https://fran-skums.vercel.app  
- Repo plan: `Major Update.md`  
- LOFT ops KIV: `docs/LOFT_SOW_KIV.md`  
- MCP setup: `mcp/README.md`  
- Marketplace collect: `marketplace/README.md`  
