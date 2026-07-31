-- Naming rule: boolean columns are `is_`/`has_` prefixed (`lint:naming`).
--
-- `notification_preferences` shipped on this branch with a bare `enabled`, and
-- the gate that would have caught it runs only in the full lint, never at the
-- commit gate — so it went unnoticed for a dozen commits.
--
-- RENAME, not drop-and-add: D1 rebuilds a table to drop a column, and a rebuild
-- is the operation this repository has already been bitten by. The drizzle
-- PROPERTY stays `enabled`, so no call site and no API field moves.
ALTER TABLE `notification_preferences` RENAME COLUMN `enabled` TO `is_enabled`;
