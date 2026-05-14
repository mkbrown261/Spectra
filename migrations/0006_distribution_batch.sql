-- Migration 0006 — batch support for distribution_posts
ALTER TABLE distribution_posts ADD COLUMN batch_id TEXT;
ALTER TABLE distribution_posts ADD COLUMN batch_position INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_dist_posts_batch ON distribution_posts(batch_id);
