-- Email verification, password reset, and phone/SMS verification support.
-- All new columns are nullable / default-safe so existing users are unaffected.
-- Backend routes for these features degrade gracefully (return a clear
-- "not configured" error) until RESEND_API_KEY / TWILIO_* secrets are set —
-- no schema or code changes will be needed once those secrets are added.

ALTER TABLE users ADD COLUMN email_verified    INTEGER NOT NULL DEFAULT 0;  -- 0/1 boolean
ALTER TABLE users ADD COLUMN phone             TEXT;                        -- E.164 format, e.g. +15551234567
ALTER TABLE users ADD COLUMN phone_verified    INTEGER NOT NULL DEFAULT 0;  -- 0/1 boolean

-- Email verification + password-reset tokens (single table, `purpose` distinguishes use)
CREATE TABLE IF NOT EXISTS auth_tokens (
  id           TEXT PRIMARY KEY,             -- UUID (also the token sent to the user, hashed at rest)
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose      TEXT NOT NULL CHECK(purpose IN ('verify_email','reset_password')),
  token_hash   TEXT NOT NULL,                -- SHA-256 hex of the raw token (raw token only ever sent via email, never stored)
  expires_at   TEXT NOT NULL,
  used_at      TEXT,                         -- set once consumed; prevents replay
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Phone OTP codes (Twilio Verify handles code generation/expiry server-side when configured;
-- this table exists as a fallback path + audit trail and to rate-limit send attempts)
CREATE TABLE IF NOT EXISTS phone_verifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','failed','expired')),
  twilio_sid   TEXT,                         -- Twilio Verify VerificationSid, for audit/debug
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user     ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_purpose  ON auth_tokens(purpose);
CREATE INDEX IF NOT EXISTS idx_phone_verif_user     ON phone_verifications(user_id);
