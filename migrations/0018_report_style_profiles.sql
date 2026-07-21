-- Report Style Presets (Plan 1a) — repurpose the inert report_theme plumbing
-- into the data-driven appearance-profile engine.
--
-- tenant_configs.report_theme (text NOT NULL DEFAULT 'modern', enum modern|classic|
-- minimal) becomes tenant_configs.default_profile_id (text NOT NULL DEFAULT
-- 'signature', open-ended profile id). A plain RENAME COLUMN would keep the old
-- 'modern' default (SQLite cannot ALTER a column default), which drifts from the
-- schema's 'signature' default; tenant_configs is NOT an FK target, so ADD + DROP
-- is D1-safe here and lands the correct default. The old enum values
-- (modern|classic|minimal) are none of signature|meridian|terra, so every legacy
-- row simply adopts the 'signature' default.
ALTER TABLE `tenant_configs` ADD `default_profile_id` text DEFAULT 'signature' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `report_theme`;--> statement-breakpoint
-- inspections is FK-referenced (no rebuild): RENAME is metadata-only, and the two
-- new tweak columns are plain appends at the table end.
ALTER TABLE `inspections` RENAME COLUMN `report_theme_override` TO `profile_override`;--> statement-breakpoint
ALTER TABLE `inspections` ADD `badge_layout_override` text;--> statement-breakpoint
ALTER TABLE `inspections` ADD `report_photo_columns` integer;--> statement-breakpoint
-- templates gains an optional default appearance profile per report type.
ALTER TABLE `templates` ADD `default_profile_id` text;