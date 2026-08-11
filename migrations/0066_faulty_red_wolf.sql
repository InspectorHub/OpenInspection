ALTER TABLE `automation_logs` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `automation_logs` ADD `last_attempt_at` integer;