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
    messageTemplates,
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
    defectCategories,
    costItems,
    reports,
    inspectorServiceAreas,
} from './inspection';
export { inspectorCredentials } from './inspection/inspector-credentials';
export { contacts } from './contact';
export { contractorTypes } from './contractor-types';
export { invoices } from './invoice';
export { orderPayments } from './order-payment';
export type { OrderPayment, NewOrderPayment } from './order-payment';
export {
    marketplaceLibraries,
    tenantLibraryImports,
    tenantMarketplaceImportHistory,
} from './marketplace';
export { inspectionMessages } from './message';
export type { MessageAttachment } from './message';
export { reportPdfs } from './report-pdf';
export type { ReportPdf, NewReportPdf } from './report-pdf';
// Courtesy translations — one per (report, language), keyed to the English it
// was made from so a translation of a superseded document is withheld.
export { reportTranslations } from './report-translation';
export type { ReportTranslation, NewReportTranslation } from './report-translation';
export { signingKeys, esignAuditLogs } from './esign';
export type { SigningKey, NewSigningKey, EsignAuditLog, NewEsignAuditLog } from './esign';
export { qboConnections, qboEntityMap, qboSyncErrors } from './qbo';
export { calendarBlocks, calendarConnections, calendarConnectionReadCalendars, calendarExternalLinks } from './calendar';
export { tenantCustomHolidays } from './holidays';
// Design System 0520 subsystem D — UnitTree hierarchy
export { inspectionUnits } from './units';
// Design System 0520 subsystem D — ReportVersions (snapshot-on-publish)
export { reportVersions } from './report-versions';
export { inspectionAccessTokens, reportViews } from './portal-access';
export { contactRoleProfiles, inspectionPeople } from './inspection/role-profiles';

// Track I-a GDPR (spec §4) — append-only DSAR erasure decision log.
// Track L (D7) — SMS consent ledger + disclosure versions.
// messaging_compliance: per-tenant TCR/provider registration state (#181 provider plan).
export { erasureLog, smsDisclosureVersions, smsConsentLog, messagingCompliance, deploymentLegalVersions } from './compliance';
// WH-2 — tenant SMS delivery-status ledger + shared webhook idempotency ledger.
// WH-3 — tenant email suppression list (append-only; hard bounce / complaint).
export { smsDeliveryStatus, processedWebhookEvents, emailSuppressions } from './messaging';
export type { SmsDeliveryStatus, ProcessedWebhookEvent, EmailSuppression, NewEmailSuppression } from './messaging';
// Usage metering (Phase 1, SaaS-only).
export { usageCounters } from './usage';
// Repair Request Builder — buyer/agent/inspector negotiation lists per inspection.
export { repairRequests, repairRequestItems } from './repair-request';
export type { RepairRequest, RepairRequestItem } from './repair-request';
// Client documents — bidirectional per-inspection uploads (clients + inspectors).
export * from './client-upload';
// Commercial PCA Phase M — ASTM E2018 compliance artifacts (dual sign-off, PSQ, document review).
export { reportSignoff, psqResponses, documentReviewItems } from './pca-compliance';
// Commercial PCA Phase W — async .docx export status row (R2 key + lifecycle).
export { reportExports } from './report-export';
export type { ReportExport, NewReportExport } from './report-export';
// Recipient notification preferences — one answer per (subject, class, channel).
export { notificationPreferences } from './notification-preferences';
export type { NotificationPreference, NewNotificationPreference } from './notification-preferences';
// Generic idempotency ledger (portal #107) — one row per (tenant, key).
export { idempotencyKeys } from './idempotency';
export type { IdempotencyKey, NewIdempotencyKey } from './idempotency';
// Pay splits (#278) — per-service-line inspector earnings, recorded not derived.
export { servicePayRules, inspectionServicePaySplits } from './pay-split';
export type { ServicePayRule, InspectionServicePaySplit } from './pay-split';
// AI call provenance — provider/mode/model/prompt-version per call. Metadata
// only; the prompt text is never stored (see the file for why that is a rule).
export { aiCallProvenance } from './ai';
export type { AiCallProvenance, NewAiCallProvenance } from './ai';
// AI content review evidence — who reviewed which artifact against which AI
// call. Points AT the provenance row; model/prompt version are read through it
// rather than copied (see the file for why that is a rule, not a shortcut).
export { aiContentReviews } from './ai';
export type { AiContentReview, NewAiContentReview } from './ai';

// Migration intake — staged rows for a vendor import, so a run is resumable
// row by row and undoable per row rather than all-or-nothing.
export { migrationBatches, migrationRows } from './migration-intake';
export {
    MIGRATION_INTENTS,
    MIGRATION_CONFLICT_POLICIES,
    MIGRATION_ROW_RESOLUTIONS,
} from './migration-intake';
export type {
    MigrationIntent,
    MigrationConflictPolicy,
    MigrationRowResolution,
} from './migration-intake';
