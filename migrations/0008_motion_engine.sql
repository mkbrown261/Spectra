-- Motion Composition Engine — camera-movement sequences + beats,
-- attachable to Video Generator shots via motion_strength/prompt.
CREATE TABLE IF NOT EXISTS motion_sequences (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  mood               TEXT,                       -- optional genre/mood tag (e.g. "tense chase")
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS motion_beats (
  id                 TEXT PRIMARY KEY,
  sequence_id        TEXT NOT NULL REFERENCES motion_sequences(id) ON DELETE CASCADE,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  camera_move        TEXT NOT NULL,               -- catalog id, e.g. 'push_in', 'orbit_left'
  intensity          INTEGER NOT NULL DEFAULT 5,  -- 1-10 -> maps to Higgsfield motion_strength
  duration_sec       INTEGER NOT NULL DEFAULT 5,
  notes              TEXT,                        -- freeform description / AI reasoning
  shot_id            TEXT REFERENCES shots(id) ON DELETE SET NULL,  -- optional link to a generated shot
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_motion_seq_project ON motion_sequences(project_id);
CREATE INDEX IF NOT EXISTS idx_motion_seq_user    ON motion_sequences(user_id);
CREATE INDEX IF NOT EXISTS idx_motion_beats_seq    ON motion_beats(sequence_id);
