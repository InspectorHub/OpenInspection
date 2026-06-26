CREATE TABLE `messaging_compliance` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'own' NOT NULL,
	`provider` text,
	`subaccount_sid` text,
	`customer_profile_sid` text,
	`customer_profile_status` text,
	`brand_sid` text,
	`brand_status` text,
	`campaign_sid` text,
	`campaign_status` text,
	`tfv_sid` text,
	`tfv_status` text,
	`messaging_service_sid` text,
	`provisioned_number` text,
	`compliance_status` text DEFAULT 'not_started' NOT NULL,
	`rejection_reason` text,
	`last_sync_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `sms_byo_provider` text;