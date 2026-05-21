-- 2026-05-20 — Trial Sample-Data Mode spec
--
-- Adds users.signup_role (per-user ICP signal captured at magic-link signup).
-- No tenant-level mode flag is added (the spec simplified to "no sample-data
-- mode" — trial tenants ship with starter content only, no banner/flag).
--
-- Nullable: NULL for pre-migration users and for teammates joining via
-- team invite (only the tenant owner answers the role survey at signup).

ALTER TABLE users ADD COLUMN signup_role TEXT;
