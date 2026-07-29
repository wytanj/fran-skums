# Demand forecasting architecture (Fran SKUMS)

**Status:** Track **FC** · **FC-0–1 done** · **K Rpt-6 live handlers done** · next FC-2/3 · actions via Store Ops + Track **J**  
**Date:** 2026-07-27 (updated same day: Rpt-6 + FC-1)  
**Queue:** root [`TODO.md`](../TODO.md)  
**Sources:** `grok-forecasting.md` · `claude-forecast.md` · current `/forecasting` UI · `server/api/forecast.post.ts` · report registry (mig **066–067**)

---

## 0. Product intent

Fran is a **Gen Z beauty retail** operator: physical outlets + app-style engagement (Luckin-like *intent + coupon actuator*, not pure e-commerce). Inventory truth lives in **SKUMS** (catalog, ATS, Loft, POs, store ops). Agents reach the same truth via **MCP**. Buyers still live in Sheets / Airtable / Excel for planning.

**North star:** a **demand decision studio**, not “paste Excel into a chat model” and not “one ARIMA per SKU forever.”

```text
Deterministic views + nightly snapshots  →  numbers you can audit
TSFM / stats (later)                     →  calibrated distributions
Frontier LLM (Grok / Opus / …)           →  context, critique, tool use, narrative
MCP + HQ UI                              →  attach external plans; draft actions only
App / promo (later)                      →  move demand toward stock you hold
Human HQ                                 →  approve; never auto FOB / Loft / PO lock
```

**Locked with Track K:** *suggest ≠ execute*. Forecasts may recommend reorder lines; they never auto-approve, send Loft, or mark FOB.

---

## 1. Pre-2022 vs cutting-edge (what we refuse)

| Pre-2022 (still useful as *floor*) | Not “cutting edge” | Cutting edge for Fran |
|------------------------------------|--------------------|------------------------|
| SMA / EWMA, Croston, lead-time safety stock | Dumping a sheet into Opus/Grok and trusting unit counts | **Stack:** extrapolation + context + decisions + actuators |
| Hand features + regression / LightGBM | Prompting an LLM to *roleplay* ARIMA/Croston | LLM turns mess → **structured covariates / events** |
| Static promo calendar spreadsheet | MAPE as sole KPI on intermittent demand | Pinball / $ loss / service-level quantiles |
| One model per series | Chat as the only UI | TSFM zero-shot + analogs + read-and-react + agent tools |

**Explicit non-goals (v1–v2):**

- LLM as sole point forecaster (poor calibration, non-reproducible).
- Auto-execution of buy / transfer / Loft send from a model.
- Merging **path A store_fill** and **path B supplier_buy** into one “order qty.”
- Claiming “ARIMA” unless stats code actually runs it (today’s `/api/forecast` is **prompted classical labels on `grok-3-mini`** — technical debt).

---

