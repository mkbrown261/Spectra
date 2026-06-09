-- Platform OAuth connections (YouTube, Bluesky, etc.)
CREATE TABLE IF NOT EXISTS platform_connections (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL,
  platform         TEXT NOT NULL,           -- 'youtube', 'bluesky', 'instagram'
  access_token_enc TEXT NOT NULL,
  access_token_iv  TEXT NOT NULL,
  refresh_token_enc TEXT,
  refresh_token_iv  TEXT,
  channel_id       TEXT,                    -- YouTube channel ID / Bluesky DID
  channel_name     TEXT,                    -- YouTube channel name / Bluesky handle
  connected_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_platform_connections_user ON platform_connections(user_id);
