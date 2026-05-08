-- Round-2 backlog #2 — Customize Columns (Spectora §5.1, §E.7).
--
-- Per-tenant default for the inspection dashboard column visibility set.
-- New users in the tenant inherit this default until they save their own
-- override in localStorage. Stored as JSON: an array of column ids that are
-- visible (e.g. ["clientName","date","statusIcons","price"]). NULL means
-- "use the registry's default-on set".
--
-- The master column registry lives in TypeScript (see
-- src/lib/dashboard-columns.ts). Migrations don't need to know the column
-- ids — the JSON envelope is open by design.

ALTER TABLE tenant_configs ADD COLUMN dashboard_column_prefs TEXT;
