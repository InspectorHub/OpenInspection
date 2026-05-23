-- Migration 0074: CASCADE DELETE triggers for tenant purge
--
-- D1/SQLite cannot ALTER existing FK constraints to add ON DELETE CASCADE.
-- Table rebuilds are risky with orphan FK data in production. Instead, we
-- use BEFORE DELETE triggers on the `tenants` table: when a tenant row is
-- deleted, these triggers automatically remove all child rows first.
--
-- The `notifications` table already declares ON DELETE CASCADE in its
-- migration (0023) and Drizzle schema, so it is excluded here.
--
-- Tables are ordered from leaf → root to avoid FK-constraint violations
-- during the cascade. Child-of-child relationships (e.g. inspection_results
-- → inspections → tenants) are fine because SQLite evaluates all BEFORE
-- DELETE triggers before enforcing the FK constraint on the parent row.

-- ── inspection.ts tables ────────────────────────────────────────────

CREATE TRIGGER IF NOT EXISTS cascade_delete_inspection_results_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM inspection_results WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_inspection_agreements_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM inspection_agreements WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_inspection_services_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM inspection_services WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_inspection_events_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM inspection_events WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_inspection_item_tag_links_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM inspection_item_tag_links WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_inspection_media_pool_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM inspection_media_pool WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_inspection_requests_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM inspection_requests WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_inspection_units_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM inspection_units WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_inspections_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM inspections WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_templates_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM templates WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_agreements_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM agreements WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_agreement_requests_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM agreement_requests WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_tags_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM tags WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_availability_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM availability WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_availability_overrides_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM availability_overrides WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_comments_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM comments WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_services_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM services WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_discount_codes_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM discount_codes WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_automations_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM automations WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_automation_logs_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM automation_logs WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_event_types_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM event_types WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_concierge_confirm_tokens_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM concierge_confirm_tokens WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_rating_systems_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM rating_systems WHERE tenant_id = OLD.id;
END;

-- ── tenant.ts tables ────────────────────────────────────────────────

CREATE TRIGGER IF NOT EXISTS cascade_delete_users_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM users WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_tenant_invites_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM tenant_invites WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_tenant_configs_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM tenant_configs WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_audit_logs_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM audit_logs WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_agent_tenant_links_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM agent_tenant_links WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_agent_invites_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM agent_invites WHERE tenant_id = OLD.id;
END;

-- notifications: already has ON DELETE CASCADE in migration 0023, skip.

-- ── other schema files ──────────────────────────────────────────────

CREATE TRIGGER IF NOT EXISTS cascade_delete_contacts_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM contacts WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_invoices_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM invoices WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_signing_keys_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM signing_keys WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_esign_audit_logs_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM esign_audit_logs WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_customer_messages_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM customer_messages WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_recommendations_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM recommendations WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_report_pdfs_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM report_pdfs WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_report_versions_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM report_versions WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_tenant_marketplace_imports_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM tenant_marketplace_imports WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_tenant_library_imports_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM tenant_library_imports WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_tenant_marketplace_import_history_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM tenant_marketplace_import_history WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_qbo_connections_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM qbo_connections WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_qbo_entity_map_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM qbo_entity_map WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_qbo_sync_errors_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM qbo_sync_errors WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_apprentice_reviews_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM apprentice_reviews WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_guest_invites_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM guest_invites WHERE tenant_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_delete_observer_links_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM observer_links WHERE tenant_id = OLD.id;
END;

-- user_identity_links uses `linked_tenant_id` instead of `tenant_id`
CREATE TRIGGER IF NOT EXISTS cascade_delete_user_identity_links_on_tenant
BEFORE DELETE ON tenants FOR EACH ROW
BEGIN
    DELETE FROM user_identity_links WHERE linked_tenant_id = OLD.id;
END;
