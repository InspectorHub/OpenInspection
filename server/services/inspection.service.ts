import { type CoverCrop, type PhotoCrop } from '../lib/validations/inspection.schema';
import { ScopedDB } from '../lib/db/scoped';
import type { AgreementService } from './agreement.service';
import { type ReportMediaContext } from '../lib/report-video';
import { type ImagesBinding } from '../lib/media/strip-exif';
import { type PdfSettings } from '../lib/pdf-settings';

// Module-level types, constants, and pure helpers now live in
// ./inspection/shared.ts (single source of truth shared by the facade + every
// sub-service). Re-exported here so the public API surface of this module is
// unchanged (callers + tests still import these from 'inspection.service').
import {
    resolveCoverUrl,
    sanitizeDefectStates,
    resolveRequireDefectFields,
    computePublishReadinessFromState,
    rankCannedCommentsForItem,
    type PublishBlockingDefect,
    type RequireDefectFields,
    type PublishReadiness,
    type Inspection,
    type InspectionListParams,
    type CreateInspectionData,
    type PropertyFacts,
    type PropertyFactFoundation,
    type CannedRatingBucket,
    type CannedCommentLike,
    type RankCommentsOpts,
} from './inspection/shared';
import { InspectionSharingService } from './inspection/inspection-sharing.service';
import { InspectionAnalyticsService } from './inspection/inspection-analytics.service';
import { InspectionStatusService } from './inspection/inspection-status.service';
import { InspectionAnnotationsService } from './inspection/inspection-annotations.service';
import { InspectionPhotoService } from './inspection/inspection-photo.service';
import { InspectionResultsService } from './inspection/inspection-results.service';
import { InspectionReportService } from './inspection/inspection-report.service';
import { InspectionPublishService } from './inspection/inspection-publish.service';
import { InspectionCoreService } from './inspection/inspection-core.service';
export {
    resolveCoverUrl,
    sanitizeDefectStates,
    resolveRequireDefectFields,
    computePublishReadinessFromState,
    rankCannedCommentsForItem,
};
export type {
    PublishBlockingDefect,
    RequireDefectFields,
    PublishReadiness,
    PropertyFacts,
    CannedRatingBucket,
    CannedCommentLike,
    RankCommentsOpts,
};

/**
 * Service to handle all inspection-related business logic.
 */
export class InspectionService {
    // Sub-services that own a focused slice of the former monolith. Each is
    // constructed from the same injected deps (positional construction of the
    // facade itself is unchanged). The facade delegates its public methods to
    // these — see the delegation stubs below.
    private readonly sharing: InspectionSharingService;
    private readonly analytics: InspectionAnalyticsService;
    private readonly status: InspectionStatusService;
    private readonly annotations: InspectionAnnotationsService;
    private readonly photo: InspectionPhotoService;
    private readonly results: InspectionResultsService;
    private readonly report: InspectionReportService;
    private readonly publish: InspectionPublishService;
    private readonly core: InspectionCoreService;

    constructor(db: D1Database, r2?: R2Bucket, sdb?: ScopedDB, kv?: KVNamespace, images?: ImagesBinding) {
        this.sharing = new InspectionSharingService(db, r2, sdb, kv, images);
        this.analytics = new InspectionAnalyticsService(db, r2, sdb, kv, images, this);
        this.status = new InspectionStatusService(db, r2, sdb, kv, images);
        this.annotations = new InspectionAnnotationsService(db, r2, sdb, kv, images, this);
        this.photo = new InspectionPhotoService(db, r2, sdb, kv, images, this);
        this.results = new InspectionResultsService(db, r2, sdb, kv, images);
        this.report = new InspectionReportService(db, r2, sdb, kv, images);
        this.publish = new InspectionPublishService(db, r2, sdb, kv, images, this);
        this.core = new InspectionCoreService(db, r2, sdb, kv, images);
    }

    /**
     * Lists inspections with pagination and filtering.
     */
    async listInspections(tenantId: string, params: InspectionListParams) {
        return this.core.listInspections(tenantId, params);
    }

