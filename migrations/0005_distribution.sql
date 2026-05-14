-- ── Distribution Engine — Migration 0005 ─────────────────────────────────
-- Tables: social_accounts, distribution_posts, post_metrics

-- Connected OAuth accounts (one per platform per user)
CREATE TABLE IF NOT EXISTS social_accounts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL CHECK(platform IN ('instagram','youtube')),
  account_id   TEXT NOT NULL,
  handle       TEXT NOT NULL,
  avatar_url   TEXT,
  access_token TEXT NOT NULL,   -- AES-256-GCM encrypted
  refresh_token TEXT,           -- AES-256-GCM encrypted
  token_expiry TEXT,            -- ISO datetime
  scopes       TEXT,            -- space-separated scope list
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, platform)
);

-- Scheduled / posted / failed distribution items
CREATE TABLE IF NOT EXISTS distribution_posts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
  account_id      TEXT REFERENCES social_accounts(id) ON DELETE SET NULL,
  platform        TEXT NOT NULL CHECK(platform IN ('instagram','youtube')),
  video_url       TEXT NOT NULL,
  caption         TEXT,
  title           TEXT,          -- YouTube only
  tags            TEXT,          -- JSON array, YouTube only
  hashtags        TEXT,          -- JSON array, Instagram only
  cover_url       TEXT,          -- thumbnail / cover image URL
  scheduled_at    TEXT,          -- ISO datetime; NULL = post immediately
  posted_at       TEXT,          -- set when platform confirms publish
  status          TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK(status IN ('scheduled','posting','posted','failed','cancelled')),
  platform_post_id TEXT,         -- ID returned by platform after publish
  error_message   TEXT,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Performance metrics pulled 24h + 72h after posting
CREATE TABLE IF NOT EXISTS post_metrics (
  id           TEXT PRIMARY KEY,
  post_id      TEXT NOT NULL REFERENCES distribution_posts(id) ON DELETE CASCADE,
  pulled_at    TEXT NOT NULL DEFAULT (datetime('now')),
  pull_window  TEXT NOT NULL CHECK(pull_window IN ('24h','72h')),
  views        INTEGER DEFAULT 0,
  likes        INTEGER DEFAULT 0,
  comments     INTEGER DEFAULT 0,
  shares       INTEGER DEFAULT 0,
  reach        INTEGER DEFAULT 0,
  saves        INTEGER DEFAULT 0,
  UNIQUE(post_id, pull_window)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_social_accounts_user     ON social_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_dist_posts_user          ON distribution_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_dist_posts_status        ON distribution_posts(status);
CREATE INDEX IF NOT EXISTS idx_dist_posts_scheduled     ON distribution_posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_dist_posts_project       ON distribution_posts(project_id);
CREATE INDEX IF NOT EXISTS idx_post_metrics_post        ON post_metrics(post_id);
