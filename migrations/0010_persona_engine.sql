-- Persona Engine — Brand Voice Profile Builder.
-- A persona is a reusable, structured "voice" definition (tone, vocabulary,
-- do's/don'ts, example lines) that the AI applies when rewriting/generating
-- copy across the suite (Video Generator prompts, Attention Engine hooks/
-- rewrites, Distribution Engine captions). This is intentionally decoupled
-- from a single project's `style_bible` (which is visual/cinematic) —
-- a persona is about voice/tone and can be attached to many projects.

CREATE TABLE IF NOT EXISTS personas (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  archetype          TEXT,                        -- e.g. "The Mentor", "The Rebel", "The Best Friend"
  tone_traits        TEXT,                        -- JSON array of short trait tags, e.g. ["witty","direct","warm"]
  vocabulary_notes    TEXT,                        -- freeform: words/phrases to use or avoid
  audience_summary   TEXT,                        -- who this voice is speaking to
  example_lines      TEXT,                        -- JSON array of sample lines in-voice (few-shot for the AI)
  is_default         INTEGER NOT NULL DEFAULT 0,   -- 0/1 — one persona per user can be marked default
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Attach a persona to a project (many projects can share one persona)
ALTER TABLE projects ADD COLUMN persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL;

-- Log of AI "voice-apply" transformations (input text -> persona-voiced output),
-- kept so users can see history / reuse a past rewrite without re-calling the AI.
CREATE TABLE IF NOT EXISTS persona_applications (
  id           TEXT PRIMARY KEY,
  persona_id   TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_text  TEXT NOT NULL,
  output_text  TEXT NOT NULL,
  context      TEXT,                              -- e.g. "video_prompt", "caption", "hook", "general"
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_personas_user            ON personas(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_persona         ON projects(persona_id);
CREATE INDEX IF NOT EXISTS idx_persona_apps_persona     ON persona_applications(persona_id);
CREATE INDEX IF NOT EXISTS idx_persona_apps_user        ON persona_applications(user_id);