## 2. Layered architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│  L5  Actuation (later)                                           │
│      App funnel, inventory-aware promo, C&C / pre-order share    │
├─────────────────────────────────────────────────────────────────┤
│  L4  Decisions & actions                                         │
│      Path A draft store request · Path B draft PO (Track J)      │
│      Suggest only · scopes · audit                               │
├─────────────────────────────────────────────────────────────────┤
│  L3  Agents & frontier models                                    │
│      Orchestrate tools · reason codes · narratives · critique    │
│      Catalog AI / Claude MCP / in-app forecast run               │
├─────────────────────────────────────────────────────────────────┤
│  L2  Context store                                               │
│      Events, social/BR priors, sheet attachments, overrides      │
│      (LLM-written rows; humans edit)                             │
├─────────────────────────────────────────────────────────────────┤
│  L1  Extrapolation                                               │
│      v_demand_* · nightly MA snapshot · (later) TSFM quantiles │
├─────────────────────────────────────────────────────────────────┤
│  L0  Truth                                                       │
│      sales_events · POS · ATS · Loft · POs · expiry · locations  │
└─────────────────────────────────────────────────────────────────┘
```

| Layer | Owner system | TODO.md link |
|-------|--------------|--------------|
| **L0** | SKUMS DB + POS sale contract | Loft P–F · POS handoff · inventory events |
| **L1** | Views + **Track K** sections | **Rpt-6** `demand.velocity_snapshot`, reorder A/B |
| **L2** | `forecast_events` + pipeline `forecast_input` + BR | Track **BR** · study/pipeline |
| **L3** | `/api/forecast` redesign · MCP forecast tools · assistant | Phase R · MCP leftovers |
| **L4** | Store Ops drafts · PO drafts | M6 polish · Track **J** |
| **L5** | Consumer app / CRM promo (future) | Track **L** / WEB / later |

---

## 3. Methods we adopt (ranked ROI for Fran)

From `claude-forecast.md` (Gen Z beauty + app), ordered for **our** constraints (short-life SKUs, KR/HK lead times, Shopee Mall intel, multi-store + loft):

| Rank | Method | Why here | Depends on |
|------|--------|----------|------------|
| **1** | **App / funnel leading indicators** | Wishlist, cart, store views, coupon opens lead sales by hours–days; conversion more stable than raw units. Luckin edge = demand *actuator*, not only signal. | App or POS+loyalty events; L5 later |
| **2** | **LLM context covariates** | Social, Mall reviews, buyer notes, promo PDFs → daily feature / event rows. Not unit forecasts. | BR harvest · MCP Sheets/Airtable · event registry |
| **3** | **Analog cold start + censoring** | Beauty drops die before classical series mature; image/text nearest neighbors + stockout-corrected history. | Catalog images · sales history quality |
| **4** | **Read-and-react** | First 7–14d sell-through >> pre-launch model; Bayesian curve update; late allocation from loft/central. | Fast store ops rebalance · velocity views |
| **5** | **TSFM zero-shot** | Chronos / TimesFM / Moirai-class for distributions & long-tail; **buy/call API**, don’t reinvent. | Clean series API · after L1 solid |
| **6** | **Causal promo / uplift** | “If we push offer X” vs baserate; inventory-aware targeting. | Experiment surface · L5 |
| **7** | **Decision-focused loss** | Pinball at service level; $ stockout vs markdown asymmetry. | Cost parameters · backtest harness |

**Lead time honesty:** cutting KR/HK lead time (Track **J** process + suppliers) often beats any model improvement. Forecasts must show **lead_time_days** and path B implications, not hide them.

---

## 4. Path A / Path B (never merge)

Same rules as Track **K** demand sections:

| Path | When | Downstream | MCP / UI |
|------|------|------------|----------|
| **A `store_fill`** | Store cover low **and** network/Loft has stock | Draft store replenishment request → HQ `store_ops_decide` | Existing store_ops tools |
| **B `supplier_buy`** | Network cover low vs supplier lead time | Draft **editable** PO → affirm → **FOB PDF → in_transit** → ASN (Track **J**) | `po_*` draft tools; never “in transit” from forecast alone |

Forecast UI and agents must label every recommended line with **A or B**. Combined “buy N” without path is a product bug.

---

## 5. Current state (as of 2026-07-27)

### Shipped / partial

| Piece | Location | Notes |
|-------|----------|--------|
| Demand / reorder / expiry views | `v_demand_velocity`, `v_reorder_alerts`, `v_expiry_risk` | Solid **L1 floor** |
| HQ page | `app/pages/forecasting/index.vue` | Isolated zinc chrome; four tabs; no path A/B actions |
| Composable | `app/composables/useForecasting.ts` | Direct Supabase views; AI path incomplete (often skips `loadDemandVelocity`) |
| “AI forecast” API | `server/api/forecast.post.ts` | Hardcoded **`grok-3-mini`**; method selection is **prompt theatre**; `daily_sales_history` accepted but UI doesn’t send it |
| SG events | `forecast_events` | Read-mostly; multipliers for prompt context |
| Scopes | `forecasting:read` / `forecasting:write` | In packages; little product surface |
| Report platform | Track **K** Rpt-0–5 | Subscriptions, cron, MCP `reports_*` — **sections still stub** |
| Pipeline type | `forecast_input` candidate kind | Stub for external signals |

### Gaps vs architecture

1. No persisted **forecast runs** (contrast `report_runs`).
2. No MCP `forecast_*` tools (backlog: “forecast summary”).
3. No attachment of Sheets / Airtable / Excel as **context** with tool log.
4. No handoff buttons to draft store request / PO.
5. No link from `/forecasting` ↔ last **K** demand pack.
6. LLM used as calculator instead of context/orchestrator.
7. No read-and-react surface for new/LE SKUs.
8. No app funnel features (L5).

---

## 6. Target UX — Demand decision studio

Replace “four disconnected tables + Run Grok” with:

```text
┌────────────────────────────────────────────────────────────────┐
│ Demand  ·  Last nightly (K)  ·  Open /reports  ·  Help         │
├────────────┬─────────────────────────────┬─────────────────────┤
│ Queue      │ Run canvas                  │ Context & models    │
│ multi-SKU  │ baseline vs model           │ Sources (SKUMS,     │
│ A/B badges │ 30/60/90 + quantiles        │ sheet, Airtable)    │
│            │ path A/B cards → drafts     │ Mode + model picker │
│            │ read-and-react strip        │ Tool / evidence log │
└────────────┴─────────────────────────────┴─────────────────────┘
```

| Mode | Behavior |
|------|----------|
| **Baseline only** | Views + last snapshot; no LLM; free |
| **Explain** | LLM narrates structured stats + events; no free unit invention preferred |
| **Deep research** | Tools allowed: catalog, inventory, BR, Help, Sheets/Airtable/Excel MCP; visible tool log |
| **Compare** | Two runs side-by-side (baseline vs model; or two models) |

**External plans:** attach Google Sheet / Airtable / Excel → map SKU columns → model may **diff** plan vs velocity (“sheet 200, signal supports 80”). SKUMS remains inventory SoR; sheet is not stock truth.

Align page chrome with default HQ layout (drop isolated full-page shell).

---

## 7. MCP contract (planned)

Scopes: reuse `forecasting:read` / `forecasting:write` and action scopes on downstream tools (`store_ops:write`, `po:draft`, …). Cloud keys: package ∩ bound user (A2).

| Tool | Mode | Purpose |
|------|------|---------|
| `forecast_snapshot` | Read | Velocity / reorder / expiry digest + last K demand section payload |
| `forecast_run` | Write (scoped) | Create run: product set, horizon, mode, model id; returns run id |
| `forecast_get_run` | Read | Inputs, outputs, confidence, evidence, tool log |
| `forecast_recommend_actions` | Suggest | Lines labeled **store_fill** \| **supplier_buy** only — no execute |
| *(existing)* | Write draft | `store_ops_create_draft_request`, `po_create_draft` / `po_update_draft` |

Agent instructions: never say “ordered” or “in transit” from a forecast run; Mall metrics ≠ ATS (two-bucket rule).

---

## 8. Data model (target, incremental)

| Object | Purpose | Notes |
|--------|---------|--------|
| **Existing** `forecast_events` | Calendar multipliers | Make workspace-editable; optional applies_to brand/category/SKU |
| **Existing** views | L1 floor | Prefer nightly materialization for heavy reads (K) |
| **`forecast_runs`** (new) | Persist job | actor, model, mode, input_hash, payload_json, markdown, status |
| **`forecast_run_lines`** (optional) | Per-SKU outputs | quantiles, path, suggested_qty, confidence |
| **`forecast_context_links`** (optional) | Attached sources | sheet id, airtable base, upload id, column map |
| **Pipeline** `forecast_input` | External priors | From BR / study; labeled prior, not ATS |

Nightly job (prefer **K cron** path): write `demand.velocity_snapshot` + reorder A/B section results; Forecasting UI **reads** them (do not recompute full portfolio on every chat).

---

## 9. Build slices (Track FC) — relation to TODO.md

Track letter **FC** keeps forecasting work visible next to **K / J / BR / L** without overloading report registry tickets.

| Slice | Work | Status | Blocks / pairs with |
|-------|------|--------|---------------------|
| **FC-0** | This doc + TODO.md index + Help stub later | **Done** (this file) | — |
| **FC-1** | Foundation fix: load velocity, pass daily series when present, HQ chrome, multi-select queue | **Done** | Rpt-6 handlers |
| **FC-2** | Persist `forecast_runs`; model + mode picker; stop fake ARIMA labels unless code runs method | Planned | xAI / model gateway |
| **FC-3** | Path A/B action buttons → draft store request / draft PO | Planned | Store Ops · **J** draft tools · M6 |
| **FC-4** | Consume **K Rpt-6** sections in UI (“last nightly”); shared section handlers | Planned | **K Rpt-6** |
| **FC-5** | MCP `forecast_snapshot` / `run` / `get` / `recommend_actions` | Planned | Phase R patterns · A2 scopes |
| **FC-6** | Context attachments: Excel upload first; Sheets/Airtable via MCP tool log | Planned | Capability sources · external MCP |
| **FC-7** | Event registry UX + optional LLM assist to propose events from calendar/docs | Planned | L2 |
| **FC-8** | Read-and-react panel (new/LE: day 1–14 curve vs analog prior) | Planned | Sales quality |
| **FC-9** | TSFM provider adapter (quantiles); ensemble with baseline | Later | Cost controls |
| **FC-10** | App funnel features + inventory-aware promo hooks | Later | Consumer app · Track L promo |
| **FC-11** | Causal promo measurement / experiments | Later | L5 randomization |

### Sequencing with existing tracks

```text
TODO.md near-term (unchanged priority for ops):
  Loyalty M5 live demo · BR harvest ops · Loft Phase 0 · Phase S MFA

