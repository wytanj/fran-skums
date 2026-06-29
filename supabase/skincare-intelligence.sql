-- ============================================================
-- SKUMS — Skincare Intelligence: Ingredient Analysis & Product Scoring
-- Run AFTER: product-quality-v2.sql
-- ============================================================

-- ── 1. External Products (discovered via crawling Hwahae / Olive Young) ──

CREATE TABLE IF NOT EXISTS external_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source text NOT NULL,                -- 'hwahae' | 'oliveyoung'
  source_product_id text NOT NULL,     -- ID on source platform
  source_url text,
  product_name text NOT NULL,
  brand_name text,
  category text,                       -- e.g. 'skincare', 'makeup'
  subcategory text,                    -- e.g. 'serum', 'moisturizer', 'cleanser'
  price numeric(12,4),
  currency text NOT NULL DEFAULT 'USD',
  volume text,                         -- '60ml', '200ml', '50g'
  rating numeric(3,2),                 -- 0.00–5.00
  review_count integer,
  ingredients text[],                  -- INCI names array (parsed)
  ingredients_raw text,                -- Full ingredients string as displayed on source
  skin_type_ratings jsonb,             -- {"dry":4.5,"oily":3.2,"combination":4.1,"sensitive":3.8,"acne":3.0}
  concerns text[],                     -- ['hydration','soothing','brightening',...]
  certifications text[],               -- ['vegan','cruelty_free','organic',...]
  awards text[],                       -- ['hall_of_fame','best_new_2025','rising',...]
  image_url text,

  -- Computed skincare scores (populated by scoring engine)
  ips_score numeric(4,1),              -- Ingredient Profile Score 0–100
  skin_type_fit jsonb,                 -- {"dry":0.9,"oily":0.2,...} computed from ingredients
  concern_tags text[],                 -- computed from ingredient analysis
  top_tier_ingredient text,            -- highest-tier active found: 'tier1','tier2','tier3','tier4'
  lifecycle_stage text,                -- 'launch','rising','mature','hall_of_fame','declining','revived'
  ingredient_trend_signal text,        -- 'rising','stable','declining' (best ingredient trend)
  conflict_flags jsonb,                -- [{family:'formaldehyde_releasers',ingredients:['DMDM Hydantoin']}]

  crawled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_ext_source CHECK (source IN ('hwahae', 'oliveyoung')),
  UNIQUE (workspace_id, source, source_product_id)
);

