-- Sprint 3 Track B (S3-2) — Customer-driven Repair Request export.
--
-- When enable_customer_repair_export = 1, the public report viewer surfaces
-- a "Generate repair request" link that takes the customer (the recipient
-- of the report) to a print-friendly repair-request page they can hand off
-- to a contractor or email back to themselves. Distinct from the inspector-
-- facing repair list (Track E1, migration 0044): that list is for inspectors
-- and realtors, this list is for the homeowner/buyer.
--
-- Defaults to 0 so existing tenants don't surface the new affordance until
-- they explicitly opt in via Settings → Workspace → Reports.

ALTER TABLE tenant_configs ADD COLUMN enable_customer_repair_export INTEGER NOT NULL DEFAULT 0;
