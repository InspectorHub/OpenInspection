-- Boolean column naming normalization (#227): every boolean SQL column is
-- renamed to the is_/has_ predicate convention. Data-preserving native SQLite
-- RENAME COLUMN (no table rebuild, no FK-drop risk on D1). The Drizzle JS
-- property names are unchanged, so no consumer code moves with this migration.
-- Old→new map: [redacted]
ALTER TABLE `commercial_subtypes` RENAME COLUMN `disabled` TO `is_disabled`;
ALTER TABLE `messaging_compliance` RENAME COLUMN `sender_attached` TO `has_sender_attached`;
ALTER TABLE `automations` RENAME COLUMN `active` TO `is_active`;
ALTER TABLE `event_types` RENAME COLUMN `active` TO `is_active`;
ALTER TABLE `inspection_types` RENAME COLUMN `enabled` TO `is_enabled`;
ALTER TABLE `inspections` RENAME COLUMN `payment_required` TO `is_payment_required`;
ALTER TABLE `inspections` RENAME COLUMN `agreement_required` TO `is_agreement_required`;
ALTER TABLE `inspections` RENAME COLUMN `auto_sign_on_publish` TO `is_auto_sign_on_publish`;
ALTER TABLE `inspections` RENAME COLUMN `disable_automations` TO `is_automations_disabled`;
ALTER TABLE `inspections` RENAME COLUMN `team_mode` TO `is_team_mode`;
ALTER TABLE `defect_categories` RENAME COLUMN `drives_summary` TO `is_summary_driver`;
ALTER TABLE `services` RENAME COLUMN `active` TO `is_active`;
ALTER TABLE `discount_codes` RENAME COLUMN `active` TO `is_active`;
ALTER TABLE `templates` RENAME COLUMN `featured` TO `is_featured`;
ALTER TABLE `marketplace_templates` RENAME COLUMN `featured` TO `is_featured`;
ALTER TABLE `marketplace_libraries` RENAME COLUMN `featured` TO `is_featured`;
ALTER TABLE `report_signoff` RENAME COLUMN `dual_role` TO `is_dual_role`;
ALTER TABLE `document_review_items` RENAME COLUMN `requested` TO `is_requested`;
ALTER TABLE `document_review_items` RENAME COLUMN `received` TO `is_received`;
ALTER TABLE `document_review_items` RENAME COLUMN `reviewed` TO `is_reviewed`;
ALTER TABLE `document_review_items` RENAME COLUMN `na` TO `is_na`;
ALTER TABLE `qbo_connections` RENAME COLUMN `sync_enabled` TO `is_sync_enabled`;
ALTER TABLE `qbo_sync_errors` RENAME COLUMN `resolved` TO `is_resolved`;
ALTER TABLE `tenant_configs` RENAME COLUMN `pdf_show_footer` TO `is_pdf_footer_shown`;
ALTER TABLE `tenant_configs` RENAME COLUMN `pdf_show_page_numbers` TO `is_pdf_page_numbers_shown`;
ALTER TABLE `tenant_configs` RENAME COLUMN `pdf_show_license` TO `is_pdf_license_shown`;
ALTER TABLE `tenant_configs` RENAME COLUMN `show_estimates` TO `is_estimates_shown`;
ALTER TABLE `tenant_configs` RENAME COLUMN `enable_repair_list` TO `is_repair_list_enabled`;
ALTER TABLE `tenant_configs` RENAME COLUMN `enable_customer_repair_export` TO `is_customer_repair_export_enabled`;
ALTER TABLE `tenant_configs` RENAME COLUMN `block_unpaid` TO `is_unpaid_blocked`;
ALTER TABLE `tenant_configs` RENAME COLUMN `block_unsigned_agreement` TO `is_unsigned_agreement_blocked`;
ALTER TABLE `tenant_configs` RENAME COLUMN `concierge_review_required` TO `is_concierge_review_required`;
ALTER TABLE `tenant_configs` RENAME COLUMN `allow_inspector_choice` TO `is_inspector_choice_allowed`;
ALTER TABLE `tenant_configs` RENAME COLUMN `enable_pdf_pipeline` TO `is_pdf_pipeline_enabled`;
ALTER TABLE `tenant_configs` RENAME COLUMN `team_mode_default` TO `is_team_mode_default`;
ALTER TABLE `tenant_configs` RENAME COLUMN `apprentice_review_required` TO `is_apprentice_review_required`;
ALTER TABLE `tenant_configs` RENAME COLUMN `guest_invites_enabled` TO `is_guest_invites_enabled`;
ALTER TABLE `tenant_configs` RENAME COLUMN `collab_editing` TO `is_collab_editing_enabled`;
ALTER TABLE `tenant_configs` RENAME COLUMN `managed_eligible` TO `is_managed_eligible`;
ALTER TABLE `tenant_configs` RENAME COLUMN `reserve_schedule_enabled` TO `is_reserve_schedule_enabled`;
ALTER TABLE `email_templates` RENAME COLUMN `enabled` TO `is_enabled`;
ALTER TABLE `integration_test_results` RENAME COLUMN `ok` TO `is_ok`;
ALTER TABLE `users` RENAME COLUMN `signature_enabled` TO `is_signature_enabled`;
ALTER TABLE `users` RENAME COLUMN `totp_enabled` TO `is_totp_enabled`;
ALTER TABLE `users` RENAME COLUMN `notify_on_referral` TO `is_referral_notification_enabled`;
ALTER TABLE `users` RENAME COLUMN `notify_on_report` TO `is_report_notification_enabled`;
ALTER TABLE `users` RENAME COLUMN `notify_on_paid` TO `is_paid_notification_enabled`;