    /**
     * Fetches counts for the dashboard.
     */
    async getStats(tenantId: string) {
        return this.core.getStats(tenantId);
    }

    /**
     * Fetches a single inspection with its template.
     */
    /**
     * Design System 0520 subsystem E P1.2 — Publish pre-flight gates.
     *
     * Loads the inspection + parsed inspection_results.data and
     * delegates to the pure aggregator in server/lib/preflight.ts.
     */
    async computePreflight(inspectionId: string, tenantId: string) {
        return this.core.computePreflight(inspectionId, tenantId);
    }

    async getInspection(id: string, tenantId: string) {
        return this.core.getInspection(id, tenantId);
    }

    /**
     * Creates a new inspection.
     */
    async createInspection(tenantId: string, data: CreateInspectionData & { inspectorId?: string; clientContactId?: string }): Promise<Inspection> {
        return this.core.createInspection(tenantId, data);
    }

    /**
     * #119 — Re-inspection. Creates a NEW draft inspection linked to a published
     * baseline (the original OR a prior re-inspection). Seeds inspection_results.data
     * for ONLY the selected items, each `{ original, followupStatus: null }`, where
     * `original` carries the root finding forward from the baseline's latest published
     * report_versions snapshot (or the propagated `.original` if the baseline is itself
     * a re-inspection).
     *
     * GATE: the baseline must be published — i.e. have ≥1 report_versions row.
     */
    async createReinspection(
        tenantId: string,
        baselineId: string,
        opts: { selectedItemIds: string[]; inspectorId?: string },
    ): Promise<Inspection> {
        return this.core.createReinspection(tenantId, baselineId, opts);
    }

    /**
     * #119 (Task 6) — Candidate items for the "Create re-inspection" modal.
     * Returns the baseline's still-open flagged items so the UI can pre-check
     * the ones worth carrying forward. Computed off the SAME published snapshot
     * `createReinspection` reads, so the returned `itemId`s are exactly the keys
     * accepted as `selectedItemIds`.
     *
     * `open` default-check rule (mirrors the task spec):
     *   - ORIGINAL baseline (no sourceInspectionId): item is open when its rating
     *     bucket is `defect` or `monitor`.
     *   - RE-INSPECTION baseline: item is open when its `followupStatus` is a
     *     non-closed status (via isOpenStatus + the tenant's status set).
     *
     * Returns [] when the baseline is unpublished (no snapshot) — the caller
     * gates the action on publication anyway, and the modal renders an empty
     * state. Labels come from the baseline's templateSnapshot; an unmatched key
     * degrades to the raw item id.
     */
    async getReinspectCandidates(
        tenantId: string,
        baselineId: string,
    ): Promise<Array<{ itemId: string; label: string; originalNotes: string | null; open: boolean }>> {
        return this.core.getReinspectCandidates(tenantId, baselineId);
    }

    /**
     * IA-1: Post-create hook — write priceOverride onto inspection_services rows
     * that were already inserted by createInspection. Called by the handler AFTER
     * createInspection returns so it can use the resolved inspection id.
     * Only rows whose serviceId appears in selections AND carry a priceOverrideCents
     * value are updated; rows without an override are left with priceOverride=null.
     */
    async applyServicePriceOverrides(
        inspectionId: string,
        tenantId: string,
        selections: Array<{ serviceId: string; priceOverrideCents?: number }>,
    ): Promise<void> {
        return this.core.applyServicePriceOverrides(inspectionId, tenantId, selections);
    }

    /**
     * Design System 0520 subsystem B phase 5 — NewInspectionWizard creation
     * path. Thin wrapper around createInspection that maps the wizard's
     * 4-step payload onto the existing column set + the new team_mode /
     * lead_inspector_id / helper_inspector_ids columns added in subsystem
     * B phase 1.
     *
     * Returns the freshly-inserted inspection id so the wizard factory can
     * redirect to /inspections/:id/edit.
     *
     * Services array (wizard step 2) is stored informational-only on this
     * MVP — wiring to the inspectionServices catalog needs slug→id
     * lookup which is a separate follow-up.
     */
    async createFromWizard(
        tenantId: string,
        creatorUserId: string,
        input: import('../lib/validations/wizard.schema').CreateInspectionFromWizardInput,
    ): Promise<{ id: string }> {
        return this.core.createFromWizard(tenantId, creatorUserId, input);
    }

