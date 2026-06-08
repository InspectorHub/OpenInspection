CREATE TABLE `agreement_signers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`request_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'client' NOT NULL,
	`contact_id` text,
	`token_hash` text,
	`token_enc` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`signature_base64` text,
	`signed_at` integer,
	`viewed_at` integer,
	`ip_address` text,
	`user_agent` text,
	`channel` text,
	`on_behalf_of` text,
	`on_behalf_disclaimer` text,
	`last_reminded_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agreement_signers_tenant_request` ON `agreement_signers` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agreement_signers_request_email` ON `agreement_signers` (`request_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agreement_signers_token_hash` ON `agreement_signers` (`token_hash`);--> statement-breakpoint
ALTER TABLE `agreement_requests` ADD `content_snapshot` text;--> statement-breakpoint
ALTER TABLE `agreement_requests` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `agreement_requests` ADD `completion_policy` text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE `agreement_requests` ADD `token_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agreement_requests_token_hash` ON `agreement_requests` (`token_hash`);--> statement-breakpoint
ALTER TABLE `concierge_confirm_tokens` ADD `token_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_concierge_confirm_token_hash` ON `concierge_confirm_tokens` (`token_hash`);--> statement-breakpoint
ALTER TABLE `concierge_invites` ADD `token_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_concierge_invites_token_hash` ON `concierge_invites` (`token_hash`);--> statement-breakpoint
ALTER TABLE `guest_invites` ADD `token_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_guest_invites_token_hash` ON `guest_invites` (`token_hash`);--> statement-breakpoint
ALTER TABLE `inspection_access_tokens` ADD `token_hash` text;--> statement-breakpoint
ALTER TABLE `inspection_access_tokens` ADD `token_enc` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_iat_token_hash` ON `inspection_access_tokens` (`token_hash`);--> statement-breakpoint
ALTER TABLE `observer_links` ADD `token_hash` text;--> statement-breakpoint
ALTER TABLE `observer_links` ADD `token_enc` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_observer_links_token_hash` ON `observer_links` (`token_hash`);--> statement-breakpoint
INSERT INTO agreement_signers (id, tenant_id, request_id, name, email, role, status, signature_base64, signed_at, viewed_at, created_at)
SELECT lower(hex(randomblob(16))), tenant_id, id,
       COALESCE(NULLIF(client_name, ''), NULLIF(client_email, ''), 'Client'),
       client_email, 'client', status, signature_base64,
       CASE WHEN signed_at IS NOT NULL THEN signed_at * 1000 ELSE NULL END,
       CASE WHEN viewed_at IS NOT NULL THEN viewed_at * 1000 ELSE NULL END,
       CAST(strftime('%s','now') AS INTEGER) * 1000
FROM agreement_requests;
--> statement-breakpoint
-- signed/declined/expired rows intentionally keep content_snapshot NULL: back-dating
-- the CURRENT template text as "what was signed" would be fabrication. The verifier
-- renders a "snapshot predates this feature" notice for them instead.
UPDATE agreement_requests
SET content_snapshot = (SELECT a.content FROM agreements a WHERE a.id = agreement_requests.agreement_id)
WHERE status IN ('pending','sent','viewed') AND content_snapshot IS NULL;