import type { AuditAction } from './audit';
import type { AuditFamily } from './audit-families';

/**
 * How one `metadata` key renders in an audit entry, independent of what the
 * call site happened to call it. Four spellings of a recipient
 * (`agentEmail`, `clientEmail`, `recipient`, `recipientEmail`) are one role, so
 * a reader is not asked to learn the vocabulary of every emitter.
 */
export type MetaRole = 'name' | 'from' | 'to' | 'reason' | 'count' | 'person' | 'id' | 'flag';

/**
 * Why an action exists, in the only three shapes this vocabulary has left.
 *
 * There is deliberately no `never-wired` and no `outbox-only` kind: the
 * never-wired names were deleted rather than declared, and an action whose only
 * record is a two-cycle outbox event is not audited at all. Reintroducing
 * either kind reintroduces the problem it would describe.
 */
export type AuditStatus =
    | { kind: 'live' }
    | { kind: 'in-esign-log'; note: string }
    | { kind: 'superseded'; by: AuditAction };

export interface AuditActionDef {
    /** The `entityType` this action is normally written against. */
    family: AuditFamily;
    /**
     * Further families the SAME action is genuinely written against. Three
     * actions have one: a config patch reaches two different config surfaces,
     * an import lands as either seeded starter content or a user import, and a
     * template upgrade is recorded against both the inspection and the
     * template. Declaring the extras is what lets the gate check families at
     * all -- with a single field it would have had to skip the check.
     */
    altFamilies?: readonly AuditFamily[];
    /** paraglide message key; the renderer composes a sentence from `meta` roles. */
    label: string;
    /** The keys the CALL SITES actually pass, mapped to how each renders.
     *  Checked against source by `lint:audit-registry` -- a guess here fails. */
    meta: Record<string, MetaRole>;
    status: AuditStatus;
}

/**
 * Names that LEFT `AuditAction` in a rename but are still sitting in rows.
 *
 * They keep an entry here and lose their union membership, which is the pair of
 * facts that matters: no new code can write them, and a reader of an old row is
 * still told what the event was called afterwards. Deleting the entry instead
 * would make every row already written unreadable.
 */
export type RetiredAuditAction =
    | 'inspection.status_changed'
    | 'inspection.conflicts_resolved'
    | 'inspection.inspector_signed';

/**
 * One entry per member of `AuditAction`, plus the renamed names that left the
 * union but still sit in rows already written.
 *
 * The `Record<...>` key type is the half of the bidirectional check the
 * compiler can do on its own: a union member with no entry here does not
 * compile. The other half -- an entry with no call site, a call site with no
 * entry, a declared `meta` key nothing passes -- needs source text, and that is
 * `scripts/check-audit-registry.mjs`.
 */
/**
 * Formatting note: one entry per LINE, not per block. This is a data table --
 * 96 rows of four fields -- and a six-line block per row put it at 661 lines,
 * past the file-size cap, while making it harder to scan down a column. The
 * five rows that carry a prose `note` keep the block form because the note is
 * a sentence, not a field.
 */
