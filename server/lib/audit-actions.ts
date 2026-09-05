/**
 * The closed vocabulary of audit actions.
 *
 * It lives apart from the writer (`audit.ts`) because it is a different kind of
 * thing: the writer is a handful of functions that rarely change, and this is a
 * list that grows every time the product learns to record something new. Kept
 * together they made one file whose size was governed entirely by the list.
 *
 * Re-exported from `audit.ts`, so every existing importer keeps its import.
 *
 * ⚠️ A member here needs an entry in `audit-registry.ts` — the registry is typed
 * `Record<AuditAction, AuditActionDef>`, so adding a name without one does not
 * compile, and `scripts/check-audit-registry.mjs` walks the other direction.
 */
export type AuditAction =
    | 'inspection.create'
    | 'inspection.delete'
    | 'inspection.status_change'
    | 'inspection.complete'
    | 'inspection.send_pdf'
    // The order-wide report gate released for one inspection, and put back.
    // Audited because an unlock hands a client a report the tenant's own rules
    // said to hold, and the reason for that is worth keeping.
    | 'inspection.report_unlocked'
    | 'inspection.report_relocked'
    // The courtesy translation of one report, replaced or taken down. Audited
    // because regenerating spends money on a workspace's behalf and removing
    // takes something away from a client who was already sent it — and because
    // the row is the only record that either happened: neither action cuts a
    // report version, since neither changes an English byte.
    | 'inspection.report_translation_regenerated'
    | 'inspection.report_translation_removed'
    | 'inspection.send_sms'
    | 'inspection.rescheduled'
    | 'inspection.bulk_assign'
    | 'inspection.bulk_status'
    | 'inspection.template_upgraded'
    | 'inspection.results_batch_patched'
    | 'inspection.sync_conflict_resolved'
    | 'inspection.share_agent'
    | 'inspection.property_facts.update'
    | 'inspection.pca_narrative.update'
    // The inspector's report-level narrative on `reports`. Distinct from
    // `pca_narrative` above, which is the commercial PCA block set on
    // `inspections` — two different fields on two different tables.
    | 'inspection.report_narrative.update'
    | 'inspection.media.attach'
    | 'inspection.media.video.finalize'
    | 'inspection.media.video.delete'
    | 'template.create'
    | 'template.update'
    | 'template.delete'
    | 'template.marketplace.updated'
    | 'library.marketplace.updated'
    | 'user.invite'
    | 'user.join'
    | 'user.password_change'
    // An owner clearing ANOTHER member's second factor. Its own action rather
    // than a generic update, because it is the only one that lowers somebody
    // else's authentication requirement and it leaves no other trace: the
    // member's row afterwards is indistinguishable from one that never
    // enrolled, so the audit row is the whole record that it happened.
    | 'user.two_factor_reset'
    | 'agreement.create'
    | 'agreement.send'
    | 'agreement.remind'
    | 'agreement.sent'
    | 'agreement.viewed'
    | 'agreement.declined'
    | 'agreement.inspector_signed'
    // The tenant retired its e-signature key and minted a replacement. Nothing
    // already signed changes, but WHICH key covers which stretch of a company's
    // evidence is exactly the question a later reader will have, and only this
    // row answers it.
    | 'signing_key.rotate'
    | 'recommendation.created'
    | 'recommendation.updated'
    | 'recommendation.deleted'
    | 'contractor_type.created'
    | 'contractor_type.updated'
    | 'contractor_type.deleted'
    | 'credential.created'
    | 'credential.updated'
    | 'credential.deleted'
    | 'credential.image_uploaded'
    | 'defect_category.created'
    | 'defect_category.updated'
    | 'defect_category.deleted'
    | 'rating_system.created'
    | 'rating_system.updated'
    | 'rating_system.cloned'
    | 'rating_system.deleted'
    | 'data.export'
    | 'data.import'
    // Import runs. Ten, not one: a run is a sequence of separate decisions by
    // separate people, and a trail that recorded them all as 'data.import'
    // could not answer the question it exists for — who chose this. The last
    // THREE are OURS; the rest are the operator's.
    //
    // ⚠️ "OURS" now means something it did not when this list was written. Until
    // the actor column existed, only the event NAME was ours — the actor those
    // rows recorded was the customer's own administrator, because a support
    // session was signed in as one. `actor_kind` is what makes the sentence true.
    | 'migration.staged'
    | 'migration.assistance_requested'
    | 'migration.remapped'
    | 'migration.row_repaired'
    | 'migration.applied'
    | 'migration.reverted'
    | 'migration.abandoned'
    | 'migration.delivered'
    | 'migration.declined'
    | 'migration.acknowledged'
    // A person at the deployment operator opened the file a workspace uploaded.
    // The only one of these written by a route that REFUSES to answer unless the
    // row lands, because a served download with no row is the state it exists to
    // prevent.
    | 'migration.source_downloaded'
    | 'data.delete'
    | 'audit.view'
    | 'comment.created'
    | 'comment.updated'
    | 'comment.deleted'
    | 'config.integration.update'
    | 'config.secrets.update'
    | 'config.attention_thresholds.update'
    | 'config.dashboard_columns.update'
    | 'config.tenant_config.patch'
    // The ZIP territories that decide who is even OFFERED a booking. Audited
    // because clearing a list silently widens one inspector's reach and
    // narrowing one can make a workspace look closed in a whole postcode.
    | 'config.service_areas.replace'
    | 'tag.created'
    | 'tag.updated'
    | 'tag.deleted'
    | 'tag.linked'
    | 'tag.unlinked'
    | 'inspection.property_facts.autofill'
    | 'inspection.template_snapshot.update'
    | 'inspection.rating_system.switch'
    | 'admin.migrate_finding_keys'
    | 'sms.consent.attest'
    | 'sms.test_send'
    | 'sms.compliance.provision'
    | 'sms.compliance.resubmit'
    | 'mcp.grant.created'
    | 'mcp.grant.revoked'
    // Commercial PCA Phase M — ASTM compliance artifacts (dual sign-off / PSQ / doc-review).
    | 'inspection.compliance.signoff'
    | 'inspection.compliance.signoff_removed'
    | 'inspection.compliance.doc_review_seeded'
    | 'inspection.compliance.doc_review_updated'
    | 'inspection.compliance.psq_updated'
    | 'inspection.compliance.psq_status_changed'
    // Agent unified link (Spec 3, Task 2) — single-use magic-login code issue.
    | 'agent.magic_login.issued'
    // Written by fulfill-booking.ts through the slug writer, which until now
    // typed `action` as string — this entry and that type closed together.
    | 'booking.routing.applied'
    // IA-36 ④ — report-delivery credential lifecycle. Rotation destroys the old
    // secret in place (the (inspection, recipient) unique index leaves no dead
    // row behind), so these events are the ONLY durable answer to "the customer
    // says their old link still opens / stopped opening — what happened?".
    // Metadata carries the previous token's HASH; the plaintext is never logged.
    | 'portal_access.rotated'
    | 'portal_access.revoked'
    // Two-layer role model — a role profile's capability overrides changed.
    // Metadata carries the RESOLVED before/after sets, so "who widened this,
    // and when" is answerable without replaying kind baselines by hand.
    | 'role_profile.capabilities_updated';
