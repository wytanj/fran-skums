-- ============================================================
-- Product Quality v2: Scraping support, queue, payments, history
-- Run AFTER: product-quality.sql
-- ============================================================

-- ── 1. Add data_source to snapshots ─────────────────────────

ALTER TABLE product_quality_snapshots
  ADD COLUMN IF NOT EXISTS data_source text NOT NULL DEFAULT 'ai_estimated';

-- Add check constraint (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_snapshot_data_source'
  ) THEN
    ALTER TABLE product_quality_snapshots
      ADD CONSTRAINT chk_snapshot_data_source
      CHECK (data_source IN ('scraped', 'ai_estimated'));
  END IF;
END $$;

-- ── 2. Add scrape_error to snapshots ────────────────────────

ALTER TABLE product_quality_snapshots
  ADD COLUMN IF NOT EXISTS scrape_error text;

-- ── 3. Scrape queue for free-tier overnight processing ──────

CREATE TABLE IF NOT EXISTS scrape_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  priority int NOT NULL DEFAULT 0,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error text,

  CONSTRAINT chk_scrape_queue_status
    CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

-- Index for efficient queue processing
CREATE INDEX IF NOT EXISTS idx_scrape_queue_pending
  ON scrape_queue(status, priority DESC, queued_at)
  WHERE status = 'pending';

-- Prevent duplicate pending entries for the same product
CREATE UNIQUE INDEX IF NOT EXISTS idx_scrape_queue_unique_pending
  ON scrape_queue(workspace_id, product_id)
  WHERE status = 'pending';

-- RLS
ALTER TABLE scrape_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scrape_queue_select" ON scrape_queue
  FOR SELECT USING (workspace_id IN (SELECT get_my_workspace_ids()));

CREATE POLICY "scrape_queue_insert" ON scrape_queue
  FOR INSERT WITH CHECK (workspace_id IN (SELECT get_my_writable_workspace_ids()));

-- ── 4. x402 payment receipts ────────────────────────────────

CREATE TABLE IF NOT EXISTS quality_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  payment_type text NOT NULL,
  product_ids uuid[] NOT NULL,
  amount_usdc numeric(10,4) NOT NULL,
  tx_hash text,
  network text NOT NULL DEFAULT 'base',
  payer_address text,
  status text NOT NULL DEFAULT 'verified',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_payment_type CHECK (payment_type IN ('instant', 'bulk')),
  CONSTRAINT chk_payment_status CHECK (status IN ('pending', 'verified', 'failed', 'refunded'))
);

-- RLS
ALTER TABLE quality_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quality_payments_select" ON quality_payments
  FOR SELECT USING (workspace_id IN (SELECT get_my_workspace_ids()));

CREATE POLICY "quality_payments_insert" ON quality_payments
  FOR INSERT WITH CHECK (workspace_id IN (SELECT get_my_writable_workspace_ids()));

-- ── 5. Price history view ───────────────────────────────────

CREATE OR REPLACE VIEW v_price_history AS
SELECT
  workspace_id,
  product_id,
  marketplace,
  price,
  currency,
  rating,
  review_count,
  availability,
  data_source,
  crawled_at
FROM product_quality_snapshots
WHERE found = true
  AND price IS NOT NULL
ORDER BY crawled_at DESC;

-- ── 6. Queue summary view ───────────────────────────────────

CREATE OR REPLACE VIEW v_scrape_queue_summary AS
SELECT
  sq.workspace_id,
  sq.product_id,
  sq.status,
  sq.priority,
  sq.queued_at,
  sq.completed_at,
  sq.error,
  p.title AS product_title,
  p.sku AS product_sku
FROM scrape_queue sq
JOIN products p ON p.id = sq.product_id
ORDER BY
  CASE sq.status
    WHEN 'processing' THEN 0
    WHEN 'pending' THEN 1
    WHEN 'failed' THEN 2
    WHEN 'completed' THEN 3
  END,
  sq.priority DESC,
  sq.queued_at ASC;
