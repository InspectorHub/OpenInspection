-- 0002_add_encrypted_secrets.sql
-- Repairs a 0001_baseline.sql consolidation miss.
--
-- The Secret-UI feature (originally migration 0079, comment in
-- api/src/lib/db/schema/tenant.ts:148-152) introduced
-- `tenant_configs.encrypted_secrets` to hold an AES-256-GCM JSON of
-- the 14 integration API keys configurable via Settings UI. The
-- 2026-05-26 baseline squash dropped this column from the CREATE TABLE
-- even though `api/src/api/secrets.ts` and `BrandingService.updateBranding`
-- still read and write it. Without the column, every first-time INSERT
-- into tenant_configs (i.e. every freshly-onboarded tenant the moment
-- they touch branding, secrets, or the PDF-pipeline toggle) returns a
-- 500 with "no such column: encrypted_secrets".
--
-- Schema declaration is `text('encrypted_secrets')` — nullable, no
-- default — so ALTER TABLE ADD COLUMN without DEFAULT is correct.

ALTER TABLE tenant_configs ADD COLUMN encrypted_secrets TEXT;
