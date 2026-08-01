-- Backfill: the state license becomes a credential row.
--
-- `users.license_number` predates `inspector_credentials` and is still the only
-- source of the license line on two surfaces (the email signature footer and the
-- PDF footer). Retiring the column is a separate, later step; this migration
-- makes the data available in the new shape FIRST, so those surfaces can be
-- moved over without any window in which an inspector's license silently
-- vanishes from a document.
--
-- sort_order = -1, not 0: the state license is the one credential with legal
-- weight, and it should not land wherever insertion order happens to put it
-- among voluntary association badges.
--
-- IDEMPOTENT. The NOT EXISTS guard keys on (tenant, user, member_number), so a
-- re-run after a partial failure inserts nothing — the only kind of data
-- migration worth writing for a table this small.
--
-- Soft-deleted users are skipped: their license is not going on anything.
INSERT INTO inspector_credentials
  (id, tenant_id, user_id, label, member_number, image_r2_key, sort_order, is_active, created_at, updated_at)
SELECT
  lower(
    substr(hex(randomblob(4)), 1, 8) || '-' ||
    substr(hex(randomblob(2)), 1, 4) || '-4' ||
    substr(hex(randomblob(2)), 2, 3) || '-a' ||
    substr(hex(randomblob(2)), 2, 3) || '-' ||
    substr(hex(randomblob(6)), 1, 12)
  ),
  u.tenant_id,
  u.id,
  'Licensed home inspector',   -- the string the old renderer hard-coded
  u.license_number,
  NULL,                        -- text-only; a state license has no badge image
  -1,
  1,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM users u
WHERE u.license_number IS NOT NULL
  AND trim(u.license_number) <> ''
  AND u.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM inspector_credentials c
    WHERE c.tenant_id = u.tenant_id
      AND c.user_id = u.id
      AND c.member_number = u.license_number
  );
