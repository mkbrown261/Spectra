-- ═══════════════════════════════════════════════════════════════════
-- Spectra — Initial Schema
-- ═══════════════════════════════════════════════════════════════════

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,          -- UUID
  email       TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,           -- bcrypt hash
  tier        TEXT NOT NULL DEFAULT 'free', -- free | creator | studio | pro
  credits     INTEGER NOT NULL DEFAULT 10,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- API KEYS (encrypted at rest — AES-256-GCM, never returned to client)
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,            -- higgsfield | openai
  encrypted_key TEXT NOT NULL,           -- AES-256-GCM encrypted, base64
  iv           TEXT NOT NULL,            -- GCM IV, base64
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, provider)
);

-- PROJECTS (persistent creative memory)
CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  style_bible  TEXT,                     -- JSON: tone, mood, visual_style, color_palette, references
  default_provider TEXT NOT NULL DEFAULT 'higgsfield',
  default_model    TEXT NOT NULL DEFAULT 'higgsfield-ai/dop/preview',
  thumbnail_url    TEXT,
  shot_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CHARACTERS (persistent character memory per project)
CREATE TABLE IF NOT EXISTS characters (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  ref_image_url TEXT,                    -- R2 URL
  soul_id      TEXT,                     -- Higgsfield SoulId for consistency
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- SHOTS (every generated clip)
CREATE TABLE IF NOT EXISTS shots (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_raw       TEXT NOT NULL,        -- what user typed
  prompt_enhanced  TEXT,                 -- GPT-4o enhanced version
  provider         TEXT NOT NULL,        -- higgsfield
  model            TEXT NOT NULL,
  aspect_ratio     TEXT NOT NULL DEFAULT '16:9',
  duration         INTEGER DEFAULT 5,
  hf_request_id    TEXT,                 -- Higgsfield request_id for polling
  status           TEXT NOT NULL DEFAULT 'pending', -- pending|queued|in_progress|completed|failed|nsfw
  video_url        TEXT,                 -- R2 permanent URL (after copy)
  hf_video_url     TEXT,                 -- raw Higgsfield URL (temporary)
  thumbnail_url    TEXT,
  error_message    TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at     TEXT
);

-- SESSION TOKENS (JWT alternative — simple server-side sessions)
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,           -- random token
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_projects_user    ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_shots_project    ON shots(project_id);
CREATE INDEX IF NOT EXISTS idx_shots_user       ON shots(user_id);
CREATE INDEX IF NOT EXISTS idx_shots_status     ON shots(status);
CREATE INDEX IF NOT EXISTS idx_shots_hf_req     ON shots(hf_request_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user    ON api_keys(user_id);
