/**
 * Table-driven topological order for the data-package importer.
 *
 * Rows are written tier by tier so a row's foreign-key parents always exist
 * before it. The order is maintained by hand here (a table edit cannot silently
 * corrupt it) and checked against the schema's real foreign keys by a test:
 * every row-table appears exactly once, and no row-table is placed before a
 * row-table it references. Tables that are not in the package (withhold/out)
 * are excluded by construction — the membership test uses rowTableNames().
 */
import { rowTableNames } from './row-schemas';

/** Referential tiers, in write order. Within a tier, order is contractual. */
export const IMPORT_TIERS: readonly (readonly string[])[] = [
    // Foundation: the tenant row and its configuration/settings.
    ['tenants', 'tenant_configs', 'tenant_ai_configs', 'permission_templates', 'notification_preferences', 'email_suppressions'],
    // Reference data (safe to create before people and inspections).
    ['rating_systems', 'contractor_types', 'defect_categories', 'event_types', 'inspection_types', 'tags', 'services',
        'cost_items', 'comments', 'discount_codes', 'email_templates', 'message_templates', 'agreements', 'templates',
        'automations', 'service_pay_rules', 'tenant_custom_holidays', 'calendar_blocks'],
    // People and their role/credential/area links. Availability references users.
    ['users', 'contacts', 'contact_role_profiles', 'inspector_credentials', 'inspector_service_areas', 'service_inspectors',
        'availability', 'availability_overrides'],
    // Inspection requests are a parent of inspections (inspections.request_id).
    ['inspection_requests'],
    // The inspection core record.
    ['inspections'],
    // Inspection children (all reference an inspection).
    ['inspection_results', 'inspection_inspectors', 'inspection_people', 'inspection_services', 'inspection_units',
        'inspection_media_pool', 'inspection_item_tag_links', 'inspection_messages', 'psq_responses',
        'document_review_items', 'report_signoff', 'statutory_form_entries', 'statutory_inspection_details', 'comment_usage',
        'inspection_service_pay_splits'],
    // Reports and their versions/translations and signing keys.
    ['reports', 'report_versions', 'report_translations', 'signing_keys'],
    // Money and repair work.
    ['invoices', 'repair_requests', 'repair_request_items'],
    // Miscellaneous leaves and upload records.
    ['video_uploads', 'client_uploads'],
];

/** Flat write order with each table's tier index. */
export interface ImportPlan {
    readonly order: readonly string[];
    readonly tierOf: ReadonlyMap<string, number>;
}

export function buildImportPlan(): ImportPlan {
    const order: string[] = [];
    const tierOf = new Map<string, number>();
    IMPORT_TIERS.forEach((tier, i) => {
        for (const table of tier) {
            order.push(table);
            tierOf.set(table, i);
        }
    });
    return { order, tierOf };
}

/** Assert the hand-maintained plan covers exactly the exportable row-tables. */
export function assertPlanCoverage(plan: ImportPlan = buildImportPlan()): void {
    const declared = plan.order;
    const expected = new Set(rowTableNames());
    const seen = new Set<string>();
    for (const table of declared) {
        if (seen.has(table)) throw new Error(`import plan lists ${table} twice`);
        seen.add(table);
        if (!expected.has(table)) throw new Error(`import plan lists a non-row table: ${table}`);
    }
    for (const table of expected) {
        if (!seen.has(table)) throw new Error(`import plan is missing row table: ${table}`);
    }
}
