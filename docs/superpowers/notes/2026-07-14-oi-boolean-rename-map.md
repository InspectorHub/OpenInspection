# OI Boolean Column Rename Map (is_/has_) — #227

Authoritative old→new SQL-column-name map for the `is_*` / `has_*` boolean
naming normalization. **Only the `integer('<sql_name>', …)` string changes;**
the camelCase JS property (first column) is unchanged, so all consumer code is
untouched. Each row maps to exactly one `ALTER TABLE <table> RENAME COLUMN`
statement in `migrations/0001_boolean_columns_is_has.sql`.

Already-compliant booleans (`is_available`, `is_default`, `is_seed`,
`is_seeded`, `is_amendment`, `is_managed`, …) are omitted — no change needed.

| schema file | JS prop | table | old SQL | new SQL |
|---|---|---|---|---|
| commercial-subtypes.ts | disabled | `commercial_subtypes` | `disabled` | `is_disabled` |
| compliance.ts | senderAttached | `messaging_compliance` | `sender_attached` | `has_sender_attached` |
| inspection/automation.ts | active | `automations` | `active` | `is_active` |
| inspection/automation.ts | active | `event_types` | `active` | `is_active` |
| inspection/automation.ts | enabled | `inspection_types` | `enabled` | `is_enabled` |
| inspection/core.ts | paymentRequired | `inspections` | `payment_required` | `is_payment_required` |
| inspection/core.ts | agreementRequired | `inspections` | `agreement_required` | `is_agreement_required` |
| inspection/core.ts | autoSignOnPublish | `inspections` | `auto_sign_on_publish` | `is_auto_sign_on_publish` |
| inspection/core.ts | disableAutomations | `inspections` | `disable_automations` | `is_automations_disabled` |
| inspection/core.ts | teamMode | `inspections` | `team_mode` | `is_team_mode` |
| inspection/defect-category.ts | drivesSummary | `defect_categories` | `drives_summary` | `is_summary_driver` |
| inspection/services.ts | active | `services` | `active` | `is_active` |
| inspection/services.ts | active | `discount_codes` | `active` | `is_active` |
| inspection/template-rating.ts | featured | `templates` | `featured` | `is_featured` |
| marketplace.ts | featured | `marketplace_templates` | `featured` | `is_featured` |
| marketplace.ts | featured | `marketplace_libraries` | `featured` | `is_featured` |
| pca-compliance.ts | dualRole | `report_signoff` | `dual_role` | `is_dual_role` |
| pca-compliance.ts | requested | `document_review_items` | `requested` | `is_requested` |
| pca-compliance.ts | received | `document_review_items` | `received` | `is_received` |
| pca-compliance.ts | reviewed | `document_review_items` | `reviewed` | `is_reviewed` |
| pca-compliance.ts | na | `document_review_items` | `na` | `is_na` |
| qbo.ts | syncEnabled | `qbo_connections` | `sync_enabled` | `is_sync_enabled` |
| qbo.ts | resolved | `qbo_sync_errors` | `resolved` | `is_resolved` |
| tenant/core.ts | pdfShowFooter | `tenant_configs` | `pdf_show_footer` | `is_pdf_footer_shown` |
| tenant/core.ts | pdfShowPageNumbers | `tenant_configs` | `pdf_show_page_numbers` | `is_pdf_page_numbers_shown` |
| tenant/core.ts | pdfShowLicense | `tenant_configs` | `pdf_show_license` | `is_pdf_license_shown` |
| tenant/core.ts | showEstimates | `tenant_configs` | `show_estimates` | `is_estimates_shown` |
| tenant/core.ts | enableRepairList | `tenant_configs` | `enable_repair_list` | `is_repair_list_enabled` |
| tenant/core.ts | enableCustomerRepairExport | `tenant_configs` | `enable_customer_repair_export` | `is_customer_repair_export_enabled` |
| tenant/core.ts | blockUnpaid | `tenant_configs` | `block_unpaid` | `is_unpaid_blocked` |
| tenant/core.ts | blockUnsignedAgreement | `tenant_configs` | `block_unsigned_agreement` | `is_unsigned_agreement_blocked` |
| tenant/core.ts | conciergeReviewRequired | `tenant_configs` | `concierge_review_required` | `is_concierge_review_required` |
| tenant/core.ts | allowInspectorChoice | `tenant_configs` | `allow_inspector_choice` | `is_inspector_choice_allowed` |
| tenant/core.ts | enablePdfPipeline | `tenant_configs` | `enable_pdf_pipeline` | `is_pdf_pipeline_enabled` |
| tenant/core.ts | teamModeDefault | `tenant_configs` | `team_mode_default` | `is_team_mode_default` |
| tenant/core.ts | apprenticeReviewRequired | `tenant_configs` | `apprentice_review_required` | `is_apprentice_review_required` |
| tenant/core.ts | guestInvitesEnabled | `tenant_configs` | `guest_invites_enabled` | `is_guest_invites_enabled` |
| tenant/core.ts | collabEditing | `tenant_configs` | `collab_editing` | `is_collab_editing_enabled` |
| tenant/core.ts | managedEligible | `tenant_configs` | `managed_eligible` | `is_managed_eligible` |
| tenant/core.ts | reserveScheduleEnabled | `tenant_configs` | `reserve_schedule_enabled` | `is_reserve_schedule_enabled` |
| tenant/core.ts | enabled | `email_templates` | `enabled` | `is_enabled` |
| tenant/integration.ts | ok | `integration_test_results` | `ok` | `is_ok` |
| tenant/user.ts | signatureEnabled | `users` | `signature_enabled` | `is_signature_enabled` |
| tenant/user.ts | totpEnabled | `users` | `totp_enabled` | `is_totp_enabled` |
| tenant/user.ts | notifyOnReferral | `users` | `notify_on_referral` | `is_referral_notification_enabled` |
| tenant/user.ts | notifyOnReport | `users` | `notify_on_report` | `is_report_notification_enabled` |
| tenant/user.ts | notifyOnPaid | `users` | `notify_on_paid` | `is_paid_notification_enabled` |

**47 renames.** The last 10 (`dual_role`, `requested`/`received`/`reviewed`/`na`,
`team_mode_default`, `guest_invites_enabled`, `reserve_schedule_enabled`,
`notify_on_report`, `notify_on_paid`) were added by the commercial-PCA epic
after the original Plan-2 draft; they follow the same convention (simple
prefix, or `_enabled`/`_shown`/`_disabled` state-oriented phrasing to match the
sibling columns already in the plan's map).