    /**
     * Clones an existing inspection.
     */
    async cloneInspection(id: string, tenantId: string): Promise<Inspection> {
        return this.core.cloneInspection(id, tenantId);
    }

    async getPropertyFacts(id: string, tenantId: string): Promise<PropertyFacts> {
        return this.results.getPropertyFacts(id, tenantId);
    }

    async updatePropertyFacts(id: string, tenantId: string, facts: {
        yearBuilt?:      number | null | undefined;
        sqft?:           number | null | undefined;
        foundationType?: PropertyFactFoundation | null | undefined;
        lotSize?:        string | null | undefined;
        bedrooms?:       number | null | undefined;
        bathrooms?:      number | null | undefined;
    }): Promise<PropertyFacts> {
        return this.results.updatePropertyFacts(id, tenantId, facts);
    }

    async updateResults(id: string, tenantId: string, data: Record<string, unknown>) {
        return this.results.updateResults(id, tenantId, data);
    }

    async updateTemplateSnapshot(id: string, tenantId: string, snapshot: unknown) {
        return this.results.updateTemplateSnapshot(id, tenantId, snapshot);
    }

    async switchRatingSystem(
        id: string,
        tenantId: string,
        ratingSystemId: string,
        mode: 'remap' | 'clear',
    ): Promise<{ remapped: number; cleared: number; total: number }> {
        return this.results.switchRatingSystem(id, tenantId, ratingSystemId, mode);
    }

    async uploadPhoto(id: string, tenantId: string, itemId: string, file: File) {
        return this.photo.uploadPhoto(id, tenantId, itemId, file);
    }

    async getMediaCenter(
        inspectionId: string,
        tenantId: string,
    ): Promise<{
        attached: Array<{
            key: string;
            originalKey: string;
            url: string;
            itemId: string;
            itemLabel: string;
            sectionId: string;
            sectionTitle: string;
            photoIndex: number;
            annotated: boolean;
            defectId?: string;
        }>;
        pool: Array<{
            id: string;
            key: string;
            url: string;
            uploadedAt: number;
            takenAt: number | null;
        }>;
    }> {
        return this.photo.getMediaCenter(inspectionId, tenantId);
    }

    async uploadPoolPhoto(
        inspectionId: string,
        tenantId: string,
        file: File,
        opts?: { takenAt?: number | null | undefined },
    ): Promise<{
        id: string;
        key: string;
        url: string;
        uploadedAt: number;
        takenAt: number | null;
    }> {
        return this.photo.uploadPoolPhoto(inspectionId, tenantId, file, opts);
    }

    async attachPoolPhoto(
        inspectionId: string,
        tenantId: string,
        poolId: string,
        itemId: string,
        sectionId?: string,
    ): Promise<{ key: string; itemId: string; photoIndex: number }> {
        return this.photo.attachPoolPhoto(inspectionId, tenantId, poolId, itemId, sectionId);
    }

    async reorderItemPhotos(
        inspectionId: string,
        tenantId: string,
        itemId: string,
        order: string[],
        sectionId?: string,
    ): Promise<void> {
        return this.photo.reorderItemPhotos(inspectionId, tenantId, itemId, order, sectionId);
    }

    async detachItemPhoto(
        inspectionId: string,
        tenantId: string,
        itemId: string,
        photoIndex: number,
        sectionId?: string,
    ): Promise<void> {
        return this.photo.detachItemPhoto(inspectionId, tenantId, itemId, photoIndex, sectionId);
    }

    async revertPhotoEdits(
        inspectionId: string,
        tenantId: string,
        itemId: string,
        photoIndex: number,
        sectionId?: string,
    ): Promise<void> {
        return this.photo.revertPhotoEdits(inspectionId, tenantId, itemId, photoIndex, sectionId);
    }

