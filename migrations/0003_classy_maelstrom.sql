PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tenant_configs` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`company_name` text,
	`primary_color` text,
	`logo_url` text,
	`support_email` text,
	`company_address` text,
	`pdf_show_footer` integer DEFAULT true NOT NULL,
	`pdf_show_page_numbers` integer DEFAULT true NOT NULL,
	`pdf_show_license` integer DEFAULT true NOT NULL,
	`sender_email` text,
	`reply_to` text,
	`email_mode` text DEFAULT 'platform' NOT NULL,
	`video_mode` text DEFAULT 'r2' NOT NULL,
	`sms_mode` text DEFAULT 'platform' NOT NULL,
	`sender_display_name` text,
	`point_of_contact` text DEFAULT 'company' NOT NULL,
	`billing_url` text,
	`review_url` text,
	`company_phone` text,
	`integration_config` text,
	`secrets_enc` text,
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
	`collab_editing` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tenant_configs`("tenant_id", "company_name", "primary_color", "logo_url", "support_email", "company_address", "pdf_show_footer", "pdf_show_page_numbers", "pdf_show_license", "sender_email", "reply_to", "email_mode", "video_mode", "sms_mode", "sender_display_name", "point_of_contact", "billing_url", "review_url", "company_phone", "integration_config", "secrets_enc", "dek_enc", "ics_token", "widget_allowed_origins", "report_theme", "attention_thresholds", "inspection_prefs", "show_estimates", "enable_repair_list", "enable_customer_repair_export", "block_unpaid", "block_unsigned_agreement", "custom_referral_sources", "dashboard_column_prefs", "concierge_review_required", "allow_inspector_choice", "enable_pdf_pipeline", "team_mode_default", "apprentice_review_required", "guest_invites_enabled", "require_defect_fields", "agreement_retention_years", "reinspection_statuses", "collab_editing", "updated_at") SELECT "tenant_id", "company_name", "primary_color", "logo_url", "support_email", "company_address", "pdf_show_footer", "pdf_show_page_numbers", "pdf_show_license", "sender_email", "reply_to", "email_mode", "video_mode", "sms_mode", "sender_display_name", "point_of_contact", "billing_url", "review_url", "company_phone", "integration_config", "secrets_enc", "dek_enc", "ics_token", "widget_allowed_origins", "report_theme", "attention_thresholds", "inspection_prefs", "show_estimates", "enable_repair_list", "enable_customer_repair_export", "block_unpaid", "block_unsigned_agreement", "custom_referral_sources", "dashboard_column_prefs", "concierge_review_required", "allow_inspector_choice", "enable_pdf_pipeline", "team_mode_default", "apprentice_review_required", "guest_invites_enabled", "require_defect_fields", "agreement_retention_years", "reinspection_statuses", "collab_editing", "updated_at" FROM `tenant_configs`;--> statement-breakpoint
DROP TABLE `tenant_configs`;--> statement-breakpoint
ALTER TABLE `__new_tenant_configs` RENAME TO `tenant_configs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- #181 Phase 5 data migration: flip already-provisioned tenants ON to match the
-- new collab-ON default. The table rebuild above copies existing collab_editing
-- values verbatim, so existing rows would otherwise stay at their old 0. One-time
-- pre-launch flip; explicit per-tenant opt-out (back to 0) still works afterwards.
UPDATE `tenant_configs` SET `collab_editing` = 1 WHERE `collab_editing` = 0 OR `collab_editing` IS NULL;