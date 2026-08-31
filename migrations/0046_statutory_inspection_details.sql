CREATE TABLE `statutory_inspection_details` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`inspector_signature_date` text,
	`employee_printed_name` text,
	`owner_name` text,
	`owner_email` text,
	`owner_mailing_address` text,
	`owner_home_phone` text,
	`owner_work_phone` text,
	`owner_cell_phone` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_statutory_inspection_details_subject` ON `statutory_inspection_details` (`tenant_id`,`inspection_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `statutory_license_type` text;--> statement-breakpoint
ALTER TABLE `users` ADD `statutory_qualification` text;