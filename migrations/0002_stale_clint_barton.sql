ALTER TABLE `agreement_signers` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `agreement_signers` ADD `revoked_at` integer;--> statement-breakpoint
ALTER TABLE `repair_requests` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `repair_requests` ADD `revoked_at` integer;