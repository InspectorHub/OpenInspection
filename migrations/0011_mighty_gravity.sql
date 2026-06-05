DROP INDEX `idx_agreement_requests_token`;--> statement-breakpoint
DROP INDEX `guest_invites_token_idx`;--> statement-breakpoint
DROP INDEX `idx_inspections_status`;--> statement-breakpoint
CREATE INDEX `idx_inspections_tenant_status` ON `inspections` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_inspections_tenant_date` ON `inspections` (`tenant_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_inspections_tenant_client_email` ON `inspections` (`tenant_id`,`client_email`);--> statement-breakpoint
CREATE INDEX `idx_inspections_inspector_date` ON `inspections` (`inspector_id`,`date`);--> statement-breakpoint
DROP INDEX `observer_links_token_idx`;--> statement-breakpoint
CREATE INDEX `idx_templates_tenant` ON `templates` (`tenant_id`);