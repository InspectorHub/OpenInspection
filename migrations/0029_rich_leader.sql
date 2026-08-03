ALTER TABLE `inspections` ADD `unlocked_at` integer;--> statement-breakpoint
ALTER TABLE `inspections` ADD `unlocked_by` text;--> statement-breakpoint
ALTER TABLE `inspections` ADD `unlock_reason` text;