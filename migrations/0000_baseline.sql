CREATE TABLE `agreement_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text,
	`agreement_id` text NOT NULL,
	`client_email` text NOT NULL,
	`client_name` text,
	`token` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`signature_base64` text,
	`signed_at` integer,
	`viewed_at` integer,
	`sent_at` integer,
	`last_error` text,
	`inspector_signature_base64` text,
	`inspector_signed_at` integer,
	`inspector_user_id` text,
	`verification_token` text,
	`content_snapshot` text,
	`content_hash` text,
	`completion_policy` text DEFAULT 'all' NOT NULL,
	`token_hash` text,
	`purged_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspection_id`) REFERENCES `inspections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agreement_id`) REFERENCES `agreements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspector_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agreement_requests_token_unique` ON `agreement_requests` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agreement_requests_verify_token` ON `agreement_requests` (`verification_token`);--> statement-breakpoint
CREATE INDEX `idx_agreement_requests_tenant` ON `agreement_requests` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_agreement_requests_inspection` ON `agreement_requests` (`inspection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agreement_requests_token_hash` ON `agreement_requests` (`token_hash`);--> statement-breakpoint
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
CREATE TABLE `agreements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_agreements_tenant` ON `agreements` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `apprentice_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`apprentice_id` text NOT NULL,
	`mentor_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`item_id` text NOT NULL,
	`field` text NOT NULL,
	`proposed_value` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`decision_value` text,
	`decision_at` integer,
	`submitted_at` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `apprentice_reviews_mentor_status_idx` ON `apprentice_reviews` (`tenant_id`,`mentor_id`,`status`);--> statement-breakpoint
CREATE INDEX `apprentice_reviews_inspection_item_idx` ON `apprentice_reviews` (`inspection_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `apprentice_reviews_apprentice_idx` ON `apprentice_reviews` (`apprentice_id`,`status`);--> statement-breakpoint
CREATE TABLE `automation_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`automation_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`recipient` text NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`send_at` text NOT NULL,
	`delivered_at` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`event_id` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_automation_logs_pending` ON `automation_logs` (`tenant_id`,`status`,`send_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_logs_insp` ON `automation_logs` (`inspection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_automation_logs_event` ON `automation_logs` (`automation_id`,`inspection_id`,`event_id`) WHERE event_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`trigger` text NOT NULL,
	`recipient` text NOT NULL,
	`delay_minutes` integer DEFAULT 0 NOT NULL,
	`subject_template` text NOT NULL,
	`body_template` text NOT NULL,
	`conditions` text,
	`channels` text DEFAULT '["email"]' NOT NULL,
	`sms_body` text,
	`active` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_automations_tenant` ON `automations` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `availability` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspector_id` text NOT NULL,
	`day_of_week` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspector_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_availability_inspector` ON `availability` (`inspector_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_availability_window_unique` ON `availability` (`inspector_id`,`day_of_week`,`start_time`);--> statement-breakpoint
CREATE TABLE `availability_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspector_id` text NOT NULL,
	`date` text NOT NULL,
	`is_available` integer DEFAULT false NOT NULL,
	`start_time` text,
	`end_time` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspector_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_avail_overrides_insp` ON `availability_overrides` (`inspector_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_avail_overrides_block_unique` ON `availability_overrides` (`inspector_id`,`date`) WHERE is_available = 0;--> statement-breakpoint
CREATE TABLE `comment_usage` (
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`comment_id` text NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	PRIMARY KEY(`tenant_id`, `user_id`, `comment_id`),
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_comment_usage_user_last_used` ON `comment_usage` (`tenant_id`,`user_id`,`last_used_at`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`text` text NOT NULL,
	`category` text,
	`rating_bucket` text,
	`section` text,
	`library_id` text,
	`section_ids` text,
	`item_labels` text,
	`trigger_code` text,
	`search_keywords` text,
	`item_label` text,
	`severity` text,
	`repair_summary` text,
	`estimate_min_cents` integer,
	`estimate_max_cents` integer,
	`recommended_contractor_type_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_comments_tenant` ON `comments` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_comments_rating_bucket` ON `comments` (`tenant_id`,`rating_bucket`);--> statement-breakpoint
CREATE INDEX `idx_comments_library_id` ON `comments` (`library_id`);--> statement-breakpoint
CREATE TABLE `commercial_subtypes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`based_on` text,
	`description` text,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_commercial_subtypes_tenant_name` ON `commercial_subtypes` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `concierge_bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`confirmation_token` text NOT NULL,
	`tenant_id` text NOT NULL,
	`invite_token` text NOT NULL,
	`slot_start` text NOT NULL,
	`slot_end` text NOT NULL,
	`contact_name` text NOT NULL,
	`contact_email` text NOT NULL,
	`contact_phone` text,
	`address` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concierge_bookings_confirmation_token_unique` ON `concierge_bookings` (`confirmation_token`);--> statement-breakpoint
CREATE TABLE `concierge_confirm_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`inspection_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`client_email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`confirmed_at` integer,
	`token_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`inspection_id`) REFERENCES `inspections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_concierge_tokens_expiry` ON `concierge_confirm_tokens` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_concierge_confirm_token_hash` ON `concierge_confirm_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `concierge_invites` (
	`token` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspector_id` text,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`token_hash` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_concierge_invites_token_hash` ON `concierge_invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`type` text DEFAULT 'client' NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`agency` text,
	`notes` text,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_contacts_type` ON `contacts` (`tenant_id`,`type`);--> statement-breakpoint
CREATE INDEX `idx_contacts_tenant` ON `contacts` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contacts_tenant_email` ON `contacts` (`tenant_id`,`email`) WHERE email IS NOT NULL AND archived_at IS NULL;--> statement-breakpoint
CREATE TABLE `contractor_types` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_contractor_types_tenant` ON `contractor_types` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `customer_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`from_role` text NOT NULL,
	`from_name` text,
	`body` text NOT NULL,
	`attachments` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspection_id`) REFERENCES `inspections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_msg_inspection` ON `customer_messages` (`inspection_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_msg_unread` ON `customer_messages` (`tenant_id`,`inspection_id`,`from_role`) WHERE "customer_messages"."read_at" IS NULL;--> statement-breakpoint
CREATE TABLE `discount_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`type` text NOT NULL,
	`value` integer NOT NULL,
	`max_uses` integer,
	`uses_count` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_discount_codes_tenant` ON `discount_codes` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `discount_codes_code_tenant` ON `discount_codes` (upper(code),`tenant_id`);--> statement-breakpoint
CREATE TABLE `erasure_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`subject_email` text NOT NULL,
	`requested_by` text,
	`identity_basis` text,
	`status` text NOT NULL,
	`decisions_json` text NOT NULL,
	`retained_count` integer DEFAULT 0 NOT NULL,
	`anonymized_count` integer DEFAULT 0 NOT NULL,
	`deleted_count` integer DEFAULT 0 NOT NULL,
	`response_note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_erasure_log_tenant` ON `erasure_log` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `esign_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`request_id` text NOT NULL,
	`event` text NOT NULL,
	`payload_json` text NOT NULL,
	`prev_hash` text,
	`hash` text NOT NULL,
	`signature` text NOT NULL,
	`key_fingerprint` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_esign_audit_logs_request` ON `esign_audit_logs` (`tenant_id`,`request_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_esign_audit_logs_event_dedup` ON `esign_audit_logs` (`tenant_id`,`request_id`,`event`) WHERE event NOT LIKE 'signer.%';--> statement-breakpoint
CREATE TABLE `event_types` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`default_duration_min` integer DEFAULT 30 NOT NULL,
	`default_price_cents` integer DEFAULT 0 NOT NULL,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_types_tenant_slug_idx` ON `event_types` (`tenant_id`,`slug`);--> statement-breakpoint
CREATE TABLE `guest_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`token` text NOT NULL,
	`role` text NOT NULL,
	`duration_seconds` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_by_user_id` text,
	`claimed_at` integer,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`token_hash` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guest_invites_token_unique` ON `guest_invites` (`token`);--> statement-breakpoint
CREATE INDEX `guest_invites_tenant_idx` ON `guest_invites` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_guest_invites_token_hash` ON `guest_invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `inspection_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`recipient_email` text NOT NULL,
	`role` text DEFAULT 'client' NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`token_hash` text,
	`token_enc` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_iat_token` ON `inspection_access_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `idx_iat_inspection` ON `inspection_access_tokens` (`tenant_id`,`inspection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_iat_recipient` ON `inspection_access_tokens` (`inspection_id`,`recipient_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_iat_token_hash` ON `inspection_access_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `inspection_agreements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`signature_base64` text NOT NULL,
	`signed_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspection_id`) REFERENCES `inspections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_insp_agreements_tenant` ON `inspection_agreements` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_insp_agreements_insp` ON `inspection_agreements` (`inspection_id`);--> statement-breakpoint
CREATE TABLE `inspection_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`item_id` text NOT NULL,
	`section_id` text,
	`field` text NOT NULL,
	`base` text,
	`local` text,
	`remote` text,
	`created_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_inspection_conflicts_inspection` ON `inspection_conflicts` (`inspection_id`,`resolved_at`);--> statement-breakpoint
CREATE TABLE `inspection_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`event_type_id` text NOT NULL,
	`inspector_id` text,
	`scheduled_at` integer NOT NULL,
	`duration_min` integer NOT NULL,
	`price_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`notes` text,
	`completed_at` integer,
	`results_received_at` integer,
	`cancelled_at` integer,
	`gcal_event_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspection_id`) REFERENCES `inspections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_type_id`) REFERENCES `event_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspector_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inspection_events_scheduled_idx` ON `inspection_events` (`tenant_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `inspection_events_inspection_idx` ON `inspection_events` (`inspection_id`);--> statement-breakpoint
CREATE TABLE `inspection_inspectors` (
	`inspection_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`role` text DEFAULT 'lead' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`inspection_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_insp_inspectors_tenant_user` ON `inspection_inspectors` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_insp_inspectors_user` ON `inspection_inspectors` (`user_id`);--> statement-breakpoint
CREATE TABLE `inspection_item_tag_links` (
	`inspection_id` text NOT NULL,
	`item_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`inspection_id`, `item_id`, `tag_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_tag_links_tenant` ON `inspection_item_tag_links` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_tag_links_tag` ON `inspection_item_tag_links` (`tag_id`);--> statement-breakpoint
CREATE INDEX `idx_tag_links_inspection_item` ON `inspection_item_tag_links` (`inspection_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `inspection_media_pool` (
	`id` text PRIMARY KEY NOT NULL,
	`inspection_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`url` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	`exif_data` text,
	`annotations` text,
	`caption` text
);
--> statement-breakpoint
CREATE INDEX `idx_media_pool_tenant` ON `inspection_media_pool` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_media_pool_inspection` ON `inspection_media_pool` (`inspection_id`);--> statement-breakpoint
CREATE TABLE `inspection_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_name` text NOT NULL,
	`client_email` text,
	`client_phone` text,
	`property_address` text NOT NULL,
	`property_city` text,
	`property_state` text,
	`property_zip` text,
	`scheduled_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`notes` text,
	`total_amount_cents` integer DEFAULT 0 NOT NULL,
	`payment_status` text DEFAULT 'unpaid' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_inspection_requests_tenant` ON `inspection_requests` (`tenant_id`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `idx_inspection_requests_email` ON `inspection_requests` (`tenant_id`,`client_email`);--> statement-breakpoint
CREATE TABLE `inspection_results` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`data` text NOT NULL,
	`last_synced_at` integer NOT NULL,
	`rating_system_id` text,
	`rating_system_snapshot` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspection_id`) REFERENCES `inspections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_results_tenant` ON `inspection_results` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_results_inspection` ON `inspection_results` (`inspection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_results_inspection` ON `inspection_results` (`inspection_id`);--> statement-breakpoint
CREATE TABLE `inspection_services` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`service_id` text NOT NULL,
	`price_override_cents` integer,
	`name_snapshot` text NOT NULL,
	`price_snapshot_cents` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspection_id`) REFERENCES `inspections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_insp_services_tenant` ON `inspection_services` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_insp_services_insp` ON `inspection_services` (`inspection_id`);--> statement-breakpoint
CREATE TABLE `inspection_units` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`parent_unit_id` text,
	`kind` text NOT NULL,
	`type` text DEFAULT 'unit' NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inspection_units_tenant_inspection_idx` ON `inspection_units` (`tenant_id`,`inspection_id`);--> statement-breakpoint
CREATE INDEX `inspection_units_parent_idx` ON `inspection_units` (`parent_unit_id`);--> statement-breakpoint
CREATE TABLE `inspections` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspector_id` text,
	`property_address` text NOT NULL,
	`address_place_id` text,
	`address_street` text,
	`address_city` text,
	`address_state` text,
	`address_zip` text,
	`address_county` text,
	`address_lat` real,
	`address_lng` real,
	`address_geocoded_at` integer,
	`client_contact_id` text,
	`client_name` text,
	`client_email` text,
	`client_phone` text,
	`template_id` text,
	`date` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`payment_status` text DEFAULT 'unpaid' NOT NULL,
	`referred_by_agent_id` text,
	`price_cents` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`confirmed_at` text,
	`cancel_reason` text,
	`cancel_notes` text,
	`payment_required` integer DEFAULT false NOT NULL,
	`agreement_required` integer DEFAULT false NOT NULL,
	`auto_sign_on_publish` integer DEFAULT false NOT NULL,
	`discount_code_id` text,
	`discount_amount_cents` integer,
	`closing_date` text,
	`referral_source` text,
	`order_id` text,
	`internal_notes` text,
	`year_built` integer,
	`sqft` integer,
	`foundation_type` text,
	`bedrooms` integer,
	`bathrooms` real,
	`lot_size` text,
	`property_facts` text,
	`cover_photo_id` text,
	`unit` text,
	`property_type` text,
	`commercial_subtype` text,
	`county` text,
	`selling_agent_id` text,
	`disable_automations` integer DEFAULT false NOT NULL,
	`message_token` text,
	`template_snapshot` text,
	`template_snapshot_version` integer DEFAULT 1,
	`report_theme_override` text,
	`require_defect_fields_override` text,
	`request_id` text,
	`concierge_status` text,
	`team_mode` integer DEFAULT false NOT NULL,
	`lead_inspector_id` text,
	`helper_inspector_ids` text DEFAULT '[]' NOT NULL,
	`data_version` integer DEFAULT 0 NOT NULL,
	`source_inspection_id` text,
	`root_inspection_id` text,
	`reinspection_round` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspector_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`discount_code_id`) REFERENCES `discount_codes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`selling_agent_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`) REFERENCES `inspection_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inspections_msg_token` ON `inspections` (`message_token`);--> statement-breakpoint
CREATE INDEX `idx_inspections_tenant` ON `inspections` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_inspections_request` ON `inspections` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_inspections_inspector` ON `inspections` (`inspector_id`);--> statement-breakpoint
CREATE INDEX `idx_inspections_agent` ON `inspections` (`referred_by_agent_id`);--> statement-breakpoint
CREATE INDEX `idx_inspections_tenant_status` ON `inspections` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_inspections_tenant_date` ON `inspections` (`tenant_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_inspections_tenant_client_email` ON `inspections` (`tenant_id`,`client_email`);--> statement-breakpoint
CREATE INDEX `idx_inspections_inspector_date` ON `inspections` (`inspector_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_inspections_root` ON `inspections` (`root_inspection_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text,
	`contact_id` text,
	`client_name` text,
	`client_email` text,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`line_items` text DEFAULT '[]' NOT NULL,
	`due_date` text,
	`notes` text,
	`sent_at` integer,
	`paid_at` integer,
	`payment_method` text,
	`partial_paid_at` integer,
	`qbo_sync_status` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspection_id`) REFERENCES `inspections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_invoices_tenant` ON `invoices` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_invoices_inspection` ON `invoices` (`inspection_id`);--> statement-breakpoint
CREATE INDEX `idx_invoices_contact` ON `invoices` (`tenant_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `marketplace_libraries` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`semver` text NOT NULL,
	`schema` text NOT NULL,
	`author_id` text DEFAULT 'system' NOT NULL,
	`changelog` text,
	`download_count` integer DEFAULT 0 NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_marketplace_libraries_kind_featured` ON `marketplace_libraries` (`kind`,`featured`);--> statement-breakpoint
CREATE TABLE `marketplace_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`semver` text NOT NULL,
	`schema` text NOT NULL,
	`author_id` text DEFAULT 'system' NOT NULL,
	`changelog` text,
	`download_count` integer DEFAULT 0 NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `observer_links` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`token` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_viewed_at` integer,
	`token_hash` text,
	`token_enc` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observer_links_token_unique` ON `observer_links` (`token`);--> statement-breakpoint
CREATE INDEX `observer_links_inspection_idx` ON `observer_links` (`inspection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_observer_links_token_hash` ON `observer_links` (`token_hash`);--> statement-breakpoint
CREATE TABLE `qbo_connections` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`realm_id` text NOT NULL,
	`company_name` text,
	`access_token_enc` text NOT NULL,
	`refresh_token_enc` text NOT NULL,
	`token_expires_at` integer NOT NULL,
	`refresh_token_expires_at` integer NOT NULL,
	`last_sync_at` integer,
	`sync_enabled` integer DEFAULT true NOT NULL,
	`default_item_id` text DEFAULT '1' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `qbo_entity_map` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`oi_type` text NOT NULL,
	`oi_id` text NOT NULL,
	`qbo_type` text NOT NULL,
	`qbo_id` text NOT NULL,
	`qbo_sync_token` text NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_qbo_entity_map_qbo` ON `qbo_entity_map` (`tenant_id`,`qbo_type`,`qbo_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_qbo_entity_map_oi` ON `qbo_entity_map` (`tenant_id`,`oi_type`,`oi_id`);--> statement-breakpoint
CREATE TABLE `qbo_sync_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`oi_type` text NOT NULL,
	`oi_id` text NOT NULL,
	`error_code` text NOT NULL,
	`error_msg` text NOT NULL,
	`retries` integer DEFAULT 0 NOT NULL,
	`resolved` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rating_systems` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`levels` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_seed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rating_systems_tenant_slug` ON `rating_systems` (`tenant_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_rating_systems_tenant` ON `rating_systems` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `report_pdfs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`type` text NOT NULL,
	`r2_key` text NOT NULL,
	`rendered_at` integer NOT NULL,
	`source_version` integer NOT NULL,
	`version_number` integer,
	`size_bytes` integer,
	`status` text DEFAULT 'ready' NOT NULL,
	`error` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_report_pdfs_inspection_type` ON `report_pdfs` (`inspection_id`,`type`,`version_number`);--> statement-breakpoint
CREATE INDEX `idx_report_pdfs_tenant` ON `report_pdfs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_report_pdfs_status` ON `report_pdfs` (`status`);--> statement-breakpoint
CREATE TABLE `report_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`summary` text,
	`content_hash` text,
	`prev_hash` text,
	`signature` text,
	`key_fingerprint` text,
	`is_amendment` integer DEFAULT false NOT NULL,
	`verification_token` text,
	`published_at` integer NOT NULL,
	`published_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `report_versions_inspection_idx` ON `report_versions` (`inspection_id`,`version_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `report_versions_inspection_version_unique` ON `report_versions` (`inspection_id`,`version_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_report_versions_verify_token` ON `report_versions` (`verification_token`);--> statement-breakpoint
CREATE TABLE `service_inspectors` (
	`service_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`service_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_service_inspectors_tenant` ON `service_inspectors` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price_cents` integer NOT NULL,
	`duration_minutes` integer,
	`template_id` text,
	`agreement_id` text,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agreement_id`) REFERENCES `agreements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_services_tenant` ON `services` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `signing_keys` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key_enc` text NOT NULL,
	`private_key_iv` text NOT NULL,
	`fingerprint` text NOT NULL,
	`algorithm` text DEFAULT 'Ed25519' NOT NULL,
	`created_at` integer NOT NULL,
	`rotated_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sms_consent_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`recipient_type` text NOT NULL,
	`action` text NOT NULL,
	`disclosure_version` integer NOT NULL,
	`captured_via` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sms_consent_contact` ON `sms_consent_log` (`tenant_id`,`contact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sms_disclosure_versions` (
	`version` integer PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`published_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`is_seed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tags_tenant_name` ON `tags` (`tenant_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_tags_tenant` ON `tags` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`schema` text NOT NULL,
	`created_at` integer NOT NULL,
	`rating_system_id` text,
	`property_type` text,
	`commercial_subtype` text,
	`description` text,
	`featured` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_templates_tenant` ON `templates` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_templates_rating_system` ON `templates` (`rating_system_id`);--> statement-breakpoint
CREATE TABLE `tenant_library_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`library_id` text NOT NULL,
	`imported_semver` text NOT NULL,
	`imported_at` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_library_import` ON `tenant_library_imports` (`tenant_id`,`library_id`);--> statement-breakpoint
CREATE INDEX `idx_tenant_library_imports_tenant` ON `tenant_library_imports` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `tenant_marketplace_import_history` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`library_id` text,
	`template_id` text,
	`action` text NOT NULL,
	`source_version` text,
	`target_version` text,
	`rows_affected` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_marketplace_history_tenant` ON `tenant_marketplace_import_history` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_marketplace_history_template` ON `tenant_marketplace_import_history` (`template_id`);--> statement-breakpoint
CREATE INDEX `idx_marketplace_history_library` ON `tenant_marketplace_import_history` (`library_id`);--> statement-breakpoint
CREATE TABLE `tenant_marketplace_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`marketplace_template_id` text NOT NULL,
	`imported_semver` text NOT NULL,
	`local_template_id` text NOT NULL,
	`imported_at` text NOT NULL,
	FOREIGN KEY (`marketplace_template_id`) REFERENCES `marketplace_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`local_template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_mkt_imports_tmpl` ON `tenant_marketplace_imports` (`marketplace_template_id`);--> statement-breakpoint
CREATE INDEX `idx_mkt_imports_tenant` ON `tenant_marketplace_imports` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`tenant_id` text NOT NULL,
	`metric` text NOT NULL,
	`period_key` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `metric`, `period_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_usage_counters_tenant` ON `usage_counters` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `user_identity_links` (
	`id` text PRIMARY KEY NOT NULL,
	`primary_user_id` text NOT NULL,
	`linked_user_id` text NOT NULL,
	`linked_tenant_id` text NOT NULL,
	`linked_role` text NOT NULL,
	`linked_display_name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_identity_links_primary_idx` ON `user_identity_links` (`primary_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_identity_links_primary_linked_unique` ON `user_identity_links` (`primary_user_id`,`linked_user_id`);--> statement-breakpoint
CREATE TABLE `agent_invites` (
	`token` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspector_contact_id` text,
	`email` text NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_agent_invites_email` ON `agent_invites` (`email`);--> statement-breakpoint
CREATE INDEX `idx_agent_invites_tenant` ON `agent_invites` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_invites_expiration` ON `agent_invites` (`expires_at`);--> statement-breakpoint
CREATE TABLE `agent_tenant_links` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`inspector_contact_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`invited_by_user_id` text,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`agent_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_tenant_unique` ON `agent_tenant_links` (`agent_user_id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_tenant_by_tenant` ON `agent_tenant_links` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_tenant_by_agent` ON `agent_tenant_links` (`agent_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`metadata` text,
	`ip_address` text,
	`inspector_slug` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_tenant_created` ON `audit_logs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_entity` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`entity_type` text,
	`entity_id` text,
	`metadata` text,
	`read_at` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_tenant_user_created` ON `notifications` (`tenant_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_tenant_user_unread` ON `notifications` (`tenant_id`,`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `parked_cmd_events` (
	`id` text PRIMARY KEY NOT NULL,
	`envelope` text NOT NULL,
	`reason` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_parked_cmd_events_received_at` ON `parked_cmd_events` (`received_at`);--> statement-breakpoint
CREATE TABLE `processed_cmd_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`cmd_type` text NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slug_reservations` (
	`slug` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`last_tried_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `idx_sync_outbox_status_created` ON `sync_outbox` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `tenant_configs` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`site_name` text,
	`primary_color` text,
	`logo_url` text,
	`support_email` text,
	`sender_email` text,
	`reply_to` text,
	`email_mode` text DEFAULT 'platform' NOT NULL,
	`sms_mode` text DEFAULT 'platform' NOT NULL,
	`sender_display_name` text,
	`use_inspector_from_name` integer DEFAULT false NOT NULL,
	`billing_url` text,
	`review_url` text,
	`company_phone` text,
	`integration_config` text,
	`encrypted_secrets` text,
	`dek_enc` text,
	`ics_token` text,
	`widget_allowed_origins` text,
	`report_theme` text DEFAULT 'modern' NOT NULL,
	`attention_thresholds` text DEFAULT '{"agreement_unsigned_h":72,"invoice_overdue_h":72,"report_unpublished_h":72}' NOT NULL,
	`inspection_prefs` text,
	`show_estimates` integer DEFAULT false NOT NULL,
	`enable_repair_list` integer DEFAULT false NOT NULL,
	`enable_customer_repair_export` integer DEFAULT false NOT NULL,
	`block_unpaid` integer DEFAULT false NOT NULL,
	`block_unsigned_agreement` integer DEFAULT false NOT NULL,
	`custom_referral_sources` text,
	`dashboard_column_prefs` text,
	`concierge_review_required` integer DEFAULT false NOT NULL,
	`allow_inspector_choice` integer DEFAULT false NOT NULL,
	`enable_pdf_pipeline` integer DEFAULT false NOT NULL,
	`team_mode_default` integer DEFAULT false NOT NULL,
	`apprentice_review_required` integer DEFAULT false NOT NULL,
	`guest_invites_enabled` integer DEFAULT true NOT NULL,
	`require_defect_fields` text DEFAULT 'none' NOT NULL,
	`agreement_retention_years` integer DEFAULT 6 NOT NULL,
	`reinspection_statuses` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tenant_destruction_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tenant_slug` text,
	`rows_deleted` integer DEFAULT 0 NOT NULL,
	`r2_objects` integer DEFAULT 0 NOT NULL,
	`r2_bytes` integer DEFAULT 0 NOT NULL,
	`kv_keys` integer DEFAULT 0 NOT NULL,
	`destroyed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_destruction_tenant` ON `tenant_destruction_records` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_destruction_destroyed_at` ON `tenant_destruction_records` (`destroyed_at`);--> statement-breakpoint
CREATE TABLE `tenant_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'inspector' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`mentor_id` text,
	`assigned_section_ids` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_invites_tenant` ON `tenant_invites` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_invites_pending_email` ON `tenant_invites` (`tenant_id`,`email`) WHERE status = 'pending';--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`tier` text DEFAULT 'free' NOT NULL,
	`stripe_connect_account_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`max_users` integer DEFAULT 5 NOT NULL,
	`deployment_mode` text DEFAULT 'shared' NOT NULL,
	`nachi_number` text,
	`applied_cmd_seq` integer DEFAULT 0 NOT NULL,
	`applied_cred_seq` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_unique` ON `tenants` (`slug`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text,
	`phone` text,
	`license_number` text,
	`photo_url` text,
	`default_signature_base64` text,
	`bio` text,
	`service_areas` text,
	`slug` text,
	`role` text DEFAULT 'admin' NOT NULL,
	`google_refresh_token` text,
	`google_calendar_id` text,
	`onboarding_state` text,
	`created_at` integer NOT NULL,
	`totp_secret` text,
	`totp_enabled` integer DEFAULT false NOT NULL,
	`totp_recovery_codes` text,
	`totp_verified_at` integer,
	`notify_on_referral` integer DEFAULT true NOT NULL,
	`notify_on_report` integer DEFAULT true NOT NULL,
	`notify_on_paid` integer DEFAULT false NOT NULL,
	`last_active_at` integer,
	`mentor_id` text,
	`assigned_section_ids` text DEFAULT '[]' NOT NULL,
	`expires_at` integer,
	`deleted_at` integer,
	`terms_accepted` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_users_deleted_at` ON `users` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_tenant_email_unique` ON `users` (`tenant_id`,`email`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_users_tenant` ON `users` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_slug_per_tenant` ON `users` (`tenant_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);