CREATE INDEX IF NOT EXISTS idx_ext_products_workspace
  ON external_products(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ext_products_source
  ON external_products(workspace_id, source);
CREATE INDEX IF NOT EXISTS idx_ext_products_ips
  ON external_products(workspace_id, ips_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ext_products_category
  ON external_products(workspace_id, category, subcategory);

ALTER TABLE external_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ext_products_select" ON external_products
  FOR SELECT USING (workspace_id IN (SELECT get_my_workspace_ids()));
CREATE POLICY "ext_products_insert" ON external_products
  FOR INSERT WITH CHECK (workspace_id IN (SELECT get_my_writable_workspace_ids()));
CREATE POLICY "ext_products_update" ON external_products
  FOR UPDATE USING (workspace_id IN (SELECT get_my_writable_workspace_ids()));


-- ── 2. Skincare Crawl Jobs ──────────────────────────────────

CREATE TABLE IF NOT EXISTS skincare_crawl_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source text NOT NULL,
  job_type text NOT NULL DEFAULT 'full_catalog',
  status text NOT NULL DEFAULT 'pending',
  categories_to_crawl text[],          -- which subcategories to process
  total_products integer DEFAULT 0,
  processed_products integer DEFAULT 0,
  failed_products integer DEFAULT 0,
  current_category text,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_crawl_source CHECK (source IN ('hwahae', 'oliveyoung')),
  CONSTRAINT chk_crawl_type CHECK (job_type IN ('full_catalog', 'category', 'single_product', 'bestsellers')),
  CONSTRAINT chk_crawl_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_crawl_jobs_workspace
  ON skincare_crawl_jobs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status
  ON skincare_crawl_jobs(status) WHERE status IN ('pending', 'running');

ALTER TABLE skincare_crawl_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crawl_jobs_select" ON skincare_crawl_jobs
  FOR SELECT USING (workspace_id IN (SELECT get_my_workspace_ids()));
CREATE POLICY "crawl_jobs_insert" ON skincare_crawl_jobs
  FOR INSERT WITH CHECK (workspace_id IN (SELECT get_my_writable_workspace_ids()));
CREATE POLICY "crawl_jobs_update" ON skincare_crawl_jobs
  FOR UPDATE USING (workspace_id IN (SELECT get_my_writable_workspace_ids()));


-- ── 3. Ingredient Safety Reference (global, not workspace-scoped) ────

CREATE TABLE IF NOT EXISTS ingredient_safety (
  inci_name text PRIMARY KEY,
  common_names text[],
  ewg_score integer,                   -- 1–10 (EWG hazard)
  tier text,                           -- promoted: 'tier1','tier2','tier3','tier4'; flagged: 'avoid','caution','watch'
  function text,                       -- 'active','preservative','surfactant','emollient','humectant','uv_filter','antioxidant','emulsifier','fragrance','colorant','solvent'
  concerns_addressed text[],           -- ['hydration','anti_aging','brightening',...]
  mechanism text,
  trend text DEFAULT 'stable',         -- 'rising','stable','declining'
  ips_penalty integer DEFAULT 0,       -- penalty for "avoid" ingredients (negative value applied)
  ips_bonus integer DEFAULT 0,         -- bonus for proven actives
  is_hwahae_blacklisted boolean DEFAULT false,
  regulatory_notes text,
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT chk_ingredient_tier CHECK (tier IN ('tier1','tier2','tier3','tier4','avoid','caution','watch'))
);


-- ── 4. Ingredient Conflict Families ─────────────────────────

CREATE TABLE IF NOT EXISTS ingredient_conflict_families (
  id text PRIMARY KEY,
  family_name text NOT NULL,
  conflict_type text NOT NULL,         -- 'cross_sensitivity' | 'usage_conflict'
  description text,
  severity text NOT NULL,              -- 'high','moderate','low'

  CONSTRAINT chk_conflict_type CHECK (conflict_type IN ('cross_sensitivity', 'usage_conflict')),
  CONSTRAINT chk_conflict_severity CHECK (severity IN ('high', 'moderate', 'low'))
);

CREATE TABLE IF NOT EXISTS ingredient_conflict_members (
  family_id text NOT NULL REFERENCES ingredient_conflict_families(id) ON DELETE CASCADE,
  inci_name text NOT NULL,
  common_name text,
  notes text,
  PRIMARY KEY (family_id, inci_name)
);


-- ── 5. Pairwise Usage Conflicts (retinol + AHA, etc.) ──────

CREATE TABLE IF NOT EXISTS ingredient_pairwise_conflicts (
  ingredient_a text NOT NULL,
  ingredient_b text NOT NULL,
  conflict_type text NOT NULL,         -- 'irritation','deactivation','ph_incompatible','over_exfoliation'
  severity text NOT NULL,              -- 'avoid','caution','separate_routines'
  resolution text,                     -- 'alternate nights','AM/PM split','never combine'
  PRIMARY KEY (ingredient_a, ingredient_b)
);


-- ── 6. Skincare Concerns Taxonomy ───────────────────────────

CREATE TABLE IF NOT EXISTS skincare_concerns (
  id text PRIMARY KEY,
  label text NOT NULL,
  key_ingredients text[],
  sort_order integer DEFAULT 0
);


-- ── 7. Views ────────────────────────────────────────────────

-- Top products by IPS score per source
CREATE OR REPLACE VIEW v_external_products_scored AS
SELECT
  ep.*,
  COALESCE(array_length(ep.ingredients, 1), 0) AS ingredient_count,
  COALESCE(array_length(ep.concerns, 1), 0) AS concern_count,
  CASE
    WHEN ep.ips_score >= 85 THEN 'clean'
    WHEN ep.ips_score >= 60 THEN 'standard'
    WHEN ep.ips_score >= 30 THEN 'caution'
    ELSE 'avoid'
  END AS ips_category
FROM external_products ep
ORDER BY ep.ips_score DESC NULLS LAST;

-- Crawl job summary
CREATE OR REPLACE VIEW v_crawl_job_summary AS
SELECT
  cj.*,
  CASE
    WHEN cj.total_products > 0
    THEN ROUND((cj.processed_products::numeric / cj.total_products) * 100, 1)
    ELSE 0
  END AS progress_pct,
  (SELECT COUNT(*) FROM external_products ep
   WHERE ep.workspace_id = cj.workspace_id AND ep.source = cj.source) AS total_crawled_products
FROM skincare_crawl_jobs cj
ORDER BY cj.created_at DESC;

-- Ingredient conflict lookup: given an ingredient, find all conflicts
CREATE OR REPLACE VIEW v_ingredient_conflicts AS
SELECT
  icm.inci_name,
  icf.id AS family_id,
  icf.family_name,
  icf.conflict_type,
  icf.severity,
  icf.description,
  -- All other members of the same family
  (SELECT array_agg(m2.inci_name)
   FROM ingredient_conflict_members m2
   WHERE m2.family_id = icf.id AND m2.inci_name != icm.inci_name
  ) AS cross_reactive_with
FROM ingredient_conflict_members icm
JOIN ingredient_conflict_families icf ON icf.id = icm.family_id;
