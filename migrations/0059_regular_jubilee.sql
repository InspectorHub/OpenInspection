-- Retire the legacy template catalogue (#293).
--
-- Its 12 rows moved to marketplace_libraries as kind='templates' in the
-- preceding migration, and tenant_marketplace_imports was 0 rows -- both
-- verified against production immediately before this was written. There is no
-- import history to preserve, which is the entire cost argument for dropping
-- rather than migrating.
--
-- Child first: tenant_marketplace_imports holds the foreign keys, to
-- marketplace_templates AND to `templates`. Dropping it therefore removes an FK
-- liability from `templates` as well -- D1 cannot rebuild a table an FK points
-- at, so this makes `templates` easier to alter for everyone after us.
DROP TABLE IF EXISTS `tenant_marketplace_imports`;--> statement-breakpoint
DROP TABLE IF EXISTS `marketplace_templates`;
