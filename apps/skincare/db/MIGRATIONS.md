# Skincare Intelligence — Database Migrations

Run AFTER all `core/db/` migrations.

| # | File | Domain | Notes |
|---|------|--------|-------|
| 001 | skincare_intelligence.sql | Core skincare tables | `external_products`, `skincare_crawl_jobs`, `ingredient_safety`, `ingredient_conflict_families`, `ingredient_conflict_members`, `ingredient_pairwise_conflicts`, `skincare_concerns` + 3 views |
| 002 | skincare_seed.sql | Reference data seeds | Hwahae taxonomy, ingredient safety tiers (1-4 + avoid/caution/watch), conflict families, pairwise conflicts |

## Dependencies

- Requires `core/db/001_workspaces.sql` (for `workspaces` FK)
- Requires `core/db/020_product_quality_v2.sql` (per the original SQL header note: "Run AFTER: product-quality-v2.sql")

## Tables Created

**Workspace-scoped (RLS-gated):**
- `external_products` — crawled product catalog
- `skincare_crawl_jobs` — crawl job tracking

**Global reference data (read-only for users):**
- `ingredient_safety` — INCI ingredient reference (tier, EWG score, IPS penalty/bonus)
- `ingredient_conflict_families` + `ingredient_conflict_members` — cross-sensitivity families
- `ingredient_pairwise_conflicts` — usage conflicts
- `skincare_concerns` — Hwahae concern taxonomy

**Views:**
- `v_external_products_scored`
- `v_crawl_job_summary`
- `v_ingredient_conflicts`
