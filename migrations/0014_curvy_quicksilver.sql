PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_automation_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`automation_id` text,
	`inspection_id` text NOT NULL,
	`recipient` text NOT NULL,
	`recipient_role_key` text,
	`channel` text DEFAULT 'email' NOT NULL,
	`send_at` integer NOT NULL,
	`delivered_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`event_id` text,
	`recipient_contact_id` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_automation_logs`("id", "tenant_id", "automation_id", "inspection_id", "recipient", "recipient_role_key", "channel", "send_at", "delivered_at", "status", "error", "event_id", "recipient_contact_id") SELECT "id", "tenant_id", "automation_id", "inspection_id", "recipient", "recipient_role_key", "channel", "send_at", "delivered_at", "status", "error", "event_id", "recipient_contact_id" FROM `automation_logs`;--> statement-breakpoint
DROP TABLE `automation_logs`;--> statement-breakpoint
ALTER TABLE `__new_automation_logs` RENAME TO `automation_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_automation_logs_pending` ON `automation_logs` (`tenant_id`,`status`,`send_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_logs_insp` ON `automation_logs` (`inspection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_automation_logs_event` ON `automation_logs` (`automation_id`,`inspection_id`,`event_id`,`channel`,`recipient`) WHERE event_id IS NOT NULL;