export const AUDIT_REGISTRY: Record<AuditAction | RetiredAuditAction, AuditActionDef> = {
    'admin.migrate_finding_keys': { family: 'inspection_results', label: 'audit_action_admin_migrate_finding_keys', meta: { migrated: 'count', processed: 'count', skipped: 'count' }, status: { kind: 'live' } },
    'agent.magic_login.issued': { family: 'agent', label: 'audit_action_agent_magic_login_issued', meta: { hasAccount: 'flag', inspectionId: 'id' }, status: { kind: 'live' } },
    'agreement.create': {
        family: 'agreement_request',
        label: 'audit_action_agreement_create',
        meta: {},
        status: { kind: 'in-esign-log', note: 'The envelope creation is appended to esign_audit_logs as `request.created`; this name has never been written to audit_logs.' },
    },
    'agreement.declined': {
        family: 'agreement_request',
        label: 'audit_action_agreement_declined',
        meta: {},
        status: { kind: 'in-esign-log', note: 'A decline is appended to esign_audit_logs as `signer.declined`; this name has never been written to audit_logs.' },
    },
    'agreement.inspector_signed': {
        family: 'agreement_request',
        label: 'audit_action_agreement_inspector_signed',
        meta: {},
        status: { kind: 'in-esign-log', note: 'Appended to esign_audit_logs under this exact name by the inspector-countersign route; audit_logs never carries it.' },
    },
    'agreement.remind': { family: 'agreement_request', label: 'audit_action_agreement_remind', meta: { requestId: 'id', signerId: 'person' }, status: { kind: 'live' } },
    'agreement.send': { family: 'agreement_request', label: 'audit_action_agreement_send', meta: { addedSigners: 'count', agreementId: 'id', clientEmail: 'person', inspectionId: 'id', signerCount: 'count', signers: 'count' }, status: { kind: 'live' } },
    'agreement.sent': { family: 'agreement_request', label: 'audit_action_agreement_sent', meta: {}, status: { kind: 'in-esign-log', note: 'The send is appended to esign_audit_logs as `request.sent`; this name has never been written to audit_logs.' } },
    'agreement.viewed': {
        family: 'agreement_request',
        label: 'audit_action_agreement_viewed',
        meta: {},
        status: { kind: 'in-esign-log', note: 'A presentation is appended to esign_audit_logs as `signer.presented`, once per signer. The envelope-level `request.viewed` event is declared there but never appended, and this name has never been written to audit_logs.' },
    },
    'audit.view': { family: 'audit_log', label: 'audit_action_audit_view', meta: {}, status: { kind: 'live' } },
    'booking.routing.applied': { family: 'inspection', label: 'audit_action_booking_routing_applied', meta: { applied: 'to', candidateCount: 'count', inspectorId: 'person', reason: 'reason', requested: 'from' }, status: { kind: 'live' } },
    'comment.created': { family: 'comment', label: 'audit_action_comment_created', meta: { textPreview: 'name' }, status: { kind: 'live' } },
    'comment.deleted': { family: 'comment', label: 'audit_action_comment_deleted', meta: { textPreview: 'name' }, status: { kind: 'live' } },
    'comment.updated': { family: 'comment', label: 'audit_action_comment_updated', meta: { category: 'name', section: 'name', severity: 'name', textPreview: 'name' }, status: { kind: 'live' } },
    'config.attention_thresholds.update': { family: 'tenant_config', label: 'audit_action_config_attention_thresholds_update', meta: {}, status: { kind: 'live' } },
    'config.dashboard_columns.update': { family: 'tenant_config', label: 'audit_action_config_dashboard_columns_update', meta: { columns: 'name' }, status: { kind: 'live' } },
    'config.integration.update': { family: 'tenant_config', label: 'audit_action_config_integration_update', meta: { stripeConnect: 'flag' }, status: { kind: 'live' } },
    'config.secrets.update': { family: 'tenant_config', label: 'audit_action_config_secrets_update', meta: { keysUpdated: 'name' }, status: { kind: 'live' } },
    'config.service_areas.replace': { family: 'inspector_service_areas', label: 'audit_action_config_service_areas_replace', meta: { zipPrefixes: 'name' }, status: { kind: 'live' } },
    'config.tenant_config.patch': {
        family: 'tenant_config',
        altFamilies: ['user_service_origin'],
        label: 'audit_action_config_tenant_config_patch',
        meta: { bookingRouting: 'name', companyGeocode: 'flag', enabled: 'flag', field: 'name', resolved: 'to' },
        status: { kind: 'live' },
    },
    'contractor_type.created': { family: 'contractor_type', label: 'audit_action_contractor_type_created', meta: { name: 'name' }, status: { kind: 'live' } },
    'contractor_type.deleted': { family: 'contractor_type', label: 'audit_action_contractor_type_deleted', meta: {}, status: { kind: 'live' } },
    'contractor_type.updated': { family: 'contractor_type', label: 'audit_action_contractor_type_updated', meta: {}, status: { kind: 'live' } },
    'credential.created': { family: 'credential', label: 'audit_action_credential_created', meta: {}, status: { kind: 'live' } },
    'credential.deleted': { family: 'credential', label: 'audit_action_credential_deleted', meta: {}, status: { kind: 'live' } },
    'credential.image_uploaded': { family: 'credential', label: 'audit_action_credential_image_uploaded', meta: {}, status: { kind: 'live' } },
    'credential.updated': { family: 'credential', label: 'audit_action_credential_updated', meta: {}, status: { kind: 'live' } },
    'data.delete': { family: 'client', label: 'audit_action_data_delete', meta: { clientEmail: 'person' }, status: { kind: 'live' } },
    'data.export': { family: 'bulk_export', label: 'audit_action_data_export', meta: {}, status: { kind: 'live' } },
    // One writer, one family, no metadata: installing starter content. The
    // `import` alt family and the `counts` key were the intake delivery route's,
    // and it now writes `migration.delivered` on its own family. Leaving them
    // here would declare a vocabulary word and a metadata key that nothing
    // produces — the exact claim this registry exists to keep true.
    'data.import': { family: 'starter_content', label: 'audit_action_data_import', meta: {}, status: { kind: 'live' } },
    'defect_category.created': { family: 'defect_category', label: 'audit_action_defect_category_created', meta: { name: 'name' }, status: { kind: 'live' } },
    'defect_category.deleted': { family: 'defect_category', label: 'audit_action_defect_category_deleted', meta: {}, status: { kind: 'live' } },
    'defect_category.updated': { family: 'defect_category', label: 'audit_action_defect_category_updated', meta: {}, status: { kind: 'live' } },
    'inspection.bulk_assign': { family: 'inspection', label: 'audit_action_inspection_bulk_assign', meta: { ids: 'id', inspectorId: 'person' }, status: { kind: 'live' } },
    'inspection.bulk_status': { family: 'inspection', label: 'audit_action_inspection_bulk_status', meta: { ids: 'id', status: 'to' }, status: { kind: 'live' } },
    'inspection.complete': { family: 'inspection', label: 'audit_action_inspection_complete', meta: { propertyAddress: 'name' }, status: { kind: 'live' } },
    'inspection.compliance.doc_review_seeded': { family: 'inspection', label: 'audit_action_inspection_compliance_doc_review_seeded', meta: {}, status: { kind: 'live' } },
    'inspection.compliance.doc_review_updated': { family: 'inspection', label: 'audit_action_inspection_compliance_doc_review_updated', meta: { documentKey: 'id', fields: 'name' }, status: { kind: 'live' } },
    'inspection.compliance.psq_status_changed': { family: 'inspection', label: 'audit_action_inspection_compliance_psq_status_changed', meta: { status: 'to' }, status: { kind: 'live' } },
    'inspection.compliance.psq_updated': { family: 'inspection', label: 'audit_action_inspection_compliance_psq_updated', meta: {}, status: { kind: 'live' } },
    'inspection.compliance.signoff': { family: 'inspection', label: 'audit_action_inspection_compliance_signoff', meta: { dualRole: 'flag', role: 'name' }, status: { kind: 'live' } },
    'inspection.compliance.signoff_removed': { family: 'inspection', label: 'audit_action_inspection_compliance_signoff_removed', meta: { role: 'name' }, status: { kind: 'live' } },
    'inspection.conflicts_resolved': { family: 'inspection', label: 'audit_action_inspection_conflicts_resolved', meta: {}, status: { kind: 'superseded', by: 'inspection.sync_conflict_resolved' } },
    'inspection.create': { family: 'inspection', label: 'audit_action_inspection_create', meta: { clonedFrom: 'id', propertyAddress: 'name' }, status: { kind: 'live' } },
    'inspection.delete': { family: 'inspection', label: 'audit_action_inspection_delete', meta: { propertyAddress: 'name' }, status: { kind: 'live' } },
    'inspection.inspector_signed': { family: 'agreement_request', label: 'audit_action_inspection_inspector_signed', meta: {}, status: { kind: 'superseded', by: 'agreement.inspector_signed' } },
    'inspection.media.attach': { family: 'inspection', label: 'audit_action_inspection_media_attach', meta: { itemId: 'id', poolId: 'id', sectionId: 'id' }, status: { kind: 'live' } },
    'inspection.media.video.delete': { family: 'inspection', label: 'audit_action_inspection_media_video_delete', meta: { videoRef: 'id' }, status: { kind: 'live' } },
    'inspection.media.video.finalize': { family: 'inspection', label: 'audit_action_inspection_media_video_finalize', meta: { poolId: 'id' }, status: { kind: 'live' } },
    'inspection.pca_narrative.update': { family: 'inspection', label: 'audit_action_inspection_pca_narrative_update', meta: { fields: 'name' }, status: { kind: 'live' } },
    'inspection.property_facts.autofill': { family: 'inspection', label: 'audit_action_inspection_property_facts_autofill', meta: { reason: 'reason', source: 'name' }, status: { kind: 'live' } },
    'inspection.property_facts.update': { family: 'inspection', label: 'audit_action_inspection_property_facts_update', meta: { fields: 'name' }, status: { kind: 'live' } },
    'inspection.rating_system.switch': { family: 'inspection', label: 'audit_action_inspection_rating_system_switch', meta: { mode: 'name', ratingSystemId: 'id' }, status: { kind: 'live' } },
    'inspection.report_narrative.update': { family: 'inspection', label: 'audit_action_inspection_report_narrative_update', meta: { cleared: 'flag', length: 'count', reportId: 'id' }, status: { kind: 'live' } },
    'inspection.report_relocked': { family: 'inspection', label: 'audit_action_inspection_report_relocked', meta: {}, status: { kind: 'live' } },
    'inspection.report_unlocked': { family: 'inspection', label: 'audit_action_inspection_report_unlocked', meta: { alreadyUnlocked: 'flag', reason: 'reason' }, status: { kind: 'live' } },
    'inspection.rescheduled': { family: 'inspection', label: 'audit_action_inspection_rescheduled', meta: { conflicts: 'count', from: 'from', to: 'to' }, status: { kind: 'live' } },
    'inspection.results_batch_patched': { family: 'inspection', label: 'audit_action_inspection_results_batch_patched', meta: { applied: 'to', by: 'person' }, status: { kind: 'live' } },
    'inspection.send_pdf': { family: 'inspection', label: 'audit_action_inspection_send_pdf', meta: { recipient: 'person', roleKey: 'name' }, status: { kind: 'live' } },
    'inspection.send_sms': { family: 'inspection', label: 'audit_action_inspection_send_sms', meta: { channel: 'name', recipient: 'person', roleKey: 'name' }, status: { kind: 'live' } },
    'inspection.share_agent': { family: 'inspection', label: 'audit_action_inspection_share_agent', meta: { agentEmail: 'person' }, status: { kind: 'live' } },
    'inspection.status_change': { family: 'inspection', label: 'audit_action_inspection_status_change', meta: { feeCents: 'count', from: 'from', reason: 'reason', refundCents: 'count', refundPaymentId: 'id', to: 'to' }, status: { kind: 'live' } },
    'inspection.status_changed': { family: 'inspection', label: 'audit_action_inspection_status_changed', meta: {}, status: { kind: 'superseded', by: 'inspection.status_change' } },
    'inspection.sync_conflict_resolved': { family: 'inspection', label: 'audit_action_inspection_sync_conflict_resolved', meta: {}, status: { kind: 'live' } },
    'inspection.template_snapshot.update': { family: 'inspection', label: 'audit_action_inspection_template_snapshot_update', meta: { sectionCount: 'count' }, status: { kind: 'live' } },
    'inspection.template_upgraded': {
        family: 'inspection',
        altFamilies: ['template'],
        label: 'audit_action_inspection_template_upgraded',
        // Four keys were retired with `template-migrations.ts` (Task 32): `migrated`,
        // `strategy`, `oldTemplateDeleted` and `oldTemplateId` were passed only by that
        // route's handler. The surviving writer — inspection-sync.ts — passes `from`
        // and `to` alone, and has since this action was declared. A declared meta key
        // nothing writes is the same defect as a rule nothing enforces.
        meta: { from: 'from', to: 'to' },
        status: { kind: 'live' },
    },
    'library.marketplace.updated': {
        family: 'library',
        label: 'audit_action_library_marketplace_updated',
        meta: { fromSemver: 'from', libraryId: 'id', libraryName: 'name', mode: 'name', rowsAdded: 'count', rowsDeleted: 'count', rowsPreserved: 'count', toSemver: 'to' },
        status: { kind: 'live' },
    },
    'mcp.grant.created': { family: 'mcp_grant', label: 'audit_action_mcp_grant_created', meta: { clientId: 'id' }, status: { kind: 'live' } },
    'mcp.grant.revoked': { family: 'mcp_grant', label: 'audit_action_mcp_grant_revoked', meta: { admin: 'person', targetUserId: 'person' }, status: { kind: 'live' } },
    // The import pipeline, one entry per decision. `migration.abandoned` and
    // `migration.remapped` carry no metadata on purpose: what they record is
    // that somebody chose, and the run's own row already says what was chosen
    // on. `migration.row_repaired` is the same restraint for a stronger reason
    // — the corrected VALUES are a third party's contact details, and putting
    // them in a metadata blob would move personal data onto a table with a
    // different clock from the one the entries expire on.
    'migration.abandoned': { family: 'migration_batch', label: 'audit_action_migration_abandoned', meta: {}, status: { kind: 'live' } },
    'migration.applied': { family: 'migration_batch', label: 'audit_action_migration_applied', meta: { applied: 'count', failed: 'count', intent: 'name', invitesFailed: 'count', invitesSent: 'count', skipped: 'count' }, status: { kind: 'live' } },
    'migration.assistance_requested': { family: 'migration_batch', label: 'audit_action_migration_assistance_requested', meta: { intent: 'name' }, status: { kind: 'live' } },
    'migration.delivered': { family: 'migration_batch', label: 'audit_action_migration_delivered', meta: { byEntity: 'count', rows: 'count' }, status: { kind: 'live' } },
    // No metadata, for the same reason `migration.row_repaired` carries none,
    // and one step further: the reason a file could not be converted is free
    // text about somebody else's export, and `auditFromContext` redacts
    // metadata on the way in — so a redacted reason would be neither a record
    // nor a redaction anyone could read back. The reason lives on the run's own
    // manifest, which expires with the run.
    'migration.declined': { family: 'migration_batch', label: 'audit_action_migration_declined', meta: {}, status: { kind: 'live' } },
    'migration.remapped': { family: 'migration_batch', label: 'audit_action_migration_remapped', meta: {}, status: { kind: 'live' } },
    'migration.reverted': { family: 'migration_batch', label: 'audit_action_migration_reverted', meta: { refused: 'count', reverted: 'count' }, status: { kind: 'live' } },
    'migration.row_repaired': { family: 'migration_row', label: 'audit_action_migration_row_repaired', meta: {}, status: { kind: 'live' } },
    'migration.staged': { family: 'migration_batch', label: 'audit_action_migration_staged', meta: { intent: 'name', rows: 'count', vendor: 'name' }, status: { kind: 'live' } },
    'portal_access.revoked': { family: 'inspection', label: 'audit_action_portal_access_revoked', meta: { previousTokenHash: 'id', reason: 'reason', recipientEmail: 'person' }, status: { kind: 'live' } },
    'portal_access.rotated': { family: 'inspection', label: 'audit_action_portal_access_rotated', meta: { previousTokenHash: 'id', recipientEmail: 'person' }, status: { kind: 'live' } },
    'rating_system.cloned': { family: 'rating_system', label: 'audit_action_rating_system_cloned', meta: { name: 'name', sourceId: 'id' }, status: { kind: 'live' } },
    'rating_system.created': { family: 'rating_system', label: 'audit_action_rating_system_created', meta: { name: 'name', slug: 'name' }, status: { kind: 'live' } },
    'rating_system.deleted': { family: 'rating_system', label: 'audit_action_rating_system_deleted', meta: {}, status: { kind: 'live' } },
    'rating_system.updated': { family: 'rating_system', label: 'audit_action_rating_system_updated', meta: {}, status: { kind: 'live' } },
    'recommendation.created': { family: 'recommendation', label: 'audit_action_recommendation_created', meta: { name: 'name', severity: 'name' }, status: { kind: 'live' } },
    'recommendation.deleted': { family: 'recommendation', label: 'audit_action_recommendation_deleted', meta: {}, status: { kind: 'live' } },
    'recommendation.updated': { family: 'recommendation', label: 'audit_action_recommendation_updated', meta: {}, status: { kind: 'live' } },
    'role_profile.capabilities_updated': { family: 'contact_role_profile', label: 'audit_action_role_profile_capabilities_updated', meta: {}, status: { kind: 'live' } },
    'signing_key.rotate': { family: 'signing_key', label: 'audit_action_signing_key_rotate', meta: { fingerprint: 'id', retired: 'flag' }, status: { kind: 'live' } },
    'sms.compliance.provision': { family: 'tenant', label: 'audit_action_sms_compliance_provision', meta: { channel: 'name' }, status: { kind: 'live' } },
    'sms.compliance.resubmit': { family: 'tenant', label: 'audit_action_sms_compliance_resubmit', meta: { channel: 'name' }, status: { kind: 'live' } },
    'sms.consent.attest': { family: 'inspection', label: 'audit_action_sms_consent_attest', meta: { contactId: 'id' }, status: { kind: 'live' } },
    'sms.test_send': { family: 'tenant', label: 'audit_action_sms_test_send', meta: { ok: 'flag' }, status: { kind: 'live' } },
    'tag.created': { family: 'tag', label: 'audit_action_tag_created', meta: { name: 'name' }, status: { kind: 'live' } },
    'tag.deleted': { family: 'tag', label: 'audit_action_tag_deleted', meta: {}, status: { kind: 'live' } },
    'tag.linked': { family: 'inspection_item', label: 'audit_action_tag_linked', meta: { itemId: 'id', tagId: 'id' }, status: { kind: 'live' } },
    'tag.unlinked': { family: 'inspection_item', label: 'audit_action_tag_unlinked', meta: { itemId: 'id', tagId: 'id' }, status: { kind: 'live' } },
    'tag.updated': { family: 'tag', label: 'audit_action_tag_updated', meta: {}, status: { kind: 'live' } },
    'template.create': { family: 'template', label: 'audit_action_template_create', meta: { name: 'name' }, status: { kind: 'live' } },
    'template.delete': { family: 'template', label: 'audit_action_template_delete', meta: {}, status: { kind: 'live' } },
    'template.marketplace.updated': { family: 'template', label: 'audit_action_template_marketplace_updated', meta: { fromSemver: 'from', marketplaceId: 'id', newLocalId: 'id', oldLocalId: 'id', toSemver: 'to' }, status: { kind: 'live' } },
    'template.update': { family: 'template', label: 'audit_action_template_update', meta: { name: 'name' }, status: { kind: 'live' } },
    'user.invite': { family: 'user', label: 'audit_action_user_invite', meta: { role: 'name' }, status: { kind: 'live' } },
    'user.join': { family: 'user', label: 'audit_action_user_join', meta: { role: 'name' }, status: { kind: 'live' } },
    'user.password_change': { family: 'user', label: 'audit_action_user_password_change', meta: {}, status: { kind: 'live' } },
};

/**
 * Retired name -> the name that replaced it, DERIVED from the entries above.
 *
 * Never hand-maintained beside them: a second copy of this knowledge is a
 * second thing to forget, and the one that gets forgotten is always the copy
 * the reader is looking at.
 */
export const SUPERSEDED_ACTIONS: Record<string, AuditAction> = Object.fromEntries(
    Object.entries(AUDIT_REGISTRY)
        .filter(([, d]) => d.status.kind === 'superseded')
        .map(([action, d]) => [action, (d.status as { by: AuditAction }).by]),
);
