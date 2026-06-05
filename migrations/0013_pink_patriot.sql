DROP INDEX `users_tenant_email_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_tenant_email_unique` ON `users` (`tenant_id`,`email`) WHERE deleted_at IS NULL;