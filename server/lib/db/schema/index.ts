export * from './tenant';
export {
    ratingSystems,
    templates,
    inspections,
    inspectionResults,
    agreements,
    availability,
    availabilityOverrides,
    inspectionInspectors,
    serviceInspectors,
    comments,
    agreementRequests,
    agreementSigners,
    services,
    inspectionServices,
    discountCodes,
    automations,
    automationLogs,
    eventTypes,
    inspectionTypes,
    inspectionEvents,
    inspectionRequests,
    inspectionMediaPool,
    orphanedMedia,
    tags,
    inspectionItemTagLinks,
    conciergeConfirmTokens,
    commentUsage,
} from './inspection';
export { commercialSubtypes } from './commercial-subtypes';
export { contacts } from './contact';
export { contractorTypes } from './contractor-types';
export { invoices } from './invoice';
export {
    marketplaceTemplates,
    tenantMarketplaceImports,
    marketplaceLibraries,
    tenantLibraryImports,
    tenantMarketplaceImportHistory,
} from './marketplace';
export { inspectionMessages } from './message';
export type { MessageAttachment } from './message';
export { reportPdfs } from './report-pdf';
export type { ReportPdf, NewReportPdf } from './report-pdf';
export { signingKeys, esignAuditLogs } from './esign';
export type { SigningKey, NewSigningKey, EsignAuditLog, NewEsignAuditLog } from './esign';
export { qboConnections, qboEntityMap, qboSyncErrors } from './qbo';
// Apprentice review-queue subsystem removed 2026-06-13. The physical
// `apprentice_reviews` table is orphaned (D1 cannot drop tables) but all
// schema + code is gone (apprentices became plain inspectors).
// Guest invite subsystem removed 2026-06-13. The physical `guest_invites`
// table is orphaned (D1 cannot drop tables) but all schema + code is gone.
// Design System 0520 subsystem D — UnitTree hierarchy
export { inspectionUnits } from './units';
// Design System 0520 subsystem D — ObserverLink (no-account read-only links)
export { observerLinks } from './observer';
// Design System 0520 subsystem D — ReportVersions (snapshot-on-publish)
export { reportVersions } from './report-versions';
// Design System 0520 subsystem E — IdentitySwitcher links
export { userIdentityLinks } from './identity-links';

export { inspectionAccessTokens } from './portal-access';

// Track I-a GDPR (spec §4) — append-only DSAR erasure decision log.
// Track L (D7) — SMS consent ledger + disclosure versions.
// messaging_compliance: per-tenant TCR/provider registration state (#181 provider plan).
export { erasureLog, smsDisclosureVersions, smsConsentLog, messagingCompliance } from './compliance';
// Usage metering (Phase 1, SaaS-only).
export { usageCounters } from './usage';
// Repair Request Builder — buyer/agent/inspector negotiation lists per inspection.
export { repairRequests, repairRequestItems } from './repair-request';
export type { RepairRequest, RepairRequestItem } from './repair-request';
// Client documents — bidirectional per-inspection uploads (clients + inspectors).
export * from './client-upload';
