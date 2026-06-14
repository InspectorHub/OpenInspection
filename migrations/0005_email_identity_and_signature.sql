ALTER TABLE `tenant_configs` ADD `point_of_contact` text DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `signature_enabled` integer DEFAULT true NOT NULL;