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
 *
 * `inspection_results` is here for the same reason and learned it the same way:
 * the DDL was copy-pasted into four collab specs, the Drizzle table gained
 * `report_id`, and the only thing that noticed was the DO's persist() blowing up
 * inside real workerd — after the three-suite gate had gone green. One source,
 * one sync assertion.
 */
export const TENANT_CONFIGS_TEST_DDL =
    'CREATE TABLE IF NOT EXISTS tenant_configs (tenant_id TEXT PRIMARY KEY, company_name TEXT, primary_color TEXT, logo_url TEXT, support_email TEXT, sender_email TEXT, reply_to TEXT, email_mode TEXT, video_mode TEXT, sms_mode TEXT, sender_display_name TEXT, point_of_contact TEXT, billing_url TEXT, review_url TEXT, company_phone TEXT, integration_config TEXT, secrets TEXT, secrets_enc TEXT, dek_enc TEXT, ics_token TEXT, widget_allowed_origins TEXT, default_profile_id TEXT, attention_thresholds TEXT, inspection_prefs TEXT, is_estimates_shown INTEGER, is_repair_list_enabled INTEGER, is_customer_repair_export_enabled INTEGER, is_unpaid_blocked INTEGER, is_unsigned_agreement_blocked INTEGER, custom_referral_sources TEXT, dashboard_column_prefs TEXT, is_concierge_review_required INTEGER, is_inspector_choice_allowed INTEGER, is_pdf_pipeline_enabled INTEGER, auto_sign_on_publish_default INTEGER, is_team_mode_default TEXT, is_apprentice_review_required INTEGER, is_guest_invites_enabled INTEGER, require_defect_fields TEXT, agreement_retention_years INTEGER, reinspection_statuses TEXT, is_collab_editing_enabled INTEGER NOT NULL DEFAULT 1, company_address TEXT, is_pdf_footer_shown INTEGER, is_pdf_page_numbers_shown INTEGER, is_pdf_license_shown INTEGER, sms_byo_provider TEXT, email_byo_provider TEXT, is_managed_eligible INTEGER NOT NULL DEFAULT 0, managed_provider TEXT NOT NULL DEFAULT \'twilio\', is_reserve_schedule_enabled INTEGER, reserve_term_years INTEGER, inflation_rate_bps INTEGER, default_timezone TEXT NOT NULL DEFAULT \'UTC\', booking_slot_mode TEXT NOT NULL DEFAULT \'fixed\', booking_slot_interval_min INTEGER NOT NULL DEFAULT 30, holiday_region TEXT, holiday_public_policy TEXT NOT NULL DEFAULT \'open\', holiday_internal_policy TEXT NOT NULL DEFAULT \'advisory\', default_locale TEXT NOT NULL DEFAULT \'en-US\', currency TEXT NOT NULL DEFAULT \'USD\', is_archive_revoking_access INTEGER NOT NULL DEFAULT 0, legal_mode TEXT NOT NULL DEFAULT \'hosted\', custom_privacy_url TEXT, custom_terms_url TEXT, privacy_body TEXT, terms_body TEXT, date_format TEXT NOT NULL DEFAULT \'us\', time_format TEXT NOT NULL DEFAULT \'12h\', booking_conflict_policy TEXT NOT NULL DEFAULT \'advisory\', cancellation_policy TEXT, cancellation_clause_agreement_id TEXT, cancellation_clause_version INTEGER, cancellation_clause_attested_at INTEGER, deposit_policy TEXT, booking_routing_strategy TEXT NOT NULL DEFAULT \'first_available\', booking_min_lead_hours INTEGER NOT NULL DEFAULT 0, booking_same_day_cutoff_time TEXT, company_lat REAL, company_lng REAL, company_geocoded_at INTEGER, ai_key_attestation_provider TEXT, ai_key_attestation_mode TEXT, ai_key_attestation_account_owner TEXT, ai_key_attestation_terms_version TEXT, ai_key_attestation_attested_at INTEGER, ai_key_attestation_policy_version TEXT, repair_quick_phrases TEXT, legal_name TEXT, updated_at INTEGER);';

/**
 * `users` is here for the third time the same lesson was learned, and this one
 * cost a CI-only failure: `applyAdminCredential` does
 * `db.insert(users).values({...})` with a PARTIAL object, and drizzle still
 * emits every column of the table — filling the rest with null. So a users
 * column that exists in the Drizzle schema and not in this DDL parks the
 * credential apply with `table users has no column named …`, and neither
 * `test:unit` nor `test:web` can see it.
 *
 * The drift guard covered tenant_configs and inspection_results but not this
 * table, which is why adding `service_origin_*` went green three gates deep.
 * It covers users now.
 */
export const USERS_TEST_DDL =
    'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT, email TEXT NOT NULL, password_hash TEXT NOT NULL, name TEXT, phone TEXT, photo_url TEXT, default_signature_base64 TEXT, is_signature_enabled INTEGER NOT NULL DEFAULT true, bio TEXT, service_areas TEXT, slug TEXT, role TEXT NOT NULL DEFAULT \'admin\', google_refresh_token TEXT, google_calendar_id TEXT, google_access_token TEXT, google_token_expiry INTEGER, locale TEXT, onboarding_state TEXT, created_at INTEGER NOT NULL, totp_secret TEXT, is_totp_enabled INTEGER NOT NULL DEFAULT false, totp_recovery_codes TEXT, totp_verified_at INTEGER, is_referral_notification_enabled INTEGER NOT NULL DEFAULT true, is_report_notification_enabled INTEGER NOT NULL DEFAULT true, is_paid_notification_enabled INTEGER NOT NULL DEFAULT false, last_active_at INTEGER, mentor_id TEXT, assigned_section_ids TEXT NOT NULL DEFAULT \'[]\', expires_at INTEGER, signup_role TEXT, deleted_at INTEGER, terms_accepted TEXT, permission_overrides TEXT, timezone TEXT, date_format TEXT, time_format TEXT, service_origin_address TEXT, service_origin_lat REAL, service_origin_lng REAL);';

export const INSPECTION_RESULTS_TEST_DDL =
    'CREATE TABLE IF NOT EXISTS inspection_results (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, inspection_id TEXT NOT NULL, data TEXT NOT NULL, ydoc_state BLOB, last_synced_at INTEGER NOT NULL, rating_system_id TEXT, rating_system_snapshot TEXT, report_id TEXT);';
