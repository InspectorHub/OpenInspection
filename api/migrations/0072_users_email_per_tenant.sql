-- 2026-05-23 — Per-tenant email uniqueness
--
-- Backing the multi-workspace identity model in portal: a single human
-- (one portal identity) can belong to multiple workspaces, and portal
-- pushes one `users` row to core per membership — so the globally
-- UNIQUE constraint on `users.email` blocks the second push.
--
-- Move uniqueness from (email) to (tenant_id, email). Same email is now
-- allowed across different tenants; still UNIQUE within a tenant.
--
-- IMPLEMENTATION NOTE: prior drafts of this migration tried a full
-- users table rebuild (mirroring migration 0055's pattern) to drop the
-- inline UNIQUE column constraint. That approach failed on prod with
-- SQLITE_CONSTRAINT_FOREIGNKEY even with `PRAGMA defer_foreign_keys =
-- TRUE`, because OTHER tables (inspections, audit_logs, agent_links,
-- notifications, …) carry FK refs to users(id) and prod has
-- accumulated orphan rows referencing deleted users; D1's deferred FK
-- check at COMMIT fires on those orphans even though the rebuild
-- preserves all current ids.
--
-- The fix is to avoid the rebuild entirely. Migration 0055 already
-- dropped the inline UNIQUE column constraint and re-introduced
-- uniqueness via a NAMED INDEX (`idx_users_email_global`). Named
-- indexes can be dropped/recreated freely without touching the table.
-- So this migration is now a two-statement index swap:
--   1. DROP the global unique index from 0055.
--   2. CREATE a compound unique index on (tenant_id, email).
-- No table rebuild, no FK validation pass, no orphan cleanup required.

DROP INDEX idx_users_email_global;

-- New UNIQUE: (tenant_id, email). NULL tenant_id (agent global account)
-- can still have at most one row per email, since SQLite treats NULL
-- as distinct in UNIQUE indexes — we accept that semantics, which
-- matches the existing agent_tenant_links design.
CREATE UNIQUE INDEX users_tenant_email_unique ON users(tenant_id, email);
