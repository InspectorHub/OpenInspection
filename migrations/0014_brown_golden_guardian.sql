ALTER TABLE `contacts` ADD `archived_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contacts_tenant_email` ON `contacts` (`tenant_id`,`email`) WHERE email IS NOT NULL AND archived_at IS NULL;--> statement-breakpoint
ALTER TABLE `inspections` ADD `client_contact_id` text;