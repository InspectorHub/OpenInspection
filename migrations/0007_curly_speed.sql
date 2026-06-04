CREATE TABLE `email_templates` (
	`tenant_id` text NOT NULL,
	`trigger` text NOT NULL,
	`subject` text,
	`blocks` text,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `trigger`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
