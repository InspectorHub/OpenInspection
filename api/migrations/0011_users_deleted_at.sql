-- 0011_users_deleted_at.sql
-- Account soft-delete column for `users` so /api/account/delete can mark an
-- identity as removed without dropping audit-linked rows. NULL = active.

ALTER TABLE users ADD COLUMN deleted_at INTEGER;
CREATE INDEX idx_users_deleted_at ON users(deleted_at);
