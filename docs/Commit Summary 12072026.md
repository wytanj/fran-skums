# Commit Summary — 12 Jul 2026

**Repo:** fran-skums  
**Branch:** `main`  
**Date:** 2026-07-12  

## Theme

Dirty multi-provider catalog import with job progress, plus Shopee live-collect fallbacks (Browserbase) after local Puppeteer captcha walls.

---

## 1. Catalog import pipeline (primary)

### Shared library (`core/import/`)
- `parse.mjs` — dirty CSV/XLSX parse; ABW multi-line header / preamble detection
- `map.mjs` — deterministic column aliases (supplier item, cost, brand, option, …)
- `normalize.mjs` — product write plan, identifiers, SKU assignments, wholesale box tiers
- `index.mjs` — exports + `LARGE_IMPORT_ROW_THRESHOLD` (2000) + job progress helper

### UI / runner
- `app/composables/useCatalogImport.ts` — full import run:
  - create `import_jobs` early
  - persist `import_options.progress` every batch
  - poll job every 1.5s for live status
  - batch brand/category resolve
  - **upsert by SKU** (catalog no) for re-imports
  - ABW defaults: wholesale → `cost_price`, `pos_enabled: false`
  - slim staged `raw_data` on large jobs
- `app/pages/import-export.vue` — wired to composable; job id, %, created/updated/errors, completion panel

### API
- `GET /api/v1/imports/:id` returns `progress`, `is_complete`, `completion` for large-file monitoring

### Tests
- `tests/import-pipeline.test.mjs` + `tests/fixtures/abw-sample.csv`
- Updated `tests/imports-api.test.mjs` for new architecture

**User-visible:** drop dirty supplier files (incl. ~59k ABW catalogs); see job progress through to **Completed**.

---

## 2. Marketplace collect — Browserbase path

Local Shopee Puppeteer hit permanent captcha/traffic loops. Non-local path added:

- `marketplace/collectors/browserbase/adapter.mjs` — session create (SG proxy, captcha solve, `ap-southeast-1`), Puppeteer connect, reuse SERP scraper
- Registered in collector registry + `marketplaceCollect.ts`
- Smoke: `scripts/_smoke_shopee_browserbase.mjs`
- Env docs: `BROWSERBASE_API_KEY` (+ optional proxies/region)
- Local alternatives kept: `_smoke_shopee_live.mjs`, `_smoke_shopee_profile.mjs` (research only)

---

## 3. Supporting / incidental

- Shopee puppeteer: force manual wait, skip-home SERP, better captcha pause behaviour
- TODO / marketplace README / MCP tool collector list updated
- Workspace RPC overload migration notes (`051`) where present
- `.gitignore`: cookies, Chrome profile, `product-list.csv`, local scrape debug images

---

## Not committed

- `product-list.csv` (large local supplier dump)
- Local Shopee screenshots / debug text / cookie exports
- `.env` secrets

---

## Deploy notes

- Push `main` → Vercel production (fran-skums / skums)
- Ensure `BROWSERBASE_API_KEY` only if using live Browserbase collect (optional)
- Import path uses Supabase client + existing `import_jobs` schema (`028`/`039`); no new migration required for import progress (stored in `import_options` jsonb)

---

## Verify after deploy

1. Open Import/Export → upload a small dirty CSV → map → import → see job complete  
2. Optional: `node scripts/_smoke_shopee_browserbase.mjs` with local env for live Shopee  
3. `node --test tests/import-pipeline.test.mjs tests/imports-api.test.mjs`

---

## Follow-ups (not in this commit)

- Server-side worker so 59k imports do not need the browser tab open  
- Saved provider mapping profiles  
- LLM mapping when deterministic confidence is low  
- Default review gate (stage before commit) without demo auto-commit  
