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
    'CREATE TABLE IF NOT EXISTS tenant_configs (tenant_id TEXT PRIMARY KEY, company_name TEXT, primary_color TEXT, logo_url TEXT, support_email TEXT, sender_email TEXT, reply_to TEXT, email_mode TEXT, video_mode TEXT, sms_mode TEXT, sender_display_name TEXT, point_of_contact TEXT, billing_url TEXT, review_url TEXT, company_phone TEXT, integration_config TEXT, secrets TEXT, secrets_enc TEXT, dek_enc TEXT, ics_token TEXT, widget_allowed_origins TEXT, report_theme TEXT, attention_thresholds TEXT, inspection_prefs TEXT, show_estimates INTEGER, enable_repair_list INTEGER, enable_customer_repair_export INTEGER, block_unpaid INTEGER, block_unsigned_agreement INTEGER, custom_referral_sources TEXT, dashboard_column_prefs TEXT, concierge_review_required INTEGER, allow_inspector_choice INTEGER, enable_pdf_pipeline INTEGER, auto_sign_on_publish_default INTEGER, team_mode_default TEXT, apprentice_review_required INTEGER, guest_invites_enabled INTEGER, require_defect_fields TEXT, agreement_retention_years INTEGER, reinspection_statuses TEXT, collab_editing INTEGER NOT NULL DEFAULT 1, company_address TEXT, pdf_show_footer INTEGER, pdf_show_page_numbers INTEGER, pdf_show_license INTEGER, sms_byo_provider TEXT, email_byo_provider TEXT, updated_at INTEGER);';
