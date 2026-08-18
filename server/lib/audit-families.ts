/**
 * The closed set of `entityType` values an audit row may carry.
 *
 * Read off the call sites, which held 27 spellings for 26 things:
 * `tenant_config` appeared nine times and `tenant_configs` once. An
 * unconstrained string is how that happens and stays.
 *
 * `user` is new with the membership-lifecycle writes. It is NOT
 * `user_service_origin`: that family is the per-inspector service-origin
 * config on the booking-routing surface, and reusing it for "who was invited,
 * who joined, whose password changed" would file three membership events under
 * a geography setting.
 *
 * `widget` does NOT come from the audit
 * helpers in `audit.ts`: `widget.service.ts` inserts into `audit_logs`
 * directly with a template-literal action. It is listed because this file
 * claims to describe the rows in the table, and a list that quietly omits a
 * value the table actually holds is a lie a reader cannot detect.
 */
export const AUDIT_FAMILIES = [
    'agent', 'agreement_request', 'audit_log', 'bulk_export', 'client', 'comment',
    'contact_role_profile', 'contractor_type', 'credential', 'defect_category',
    'import', 'inspection', 'inspection_item', 'inspection_results',
    'inspector_service_areas', 'library', 'mcp_grant', 'rating_system',
    'recommendation', 'signing_key', 'starter_content', 'tag', 'template',
    'tenant', 'tenant_config', 'user', 'user_service_origin', 'widget',
] as const;

export type AuditFamily = (typeof AUDIT_FAMILIES)[number];
