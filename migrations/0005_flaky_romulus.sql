ALTER TABLE `tenant_configs` ADD `booking_slot_mode` text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `booking_slot_interval_min` integer DEFAULT 30 NOT NULL;