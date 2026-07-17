/**
 * Hand-maintained CREATE TABLE DDL for the workers-runtime specs that talk to
 * the `env.DB` D1 binding DIRECTLY (cmd-consumer / cmd-fixtures) rather than
 * replaying the real migration .sql files (the harness pattern those specs use
 * — see report-amendments.spec.ts for the migration-replay alternative).
 *
 * `tenant_configs` grows a column with almost every feature (PDF settings, SMS,
 * concierge, role templates, …). When the Drizzle schema gains a column, the
 * cmd-apply path binds it on upsert — but this hand-written DDL would lack it,
 * so the statement references a missing column, `applyTenantUpdate` parks, and
 * `test:workers` fails. That exact drift blocked #164.
 *
 * `tests/unit/inline-ddl-schema-sync.spec.ts` asserts this DDL covers every
 * Drizzle `tenantConfigs` column, so the drift is caught as a fast unit test
 * instead of a real-workerd failure. Both consumers import this single source.
 */
export const TENANT_CONFIGS_TEST_DDL =
    'CREATE TABLE IF NOT EXISTS tenant_configs (tenant_id TEXT PRIMARY KEY, company_name TEXT, primary_color TEXT, logo_url TEXT, support_email TEXT, sender_email TEXT, reply_to TEXT, email_mode TEXT, video_mode TEXT, sms_mode TEXT, sender_display_name TEXT, point_of_contact TEXT, billing_url TEXT, review_url TEXT, company_phone TEXT, integration_config TEXT, secrets TEXT, secrets_enc TEXT, dek_enc TEXT, ics_token TEXT, widget_allowed_origins TEXT, report_theme TEXT, attention_thresholds TEXT, inspection_prefs TEXT, is_estimates_shown INTEGER, is_repair_list_enabled INTEGER, is_customer_repair_export_enabled INTEGER, is_unpaid_blocked INTEGER, is_unsigned_agreement_blocked INTEGER, custom_referral_sources TEXT, dashboard_column_prefs TEXT, is_concierge_review_required INTEGER, is_inspector_choice_allowed INTEGER, is_pdf_pipeline_enabled INTEGER, auto_sign_on_publish_default INTEGER, is_team_mode_default TEXT, is_apprentice_review_required INTEGER, is_guest_invites_enabled INTEGER, require_defect_fields TEXT, agreement_retention_years INTEGER, reinspection_statuses TEXT, is_collab_editing_enabled INTEGER NOT NULL DEFAULT 1, company_address TEXT, is_pdf_footer_shown INTEGER, is_pdf_page_numbers_shown INTEGER, is_pdf_license_shown INTEGER, sms_byo_provider TEXT, email_byo_provider TEXT, is_managed_eligible INTEGER NOT NULL DEFAULT 0, managed_provider TEXT NOT NULL DEFAULT \'twilio\', is_reserve_schedule_enabled INTEGER, reserve_term_years INTEGER, inflation_rate_bps INTEGER, default_timezone TEXT NOT NULL DEFAULT \'UTC\', booking_slot_mode TEXT NOT NULL DEFAULT \'fixed\', booking_slot_interval_min INTEGER NOT NULL DEFAULT 30, holiday_region TEXT, holiday_public_policy TEXT NOT NULL DEFAULT \'open\', holiday_internal_policy TEXT NOT NULL DEFAULT \'advisory\', default_locale TEXT NOT NULL DEFAULT \'en-US\', currency TEXT NOT NULL DEFAULT \'USD\', updated_at INTEGER);';
