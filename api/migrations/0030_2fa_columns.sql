-- Spec 4A — TOTP 2FA columns on users table.
-- Per-user opt-in. totpEnabled is the source of truth for whether 2FA is required at login.
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_recovery_codes TEXT;
ALTER TABLE users ADD COLUMN totp_verified_at INTEGER;
