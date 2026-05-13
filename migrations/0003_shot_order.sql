-- ═══════════════════════════════════════════════════════════════════
-- Spectra — Shot Sort Order
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE shots ADD COLUMN sort_order INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_shots_sort ON shots(project_id, sort_order);