    async moveItemPhoto(
        inspectionId: string,
        tenantId: string,
        fromItemId: string,
        photoIndex: number,
        toItemId: string,
        fromSectionId?: string,
        toSectionId?: string,
    ): Promise<{ toItemId: string; photoIndex: number }> {
        return this.photo.moveItemPhoto(inspectionId, tenantId, fromItemId, photoIndex, toItemId, fromSectionId, toSectionId);
    }

    async updateMediaAnnotations(
        inspectionId: string,
        mediaId: string,
        tenantId: string,
        annotations: string,
        caption: string,
    ): Promise<
        | { id: string; annotations: string | null; caption: string | null; updatedAt: number }
        | null
    > {
        return this.annotations.updateMediaAnnotations(inspectionId, mediaId, tenantId, annotations, caption);
    }

    async deletePoolPhoto(
        inspectionId: string,
        tenantId: string,
        poolId: string,
    ): Promise<void> {
        return this.photo.deletePoolPhoto(inspectionId, tenantId, poolId);
    }

    async isInspectionPhotoKey(inspectionId: string, tenantId: string, key: string): Promise<boolean> {
        return this.photo.isInspectionPhotoKey(inspectionId, tenantId, key);
    }

    async saveAnnotation(
        inspectionId: string,
        tenantId: string,
        itemId: string,
        photoIndex: number,
        compositeBytes: ArrayBuffer,
        nodesJson: string,
        sectionId?: string,
        opts?: { skipResultsWrite?: boolean },
    ): Promise<{ annotatedKey: string }> {
        return this.annotations.saveAnnotation(inspectionId, tenantId, itemId, photoIndex, compositeBytes, nodesJson, sectionId, opts);
    }

    async setCroppedCover(
        inspectionId: string,
        tenantId: string,
        sourceKey: string,
        bakedBytes: ArrayBuffer,
        crop: CoverCrop,
    ): Promise<{ coverImageKey: string }> {
        return this.annotations.setCroppedCover(inspectionId, tenantId, sourceKey, bakedBytes, crop);
    }

    async saveCroppedItemPhoto(
        inspectionId: string,
        tenantId: string,
        itemId: string,
        photoIndex: number,
        bakedBytes: ArrayBuffer,
        crop: PhotoCrop,
        sectionId?: string,
        opts?: { skipResultsWrite?: boolean },
    ): Promise<{ croppedKey: string }> {
        return this.annotations.saveCroppedItemPhoto(inspectionId, tenantId, itemId, photoIndex, bakedBytes, crop, sectionId, opts);
    }

    /**
     * Builds structured report data for a given inspection.
     *
     * `makePhotoUrl` lets the caller control how each photo key is turned into
     * a fetchable URL. The default points at the authenticated editor serve
     * route; the public report endpoint passes a token-scoped public URL so the
     * no-login report viewer can load images (A-9).
     */
    async getReportData(
        inspectionId: string,
        tenantId: string,
        makePhotoUrl: (key: string) => string =
            (key) => `/api/inspections/${inspectionId}/photo?key=${encodeURIComponent(key)}`,
        videoCtx?: ReportMediaContext,
    ) {
        return this.report.getReportData(inspectionId, tenantId, makePhotoUrl, videoCtx);
    }

    /**
     * C-10 ③-A.4 — live progress for the public observer view
     * (`/observe/inspections/:id`). Derives per-section completion from the same
     * resolved report shape getReportData builds, so the section/item structure
     * (templateSnapshot-aware) stays in one place. An item counts as "done" once
     * the inspector has captured a rating (rich items) or a value (data points).
     */
    async getObserveProgress(inspectionId: string, tenantId: string) {
        return this.analytics.getObserveProgress(inspectionId, tenantId);
    }

