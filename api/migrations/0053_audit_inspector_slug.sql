-- Sprint B-3 — annotate audit_logs with inspector_slug on customer-facing events.
-- Nullable because most events (logins, settings tweaks, library edits) are
-- not inspector-facing. The src/lib/audit.ts allowlist controls write paths.

ALTER TABLE audit_logs ADD COLUMN inspector_slug TEXT;
