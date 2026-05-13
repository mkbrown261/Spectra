-- ═══════════════════════════════════════════════════════════════════
-- Spectra — Campaigns (H-6 fix: move campaigns out of localStorage)
-- ═══════════════════════════════════════════════════════════════════

-- CAMPAIGNS table
CREATE TABLE IF NOT EXISTS campaigns (
  id          TEXT PRIMARY KEY,              -- UUID
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Add campaign_id FK to projects
ALTER TABLE projects ADD COLUMN campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaigns_user       ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_campaign    ON projects(campaign_id);