Eng that unlocks forecasting correctly:
  K Rpt-6  ──►  real demand.velocity_snapshot + reorder.store_fill / supplier_buy
       │
       ├── FC-1/2  studio foundation + honest model layer
       ├── FC-4    UI binds to K sections (single truth)
       ├── FC-3    actions → drafts (A/B)
       ├── FC-5    MCP parity for Claude
       └── FC-6    external plans without becoming SoR

When buying focus:
  J1–J4  ◄── FC-3 path B drafts only; FOB gate still human/system

When app exists:
  FC-10/11  ◄── Luckin-style actuation (highest long-term ROI per claude-forecast.md)
```

**Do not** schedule FC-9/10 ahead of FC-1–5. Claude’s ROI order still holds: funnel/context/analogs before TSFM worship.

---

## 10. Evaluation & governance

| Do | Don’t |
|----|--------|
| Backtest in **$** (stockout + holding + markdown) | Optimize only MAPE |
| Pinball / RMSSE for intermittent series | Treat zero-sale days as “failure” of SMA |
| Log model id, prompt/version, input_hash | Silent model swaps in prod |
| Capture buyer **override reasons** (text → tags) | Overrides as bare qty with no reason |
| Show confidence + data maturity | Fake “high confidence” on cold start |
| Scope-gate runs and drafts | Elevated MCP key without web intersection |

---

## 11. Help & agent copy

When Help article lands (suggested slug `demand-forecast-studio`):

- Baseline vs model vs deep research.
- Path A vs B; suggest ≠ execute; FOB gate (link `po-transfer-lifecycle`).
- Mall / BR is prior, not ATS (two-bucket).
- How to attach a sheet without replacing SKUMS stock.

Catalog AI / MCP: `get_help_article` / `help_get` that slug after migration.

---

## 12. Code map (today → target)

| Area | Today | Target |
|------|-------|--------|
| UI | `app/pages/forecasting/index.vue` | Decision studio; default layout chrome |
| Client | `app/composables/useForecasting.ts` | Runs API + snapshot read; less raw multi-query |
| API | `server/api/forecast.post.ts` | `/api/forecast/runs` · model registry · no fake method names |
| Reports | `server/utils/reportRegistry.ts` | Real `demand.*` / `reorder.*` handlers (K) |
| MCP | *(missing)* | `mcp/src/lib/forecast.mjs` (+ tool collector) |
| Events | `forecast_events` | Editable + applies_to |
| Scopes | `forecasting:*` | Enforce on API + MCP |

---

## 13. Relation to source memos

| Memo | Use |
|------|-----|
| **`grok-forecasting.md`** | Stack catalog: TSFM, agents, causal, hierarchy, twins, decision-focused learning |
| **`claude-forecast.md`** | Fran-shaped ROI order; LLM = context; app actuator; read-and-react; anti-MAPE |

This doc is the **implementation contract** for Fran; the memos remain research notes at repo root (optional later move under `docs/research/`).

---

## 14. Definition of done (FC mid-stack)

- [ ] `/forecasting` shows baseline from views + **last K demand section** when Rpt-6 live  
- [ ] User can multi-select SKUs, run **Baseline** or **Explain**, see model id + confidence  
- [ ] Recommended lines labeled **store_fill** or **supplier_buy** with draft actions  
- [ ] `forecast_runs` persisted and auditable  
- [ ] MCP `forecast_snapshot` + `forecast_run` work under A2 scopes  
- [ ] No production path claims ARIMA/Croston unless code implements it  
- [ ] Help article for agents + humans  

**Not required for mid-stack DoD:** TSFM vendor, app funnel, causal experiments, Airtable (Excel attach is enough for FC-6 start).

---

## Changelog

| Date | Note |
|------|------|
| 2026-07-27 | Initial architecture from grok/claude memos + Forecasting UI audit + TODO.md tracks K/J/BR/L |
| 2026-07-27 | Rpt-6 `runReportSections` + FC-1 forecasting foundation shipped |
