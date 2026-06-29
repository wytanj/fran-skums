# SKUMS Repository Structure

This document describes the **target** repository layout. The migration
into this structure is incremental — some code still lives in
historical locations and is moved as it's touched. See
`docs/MIGRATION_STATUS.md` (forthcoming) for the move log.

## Three Citizenship Classes

SKUMS code falls into one of three categories:

| | Core | App | Channel |
|---|------|-----|---------|
| **Industry-specific?** | Never | Always | Channel-specific |
| **Has UI?** | Yes | Yes | No |
| **Has server routes?** | Yes (`/api/*`) | Yes (`/api/apps/<id>/*`) | No (called by core) |
| **Has SQL migrations?** | Yes (`core/db/`) | Yes (`apps/<id>/db/`) | Rarely |
| **Required for platform?** | Yes | No (opt-in per workspace) | At least one for cascade |
| **Examples** | products, inventory, expiry, perspectives, grants | Skincare Intelligence | Shopee, Shopify, B2B EDI |

## Top-Level Layout

```
skums/
├── nuxt.config.ts                   Main Nuxt config
├── package.json
├── tsconfig.json
├── STRUCTURE.md                     ← this file
│
├── core/                            ★ Industry-agnostic platform
│   ├── db/                          Core SQL migrations (numbered)
│   │   ├── 001_workspaces.sql
│   │   ├── 002_dynamic_schema.sql
│   │   ├── ...
│   │   └── MIGRATIONS.md
│   ├── server/                      (target — code migrates here)
│   ├── app/                         (target — code migrates here)
│   └── shared/                      (target — types/utilities)
│
├── apps/                            ★ Vertical app modules
│   └── skincare/
│       ├── manifest.ts              AppManifest declaration
│       ├── README.md
│       ├── db/                      App-specific SQL
│       │   ├── 001_skincare_intelligence.sql
│       │   ├── 002_skincare_seed.sql
│       │   └── MIGRATIONS.md
│       ├── server/api/apps/skincare/  (target API routes)
│       ├── server/utils/scoring/      (target scoring engines)
│       └── app/pages/apps/skincare/   (target UI pages)
│
├── channels/                        ★ Channel adapters
│   ├── _types.ts                    Re-exports ChannelAdapter contract
│   ├── _registry.ts                 Adapter registry
│   ├── README.md
│   └── shopee/                      (Phase E — to be built)
│       ├── adapter.ts
│       ├── auth.ts
│       ├── sync/
│       ├── feed.ts
│       └── ...
│
├── packages/                        Shared internal libraries
│   ├── @skums-types/                ★ Type contracts (Perspective, Grant, etc.)
│   │   ├── perspective.ts
│   │   ├── grant.ts
│   │   ├── app-manifest.ts
│   │   ├── channel-adapter.ts
│   │   ├── index.ts
│   │   └── README.md
│   ├── @skums-sdk/                  (future — SDK for external apps)
│   └── @skums-perspective/          (future — project() function package)
│
├── docs/                            Architecture & deployment docs
│   ├── SCRAPING_DEPLOYMENT_OPTIONS.md
│   └── SCRAPE_WITH_GSTACK.md
│
├── tests/                           (future — top-level test suites)
│
├── app/                             ◇ HISTORICAL — Nuxt UI (incremental migration)
├── server/                          ◇ HISTORICAL — Nitro server (incremental migration)
└── supabase/                        ◇ HISTORICAL — original SQL location
                                      (files copied to core/db/ and apps/*/db/;
                                       originals retained until verified)
```

★ = new structural location
◇ = historical location, code moves out incrementally

## The Four Load-Bearing Contracts

Everything else in the codebase consumes one or more of these:

### 1. Perspective (`packages/@skums-types/perspective.ts`)
Multi-dimensional context that determines what a user sees.
`(locale, market, currency, role, channels, industries, verification_tier)`.

### 2. Grant (`packages/@skums-types/grant.ts`)
Authorization passed from one entity to another in the brand →
distributor → retailer → channel-seller chain. Verifiable, scoped,
revocable.

### 3. AppManifest (`packages/@skums-types/app-manifest.ts`)
A vertical app's self-declaration: industries, fields it adds, routes
it provides, requirements it has.

### 4. ChannelAdapter (`packages/@skums-types/channel-adapter.ts`)
Contract every channel integration implements: auth, push, pull, feed,
validate.

## Migration Phases

The structural migration unfolds in six phases. Phase A is complete;
B onward is incremental.

| Phase | Scope | Status |
|-------|-------|--------|
| A | Reorganize SQL migrations into `core/db/` and `apps/skincare/db/` | ✅ Done |
| B | Carve out Skincare app non-scraping code into `apps/skincare/` | ⏳ Pending |
| C | Build the spine: Perspective + Grants + Verification + workspace_apps | ⏳ Pending |
| D | Channel adapter scaffolding (contracts + registry) | ✅ Done |
| E | First real channel: Shopee | ⏳ Pending |
| F | Apps marketplace UI | ⏳ Pending |

Phase A and the scaffolding portions of D are complete. The rest is
non-blocking organizational work that lands as the codebase evolves.

## What's Deferred

Scraping-dependent code is **frozen** in current locations until a
deployment story is finalized (see `docs/SCRAPING_DEPLOYMENT_OPTIONS.md`
and `docs/SCRAPE_WITH_GSTACK.md`):

- `server/utils/scrapers/hwahae.ts`
- `server/utils/scrapers/oliveyoung.ts`
- `server/utils/browser-manager.ts`
- `server/utils/crawl-logger.ts`
- `server/api/skincare/crawl.post.ts`
- `server/api/skincare/jobs.get.ts`
- `server/api/skincare/logs.get.ts`
- The crawl management UI tab inside `app/pages/integrations.vue`

These will reappear under `apps/skincare/` once the runtime path
(dedicated server / Claude headless / gstack) is chosen and proven.

## Adding a New Vertical App

1. Create `apps/<id>/` with the same layout as `apps/skincare/`.
2. Write `manifest.ts` declaring industries, fields added, routes, requirements.
3. Add SQL under `apps/<id>/db/` with a `MIGRATIONS.md`.
4. Place server code under `apps/<id>/server/api/apps/<id>/` and `server/utils/`.
5. Place UI pages under `apps/<id>/app/pages/apps/<id>/`.

When the app registry (Phase C) lands, manifest declarations drive
runtime enablement. Until then, manifests document the contract.

## Adding a New Channel

1. Create `channels/<id>/` (snake-case, market-suffixed if applicable).
2. Implement `ChannelAdapter` from `@skums/types`.
3. Self-register via `registerChannelAdapter()`.
4. Document quirks in `channels/<id>/README.md`.

See `channels/README.md` for full guidance.
