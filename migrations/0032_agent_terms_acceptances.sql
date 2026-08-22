CREATE TABLE `agent_terms_acceptances` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`doc` text NOT NULL,
	`version` text NOT NULL,
	`content_hash` text NOT NULL,
	`accepted_at` integer NOT NULL,
	`ip` text,
	`country` text
);
--> statement-breakpoint
CREATE INDEX `idx_agent_terms_acceptances_user` ON `agent_terms_acceptances` (`user_id`,`accepted_at`);