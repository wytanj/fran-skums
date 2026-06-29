# Skincare Intelligence App

A vertical SKUMS app that adds skincare/cosmetics-specific intelligence
to the canonical SKU master.

## What's in This Directory

```
apps/skincare/
├── manifest.ts                         # AppManifest declaration
├── db/                                 # Skincare-specific SQL migrations
│   ├── 001_skincare_intelligence.sql
│   └── 002_skincare_seed.sql
├── server/
│   ├── api/apps/skincare/              # API endpoints (mounted at /api/apps/skincare/*)
│   │   └── (to be migrated from server/api/skincare/)
│   └── utils/scoring/                  # Scoring engines (IPS, skin type fit, conflicts)
│       └── (to be migrated from server/utils/skincare-scoring.ts)
└── app/
    ├── pages/apps/skincare/            # UI pages (mounted at /apps/skincare/*)
    │   └── (to be split out of app/pages/integrations.vue)
    ├── components/                     # Skincare-specific Vue components
    └── composables/                    # Skincare-specific composables
```

## Migration Status

This app's structure is in place but most code still lives in the
historical locations. Migration from the old paths happens incrementally.

### Vercel-safe (will move into this directory)

| From | To |
|------|-----|
| `server/api/skincare/products.get.ts` | `apps/skincare/server/api/apps/skincare/products.get.ts` |
| `server/api/skincare/product/[id].get.ts` | `apps/skincare/server/api/apps/skincare/product/[id].get.ts` |
| `server/api/skincare/stats.get.ts` | `apps/skincare/server/api/apps/skincare/stats.get.ts` |
| `server/api/skincare/reset.post.ts` | `apps/skincare/server/api/apps/skincare/reset.post.ts` |
| `server/utils/skincare-scoring.ts` | `apps/skincare/server/utils/scoring/index.ts` |
| Skincare-related Grok prompts in `server/api/quality/url-analyse.post.ts` | `apps/skincare/server/api/apps/skincare/url-analyse.post.ts` |
| Skincare tabs in `app/pages/integrations.vue` (lines 40, 731, 792, 843, 1011, 1013) | `apps/skincare/app/pages/apps/skincare/{index,methodology}.vue` |

### Deferred — not Vercel-deployable, frozen in current location

| File | Why deferred |
|------|--------------|
| `server/api/skincare/crawl.post.ts` | Runs Puppeteer in-process — fails on Vercel serverless |
| `server/api/skincare/jobs.get.ts` | Tied to crawl orchestration |
| `server/api/skincare/logs.get.ts` | In-memory log buffer tied to crawl |
| `server/utils/scrapers/hwahae.ts` | Puppeteer scraper |
| `server/utils/scrapers/oliveyoung.ts` | Puppeteer scraper |
| `server/utils/browser-manager.ts` | Puppeteer browser lifecycle |
| `server/utils/crawl-logger.ts` | Tied to crawl |
| Crawl management UI tab inside `integrations.vue` | Tied to broken backend |

These will be re-integrated once the scraping deployment story is resolved
(see `docs/SCRAPING_DEPLOYMENT_OPTIONS.md` and `docs/SCRAPE_WITH_GSTACK.md`
for the options being considered).

## Reference Documents

- `.claude/plans/cheerful-soaring-puffin.md` — Procurement intelligence framework + Hwahae addendum + ingredient conflict map
- `.claude/plans/skincare-ingredient-reference.md` — Ingredient tiers (Tier 1-4 + Avoid/Caution/Watch)