    /**
     * C-10 ③-A.2 — the public report-gate payload ("your report is almost ready,
     * here's what's blocking it + the CTA"). Mirrors the report double-gate used
     * by /report/:id: agreement-signed first (chronologically
     * first gate), then invoice-paid. Returns null when the inspection does not
     * exist OR is not actually gated (nothing to show). The `tenantSlug` is only
     * used to build the agreement-sign URL — authority is always `tenantId`.
     *
     * Track I-a Task 7 — when BOTH the agreement and the payment gates are
     * outstanding, the CTA routes to the combined `/checkout/{slug}/{signerToken}`
     * page ('Sign & pay') instead of the agreement-only sign page. `reason` stays
     * 'agreement' (the first-reported gate) for consumer compatibility. The signer
     * token is reconstructed server-side via the optional `agreementService`
     * (tier-2 link); when it is absent or yields no outstanding signer the gate
     * falls back to the legacy single-gate agreement URL.
     */
    async getReportGate(inspectionId: string, tenantId: string, tenantSlug: string, agreementService?: AgreementService): Promise<{
        reason: 'payment' | 'agreement';
        companyName: string;
        primaryColor: string | null;
        actionUrl: string;
        actionLabel: string;
        propertyAddress: string | null;
        inspectorName: string | null;
        inspectorEmail: string | null;
        inspectorPhone: string | null;
        inspectorLicense: string | null;
        scheduledDate: string | null;
        amountCents: number | null;
        currency: string | null;
    } | null> {
        return this.publish.getReportGate(inspectionId, tenantId, tenantSlug, agreementService);
    }

    /**
     * Issue #111 — single aggregate payload for the `/inspections/:id` hub page.
     * The page loader makes ONE round trip and renders six blocks (People,
     * Schedule, Services, Agreement, Invoice, Report status) from this result.
     *
     * Composition only — every block reuses an existing, already-tenant-scoped
     * primitive so the hub never re-derives logic that lives elsewhere:
     *   - `people`            → getPeopleCard (inspector/client/agents)
     *   - `publishReadiness`  → computePublishReadiness (report-status gate)
     *   - `invoice`           → InvoiceService.findByInspectionId (+ its getStatus)
     *
     * Returns `null` when the inspection does not exist OR belongs to another
     * tenant; the route turns that into a 404. Every direct query filters by
     * tenantId. `tenantSlug` is passed through verbatim for building
     * `/report/:tenantSlug/:id` style links on the page.
     */
    async getInspectionHub(inspectionId: string, tenantId: string, tenantSlug: string): Promise<{
        inspection: {
            id: string;
            propertyAddress: string;
            clientName: string | null;
            clientEmail: string | null;
            clientPhone: string | null;
            clientContactId: string | null;
            status: string;
            reportStatus: string;
            date: string | null;
            inspectorId: string | null;
            templateId: string | null;
            price: number;
            paymentStatus: string;
            paymentRequired: boolean;
            agreementRequired: boolean;
            coverPhoto: string | null;
            referredByAgentId: string | null;
            sellingAgentId: string | null;
            createdAt: string | null;
        };
        tenantSlug: string;
        people: Awaited<ReturnType<InspectionService['getPeopleCard']>>;
        services: Array<{ id: string; name: string; priceCents: number }>;
        agreements: Array<{ id: string; name: string }>;
        agreementRequests: Array<{
            id: string;
            status: string;
            clientEmail: string;
            signedAt: string | null;
            createdAt: string | null;
        }>;
        invoice: { id: string; status: string; amountCents: number; sentAt: string | null; paidAt: string | null } | null;
        publishReadiness: { ready: boolean; blockingCount: number };
    } | null> {
        return this.publish.getInspectionHub(inspectionId, tenantId, tenantSlug);
    }

    /**
     * Track E1 (ITB §11, UC-ITB-07) — Repair List aggregation.
     *
     * Walks every section of the published report (via getReportData so we
     * stay aligned with the rating-system snapshot resolution + photo
     * surfacing logic) and returns a flat list of defect-rated items only.
     * Each row is a contractor punch-list entry: section breadcrumb + item
     * label + the effective comment + contractor recommendation tag +
     * estimate range + photo URLs.
     *
     * Custom (per-inspection) defects added by the inspector are also
     * surfaced — they live under inspection_results.data[itemId].customComments
     * and are not exposed by getReportData yet, so we pull them separately.
     */
    async getRepairList(inspectionId: string, tenantId: string) {
        return this.analytics.getRepairList(inspectionId, tenantId);
    }

