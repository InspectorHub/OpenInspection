-- Migration: 0019_google_calendar_ics
-- Adds ICS subscription token to tenant_configs.
-- Also adds google_access_token + google_token_expiry to users (used by calendar-events.ts).

ALTER TABLE tenant_configs ADD COLUMN ics_token TEXT;
ALTER TABLE users ADD COLUMN google_access_token TEXT;
ALTER TABLE users ADD COLUMN google_token_expiry  INTEGER;
