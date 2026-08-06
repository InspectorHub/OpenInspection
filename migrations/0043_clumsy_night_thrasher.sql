CREATE TABLE `inspector_service_areas` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`zip_prefix` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_inspector_service_areas_tenant` ON `inspector_service_areas` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_inspector_service_areas_user` ON `inspector_service_areas` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_inspector_service_areas` ON `inspector_service_areas` (`tenant_id`,`user_id`,`zip_prefix`);--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `booking_routing_strategy` text DEFAULT 'first_available' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `booking_min_lead_hours` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `booking_same_day_cutoff_time` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `company_lat` real;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `company_lng` real;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `company_geocoded_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `service_origin_address` text;--> statement-breakpoint
ALTER TABLE `users` ADD `service_origin_lat` real;--> statement-breakpoint
ALTER TABLE `users` ADD `service_origin_lng` real;