    /**
     * Returns tab counts for the inspection list UI.
     * Single query with 6 conditional aggregates to avoid N+1.
     */
    async getCounts(tenantId: string): Promise<{
        all: number; today: number; upcoming: number;
        past: number; unconfirmed: number; inProgress: number;
    }> {
        return this.analytics.getCounts(tenantId);
    }

    /**
     * Round-2 F1 — list every party associated with an inspection so the
     * Publish modal can render per-recipient Email + Text checkboxes.
     *
     * Returned shape (`InspectionRecipient[]`):
     *   - role: 'client' | 'agent_buyer' | 'agent_listing'
     *   - contactId: contact row id (null for the inline client — clients are
     *     stored as columns on `inspections`, not in `contacts`)
     *   - name, email, phone
     *
     * Recipients without any contact info (no email AND no phone) are dropped
     * because there is no way to deliver to them. Tenant-scoped via the
     * compound `where(eq(id), eq(tenantId))` guard on the inspection lookup
     * AND the contact lookup.
     */
    async getRecipientList(inspectionId: string, tenantId: string): Promise<Array<{
        contactId: string | null;
        name:      string;
        role:      'client' | 'agent_buyer' | 'agent_listing';
        email:     string | null;
        phone:     string | null;
    }>> {
        return this.core.getRecipientList(inspectionId, tenantId);
    }

    /**
     * Round-2 F3 — People card payload (Spectora §E.2 / §4.1).
     *
     * Groups every party connected to an inspection by role so the inspection
     * Settings page can render a contact card with role chips:
     *
     *   - Inspector  → users row referenced by inspectorId
     *   - Client     → inline columns on inspections (clientName/email/phone)
     *   - Buyer's Agent  → contacts row pointed at by referredByAgentId
     *   - Listing Agent  → contacts row pointed at by sellingAgentId
     *
     * Schema currently allows ONE buyer agent + ONE listing agent per
     * inspection. The result returns arrays for forward-compat (so the UI
     * can render "Buyer's Agent · 2" if multi-agent ever ships) without a
     * follow-up service refactor.
     */
    async getPeopleCard(inspectionId: string, tenantId: string): Promise<{
        inspector:     { id: string; name: string | null; email: string; phone: string | null } | null;
        client:        { name: string; email: string | null; phone: string | null } | null;
        buyerAgents:   Array<{ id: string; name: string; email: string | null; phone: string | null; agency: string | null }>;
        listingAgents: Array<{ id: string; name: string; email: string | null; phone: string | null; agency: string | null }>;
    }> {
        return this.core.getPeopleCard(inspectionId, tenantId);
    }

    /**
     * Publishes an inspection report (transitions to delivered status).
     */
    async publishInspection(inspectionId: string, tenantId: string, _options: {
        theme: string;
        notifyClient: boolean;
        notifyAgent: boolean;
        requireSignature: boolean;
        requirePayment: boolean;
        // Round-2 F1 — optional per-recipient delivery list. Older callers
        // (legacy publish modal, AI agent flows) keep working without it.
        recipients?: Array<{ contactId: string | null; channels: Array<'email' | 'text'> }>;
        sendAgreementCopy?: boolean;
    }) {
        return this.publish.publishInspection(inspectionId, tenantId, _options);
    }

    async confirmInspection(tenantId: string, id: string): Promise<void> {
        return this.status.confirmInspection(tenantId, id);
    }

    async cancelInspection(tenantId: string, id: string, reason: string, notes?: string): Promise<void> {
        return this.status.cancelInspection(tenantId, id, reason, notes);
    }

    async uncancelInspection(tenantId: string, id: string): Promise<void> {
        return this.status.uncancelInspection(tenantId, id);
    }

