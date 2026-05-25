-- Design System 0520 subsystem C phase 10 — team-page defaults toggles.
--
-- Three booleans surfaced as switches on the new /team Defaults section.
-- All default OFF so existing tenants opt in deliberately.
--   team_mode_default          — new inspections start with team_mode = 1
--   apprentice_review_required — apprentice writes always go to the queue
--                                regardless of force-mode on the editor
--   guest_invites_enabled      — toggles the InviteSeatModal "Guest" tab
ALTER TABLE tenant_configs ADD COLUMN team_mode_default          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_configs ADD COLUMN apprentice_review_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_configs ADD COLUMN guest_invites_enabled      INTEGER NOT NULL DEFAULT 1;
