ALTER TABLE `inspection_units` ADD `attrs` text;--> statement-breakpoint
ALTER TABLE `inspections` ADD `unit_inspection_mode` text DEFAULT 'tagged' NOT NULL;--> statement-breakpoint
ALTER TABLE `inspections` ADD `location_options` text;--> statement-breakpoint
ALTER TABLE `inspections` ADD `sampling_declaration` text;