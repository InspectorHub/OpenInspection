-- The unified catalogue's shape (#293).
--
-- marketplace_libraries gains three nullable browse axes, because the legacy
-- `category` on the retiring template catalogue was free text mixing three
-- independent concepts: a property type, a jurisdiction's form standard, and an
-- inspection kind. One column could only ever describe one of the three.
--
-- tenant_library_imports gains a nullable local_entity_id so a 1:1 kind (one
-- catalogue row becomes one local `templates` row, tracked by that row's id) and
-- a 1:N kind (one pack becomes N tagged `comments` rows, tracked by row_count)
-- can share one tracking table.
--
-- The `kind` enum change ('snippets' out, 'templates' in) is type-layer only in
-- drizzle and correctly emits no DDL here. A production SELECT confirmed no row
-- holds 'snippets'.
--
-- Four ADD COLUMNs and nothing else: neither table is FK-referenced, so a table
-- rebuild here would mean something unintended changed.
ALTER TABLE `marketplace_libraries` ADD `property_type` text;--> statement-breakpoint
ALTER TABLE `marketplace_libraries` ADD `jurisdiction` text;--> statement-breakpoint
ALTER TABLE `marketplace_libraries` ADD `inspection_kind` text;--> statement-breakpoint
ALTER TABLE `tenant_library_imports` ADD `local_entity_id` text;
