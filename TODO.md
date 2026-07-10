# Fran SKUMS — TODO (review queue)

**Date:** 2026-07-11  
**Context:** Marketplace intelligence phases **0–5** are implemented, committed (`3aad5bd`), and deployed to Vercel (`https://fran-skums.vercel.app`).  
**Plan of record:** `Major Update.md`

Use this list for tomorrow’s pass. Check boxes as you go.

---

## 0. Do first (unblocks everything else)

- [ ] **Create a Fran workspace** (DB currently had zero workspaces at last check)
  1. `npm run dev` → sign up / log in
  2. Complete **onboarding** (creates workspace via `create_workspace`)
  3. `npm run workspace:id` (or `node scripts/print-workspace-id.mjs`)
  4. Add to `.env`: `FRAN_MCP_WORKSPACE_ID=<uuid>`
- [ ] **Rotate secrets** that were pasted in chat (if not already)
  - Supabase **service role** key
  - Confirm `.env` is never committed (still gitignored)
- [ ] **Confirm production env on Vercel** matches what APIs need:
  - `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - `XAI_API_KEY`
  - `MARKETPLACE_CRON_SECRET` and/or `QUEUE_PROCESSOR_KEY`
  - Optional later: `SHOPEE_SG_SESSION_JSON`, Cloudflare browser tokens
- [ ] **Confirm migrations 047–050** on the Supabase project Vercel uses  
  (Applied earlier via `npm run db:migrate -- --from 047 --to 050` on local DB URL — re-check if prod DB differs)

---

## 1. Smoke path (30–45 min once workspace exists)

End-to-end without real Shopee (mock collector):

- [ ] `POST /api/v1/marketplace/seeds` with `target: "anua official"`, `collector_id: "mock"`, `schedule_kind: "daily"`
- [ ] `POST /api/internal/marketplace/scheduler-tick` (or seed `.../run`)
- [ ] `POST /api/internal/marketplace/process-jobs` → expect completed job + snapshots
- [ ] `POST /api/internal/marketplace/metrics-tick`
- [ ] `GET /api/v1/marketplace/export?search_query=anua%20official`
- [ ] Study: `sessions` → `brief` → `propose` → `pipeline decide/execute` (watchlist + catalog draft)
- [ ] PO: create draft → submit → approve → `projection_from_po`
- [ ] MCP: set `FRAN_MCP_WORKSPACE_ID`, run `npm run mcp`, exercise same flow via tools

Optional local smoke: `node scripts/_smoke_marketplace_phase2.mjs` (needs workspace + service role).

---

## 2. Live Shopee collect (when ready)

- [ ] Export logged-in Shopee cookies → `SHOPEE_SG_SESSION_JSON` in `.env` (local worker)
- [ ] Create seed with `collector_id: "shopee_puppeteer"` (or `cloudflare_browser_run` if CF tokens set)
- [ ] Run process-jobs **on a machine with Puppeteer/Chrome** (not Vercel serverless for long browser work)
- [ ] Decide cloud worker host for nightly collect (Fly / Railway / Cloud Run / always-on PC)
- [ ] Wire cron:
  - hourly/daily: `scheduler-tick`
  - after enqueue: `process-jobs` (or dedicated worker loop)
  - daily: `metrics-tick`
- [ ] Validate Mall / Preferred / normal badges on real SERP for `anua official`
- [ ] Session health: login wall / captcha → alert + pause seeds (ops runbook)

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

---

## 4. Architecture / product decisions to lock

- [ ] **Liability / ops:** finish LOFT SOW open items (`docs/LOFT_SOW_KIV.md`) — not code-blocking but commercial
- [ ] Default collector for production seeds: mock vs puppeteer vs cloudflare
- [ ] Who may `po:decide` / `pipeline:execute` (roles vs API key scopes)
- [ ] Whether internal POs later convert into inventory `purchase_orders` + LOFT inbound
- [ ] MCP transport: stdio only vs hosted HTTP for remote agents
- [ ] Grok models: brief vs digest vs projection commentary (cost tiers)

---

## 5. Security & hygiene

- [ ] Rotate any keys shared in chat
- [ ] Ensure Vercel env has no accidental commit of secrets
- [ ] Review API key scopes for production keys (`intel:*`, `study:*`, `pipeline:*`, `po:*`, `projection:run`)
- [ ] Rate-limit cron endpoints; keep secrets off browser clients
- [ ] Document competitive-scrape ToS posture for Fran (internal BI only)

---

## 6. Docs / cleanup (low priority)

- [ ] Slim pointer doc `docs/FRAN_MARKET_INTELLIGENCE_ARCHITECTURE.md` → `Major Update.md` if wanted
- [ ] Remove or promote `scripts/_smoke_marketplace_phase2.mjs` into a formal smoke npm script
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

---

## 8. Suggested order for tomorrow

1. Workspace + `.env` workspace id + secret rotation  
2. Mock smoke (section 1)  
3. Decide collect host + Shopee session (section 2)  
4. Pick next build: **Phase 6 recon** vs **UI** vs **worker hardening**  
5. LOFT SOW KIV commercial follow-ups when you have bandwidth  

---

## Quick commands

```bash
# Workspace id for MCP
npm run workspace:id

# Local app
npm run dev

# MCP server
npm run mcp

# Migrations (if needed on another DB)
npm run db:migrate:status
npm run db:migrate -- --from 047 --to 050

# Tests
node --test tests/marketplace-intelligence-phase*.test.mjs
```

## Links

- Production: https://fran-skums.vercel.app  
- Repo plan: `Major Update.md`  
- LOFT ops KIV: `docs/LOFT_SOW_KIV.md`  
- MCP setup: `mcp/README.md`  
- Marketplace collect: `marketplace/README.md`  