    async submitReport(inspectionId: string, tenantId: string): Promise<void> {
        return this.status.submitReport(inspectionId, tenantId);
    }

    async returnReport(inspectionId: string, tenantId: string): Promise<void> {
        return this.status.returnReport(inspectionId, tenantId);
    }

    async unpublishReport(inspectionId: string, tenantId: string): Promise<void> {
        return this.status.unpublishReport(inspectionId, tenantId);
    }

    async markPaymentReceived(tenantId: string, inspectionId: string): Promise<void> {
        return this.status.markPaymentReceived(tenantId, inspectionId);
    }

    /**
     * Spec 5B P2B — Compute defect category counts for a single inspection.
     *
     * Walks the resolved v2 tabs (template canned defects + per-inspection
     * custom defects) and returns counts of `included` defects bucketed by
     * category. Used by the inspection list / dashboard cards. Returns
     * zeros when the inspection has no template / no results.
     */
    async getDefectStats(inspectionId: string, tenantId: string): Promise<{ safety: number; recommendation: number; maintenance: number }> {
        return this.analytics.getDefectStats(inspectionId, tenantId);
    }

    /**
     * Spec 5B P2B — Batch defect stats for many inspections at once.
     *
     * Single SQL fetch of all inspection_results rows for the given IDs,
     * then in-memory aggregation. Avoids N+1 round trips when the
     * dashboard renders 50+ cards. Returns a Map keyed by inspection id.
     */
    async getDefectStatsBatch(tenantId: string, inspectionIds: string[]): Promise<Map<string, { safety: number; recommendation: number; maintenance: number }>> {
        return this.analytics.getDefectStatsBatch(tenantId, inspectionIds);
    }

    /**
     * Returns bucketed inspection lists for the dashboard view.
     * All filtering is done in-process from a single tenant query.
     * Note: uses the `date` column (TEXT "YYYY-MM-DD") for scheduling logic.
     */
    async getDashboardBuckets(tenantId: string) {
        return this.analytics.getDashboardBuckets(tenantId);
    }

    /**
     * Generates a 30-day shareable agent view token stored in KV.
     * The token grants read-only access to the report without requiring login.
     */
    async generateAgentViewToken(tenantId: string, inspectionId: string): Promise<string> {
        return this.sharing.generateAgentViewToken(tenantId, inspectionId);
    }

    /**
     * Resolves an agent view token from KV.
     */
    async resolveAgentViewToken(token: string): Promise<{ inspectionId: string; tenantId: string } | null> {
        return this.sharing.resolveAgentViewToken(token);
    }

    /**
     * Task 12 — check whether an inspection has all required defect fields
     * filled in for every included defect (location + trade). Returns the
     * PublishReadiness payload so the pre-publish gate can surface blocking
     * defects to the inspector.
     *
     * Schema resolution mirrors getReportData: inspection templateSnapshot
     * takes precedence over the live template.schema.
     */
    async computePublishReadiness(inspectionId: string, tenantId: string): Promise<PublishReadiness> {
        return this.publish.computePublishReadiness(inspectionId, tenantId);
    }

    /**
     * Compute a stable content hash over the render inputs for an inspection
     * report. Used to skip Browser Rendering when identical-content PDFs are
     * already cached.
     *
     * Photo URLs use the raw R2 key (no volatile render/auth token) so the hash
     * is stable across token refreshes. Template CSS / layout changes are
     * covered by bumping RENDER_VERSION in server/lib/pdf.ts.
     *
     * Note: branding (logo image, primaryColor) is NOT included here because
     * it is not returned by getReportData — branding changes are instead
     * covered by bumping RENDER_VERSION.
     */
    async getReportContentHash(id: string, tenantId: string): Promise<string> {
        return this.report.getReportContentHash(id, tenantId);
    }

    async getReportPdfFooterContext(
        id: string,
        tenantId: string,
    ): Promise<{ settings: PdfSettings; address: string; license: string | null }> {
        return this.report.getReportPdfFooterContext(id, tenantId);
    }
}
