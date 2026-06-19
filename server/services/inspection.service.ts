import { drizzle } from 'drizzle-orm/d1';
import { eq, and, or, lt, gte, lte, sql, inArray, desc } from 'drizzle-orm';
import { inspections, inspectionResults, templates, users, services, inspectionServices, tenantConfigs, invoices, tenants, agreementRequests, agreements, reportVersions } from '../lib/db/schema';
import { contacts } from '../lib/db/schema/contact';
import { Errors } from '../lib/errors';
import { computeReportStats, getRatingColor, getRatingBucket, mapCustomDefectsForReport, type RatingLevel } from '../lib/report-utils';
import { mapRatingSystemLevels } from '../lib/map-rating-levels';
import { type CoverCrop, type PhotoCrop } from '../lib/validations/inspection.schema';

import { ScopedDB } from '../lib/db/scoped';
import { escapeLikePattern } from '../lib/db/like-escape';
import { safeISODate, safeTimestamp } from '../lib/date';
import { logger } from '../lib/logger';
import { computePreflightFromData } from '../lib/preflight';
import { syncInspectionAssignments } from '../lib/db/assignment-links';
import type { AgreementService } from './agreement.service';
import { findingKey, DEFAULT_UNIT } from '../lib/finding-key';
import { mapRepairItems } from '../lib/report-repair-items';
import { parseReinspectionStatuses, isOpenStatus } from '../lib/reinspection-status';
import { renderTemplate } from '../lib/mustache';
import { selectReportMedia, type ReportMediaContext } from '../lib/report-video';
import { InvoiceService } from './invoice.service';
import type { DefectCommentState } from '../types/inspection-item-state';
import type { TemplateSchemaV2 } from '../types/template-schema';
import { sha256Hex } from './signing-key.service';
import { RENDER_VERSION } from '../lib/pdf';
import { type ImagesBinding } from '../lib/media/strip-exif';
import { resolvePdfSettings, type PdfSettings } from '../lib/pdf-settings';
import { INSPECTION_STATUS } from '../lib/status/inspection-status';
import { REPORT_STATUS, isReportPublished } from '../lib/status/report-status';

// Module-level types, constants, and pure helpers now live in
// ./inspection/shared.ts (single source of truth shared by the facade + every
// sub-service). Re-exported here so the public API surface of this module is
// unchanged (callers + tests still import these from 'inspection.service').
import {
    resolveCoverUrl,
    RECOMMENDATION_CATEGORY_LABELS,
    sanitizeDefectStates,
    fireAutomation,
    resolveDefectMustacheVars,
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

    constructor(private db: D1Database, r2?: R2Bucket, private sdb?: ScopedDB, kv?: KVNamespace, images?: ImagesBinding) {
        this.sharing = new InspectionSharingService(db, r2, sdb, kv, images);
        this.analytics = new InspectionAnalyticsService(db, r2, sdb, kv, images, this);
        this.status = new InspectionStatusService(db, r2, sdb, kv, images);
        this.annotations = new InspectionAnnotationsService(db, r2, sdb, kv, images, this);
        this.photo = new InspectionPhotoService(db, r2, sdb, kv, images, this);
        this.results = new InspectionResultsService(db, r2, sdb, kv, images);
    }

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Lists inspections with pagination and filtering.
     */
    async listInspections(tenantId: string, params: InspectionListParams) {
        const db = this.getDrizzle();
        const conditions = [eq(inspections.tenantId, tenantId)];

        if (params.status) conditions.push(eq(inspections.status, params.status));
        if (params.inspectorId) conditions.push(eq(inspections.inspectorId, params.inspectorId));
        if (params.dateFrom) conditions.push(gte(inspections.date, params.dateFrom));
        if (params.dateTo) conditions.push(lte(inspections.date, params.dateTo));
        
        if (params.search) {
            const term = `%${escapeLikePattern(params.search)}%`;
            conditions.push(or(
                sql`lower(${inspections.propertyAddress}) like lower(${term})`,
                sql`lower(${inspections.clientName}) like lower(${term})`
            )!);
        }

        const tabParam = (params as { tab?: string }).tab;
        if (tabParam && tabParam !== 'all') {
            const todayStr = new Date().toISOString().slice(0, 10);
            const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            switch (tabParam) {
                case 'today':
                    conditions.push(sql`date(${inspections.date}) = ${todayStr}`);
                    break;
                case 'upcoming':
                    conditions.push(sql`${inspections.date} > ${todayStr}`);
                    conditions.push(sql`${inspections.status} not in ('completed','cancelled')`);
                    break;
                case 'past':
                    conditions.push(or(
                        sql`${inspections.date} < ${todayStr}`,
                        inArray(inspections.status, ['completed', 'cancelled'])
                    )!);
                    break;
                case 'unconfirmed':
                    conditions.push(eq(inspections.status, 'scheduled'));
                    conditions.push(sql`${inspections.createdAt} < ${cutoff}`);
                    break;
                case 'in_progress':
                    conditions.push(eq(inspections.reportStatus, REPORT_STATUS.IN_PROGRESS));
                    break;
            }
        }

        if (params.cursor) {
            try {
                const c = JSON.parse(atob(params.cursor));
                conditions.push(or(
                    lt(inspections.createdAt, new Date(c.createdAt)),
                    and(eq(inspections.createdAt, new Date(c.createdAt)), lt(inspections.id, c.id))
                )!);
            } catch { throw Errors.BadRequest('Invalid cursor'); }
        }

        const rows = await db.select().from(inspections)
            .where(and(...conditions))
            .orderBy(sql`${inspections.createdAt} desc, ${inspections.id} desc`)
            .limit(params.limit + 1);

        const hasMore = rows.length > params.limit;
        const page = hasMore ? rows.slice(0, params.limit) : rows;
        
        let nextCursor: string | null = null;
        if (hasMore) {
            const last = page[page.length - 1];
            nextCursor = btoa(JSON.stringify({ createdAt: safeTimestamp(last.createdAt), id: last.id }));
        }

        const inspectionsFormatted: Inspection[] = page.map(row => ({
            ...row,
            id: row.id as string,
            propertyAddress: row.propertyAddress as string,
            clientName: row.clientName as string | null,
            clientEmail: row.clientEmail as string | null,
            status: row.status,
            date: row.date as string,
            inspectorId: row.inspectorId as string | null,
            templateId: row.templateId as string | null,
            createdAt: safeISODate(row.createdAt),
        }));

        return { inspections: inspectionsFormatted, nextCursor, hasMore };
    }

    /**
     * Fetches counts for the dashboard.
     */
    async getStats(tenantId: string) {
        const db = this.getDrizzle();
        const counts = await db.select({ status: inspections.status, count: sql<number>`count(*)` })
            .from(inspections)
            .where(eq(inspections.tenantId, tenantId))
            .groupBy(inspections.status);

        const stats = { total: 0, requested: 0, completed: 0, published: 0 };
        for (const row of counts) {
            const n = Number(row.count);
            stats.total += n;
            if (row.status === INSPECTION_STATUS.REQUESTED) stats.requested = n;
            else if (row.status === INSPECTION_STATUS.COMPLETED) stats.completed = n;
        }
        return stats;
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
        if (!this.sdb) throw new Error('ScopedDB session missing');

        const ins = await this.sdb.getById(inspections, inspectionId);
        if (!ins) throw Errors.NotFound('Inspection not found');

        const resultsRow = await this.sdb.raw.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();
        const items: Record<string, { rating?: unknown; value?: unknown }> = (() => {
            const raw = resultsRow?.data;
            if (!raw) return {};
            try {
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                return (parsed && typeof parsed === 'object') ? parsed as Record<string, never> : {};
            } catch { return {}; }
        })();

        return computePreflightFromData(
            {
                coverPhotoId:      (ins.coverPhotoId as string | null) ?? null,
                propertyFacts:     (ins.propertyFacts as Record<string, unknown> | null) ?? null,
                agreementSignedAt: (ins.agreementSignedAt as number | null) ?? null,
            },
            items,
        );
    }

    async getInspection(id: string, tenantId: string) {
        if (!this.sdb) throw new Error('ScopedDB session missing');

        const result = await this.sdb.getById(inspections, id);
        if (!result) throw Errors.NotFound('Inspection not found');

        const template = result.templateId
            ? await this.sdb.getById(templates, result.templateId as string)
            : null;
        // Track I-a — signed truth rides the envelope: a signed agreement_requests
        // row (any channel — emailed OR on-site) sets signedByClient.
        const signed = await this.sdb.raw.select({ id: agreementRequests.id }).from(agreementRequests)
            .where(and(
                eq(agreementRequests.inspectionId, id),
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.status, 'signed'),
            ))
            .get();

        return {
            inspection: {
                ...result,
                id: result.id as string,
                propertyAddress: result.propertyAddress as string,
                clientName: result.clientName as string | null,
                clientEmail: result.clientEmail as string | null,
                status: result.status as 'draft' | 'completed' | 'delivered',
                date: result.date as string,
                inspectorId: result.inspectorId as string | null,
                templateId: result.templateId as string | null,
                createdAt: safeISODate(result.createdAt),
                signedByClient: !!signed
            },
            template: template || null
        };
    }

    /**
     * Creates a new inspection.
     */
    async createInspection(tenantId: string, data: CreateInspectionData & { inspectorId?: string; clientContactId?: string }): Promise<Inspection> {
        if (!this.sdb) throw new Error('ScopedDB session missing');
        const id = crypto.randomUUID();
        const createdAt = new Date();
        const status = INSPECTION_STATUS.REQUESTED;
        const date = data.date || createdAt.toISOString();

        let templateSnapshot: unknown = null;
        let templateSnapshotVersion = 1;
        if (data.templateId) {
            const tpl = await drizzle(this.db).select().from(templates)
                .where(and(eq(templates.id, data.templateId), eq(templates.tenantId, tenantId))).get();
            if (tpl) {
                templateSnapshot = tpl.schema;
                templateSnapshotVersion = tpl.version;
                // Sprint 2 S2-1 — the template's rating system is captured at
                // first results-write time (see updateResults below) rather
                // than at inspection creation. Until the inspector touches an
                // item the inspection_results row doesn't exist yet, so there
                // is nowhere to attach the snapshot here.
            }
        }

        // Round-2 #10 — read tenant block-report policy. New inspections
        // inherit `paymentRequired` / `agreementRequired` defaults from
        // `tenant_configs`. Per-inspection override (if the caller sets
        // either flag explicitly) still wins.
        const tenantPolicy = await drizzle(this.db)
            .select({
                blockUnpaid:            tenantConfigs.blockUnpaid,
                blockUnsignedAgreement: tenantConfigs.blockUnsignedAgreement,
            })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        const defaultPaymentRequired   = tenantPolicy?.blockUnpaid ?? false;
        const defaultAgreementRequired = tenantPolicy?.blockUnsignedAgreement ?? false;

        const newInspection = {
            id,
            tenantId,
            inspectorId: data.inspectorId || null,
            propertyAddress: data.propertyAddress,
            clientName: data.clientName || 'Private Client',
            clientEmail: (data.clientEmail as string | null) || null,
            clientPhone: data.clientPhone ?? null,
            // IA-1: FK to contacts.id for the client (app-layer integrity).
            clientContactId: (data as { clientContactId?: string }).clientContactId ?? null,
            templateId: data.templateId,
            templateSnapshot,
            templateSnapshotVersion,
            status,
            date,
            referredByAgentId: (data.referredByAgentId as string | null) || null,
            sellingAgentId: (data.sellingAgentId as string | null) || null,
            // Spec 5D — geocoded fields, all optional (legacy free-text addresses ok)
            addressPlaceId:    (data.addressPlaceId as string | null) || null,
            addressStreet:     (data.addressStreet as string | null) || null,
            addressCity:       (data.addressCity as string | null) || null,
            addressState:      (data.addressState as string | null) || null,
            addressZip:        (data.addressZip as string | null) || null,
            addressCounty:     (data.addressCounty as string | null) || null,
            addressLat:        (data.addressLat as number | null) ?? null,
            addressLng:        (data.addressLng as number | null) ?? null,
            addressGeocodedAt: data.addressPlaceId ? Date.now() : null,
            // Round-2 #10 — block-report gating defaults inherited from tenant
            // policy. The Sprint 1 D-7 ReportGatePage check at /report/:id
            // reads these per-inspection columns directly.
            paymentRequired:   data.paymentRequired   ?? defaultPaymentRequired,
            agreementRequired: data.agreementRequired ?? defaultAgreementRequired,
            createdAt
        };

        await this.sdb.insert(inspections, newInspection);
        // DB-8: mirror assignment into inspection_inspectors link table.
        // Non-fatal — a sync failure must not roll back a committed inspection row.
        try {
            await syncInspectionAssignments(this.getDrizzle(), tenantId, id, { inspectorId: newInspection.inspectorId });
        } catch (e) {
            logger.error('inspection.assignment-sync.failed', { inspectionId: id }, e instanceof Error ? e : undefined);
        }
        await fireAutomation(this.db, tenantId, id, 'inspection.created');

        // Soft-upsert the client into Contacts so it shows up in the Contacts list
        // for future re-use (search, agent linking). Idempotent on tenantId+email
        // (or tenantId+name if no email). Failures are non-fatal — inspection
        // creation must not break because of a contact-side issue.
        if (newInspection.clientName && newInspection.clientName !== 'Private Client') {
            try {
                const dbForContacts = this.getDrizzle();
                const matchConds = [eq(contacts.tenantId, tenantId), eq(contacts.type, 'client')];
                if (newInspection.clientEmail) matchConds.push(eq(contacts.email, newInspection.clientEmail));
                else matchConds.push(eq(contacts.name, newInspection.clientName));
                const existing = await dbForContacts.select().from(contacts).where(and(...matchConds)).get();
                if (!existing) {
                    await dbForContacts.insert(contacts).values({
                        id: crypto.randomUUID(),
                        tenantId,
                        type: 'client',
                        name: newInspection.clientName,
                        email: newInspection.clientEmail,
                        phone: newInspection.clientPhone,
                        agency: null,
                        notes: null,
                        createdAt: createdAt,
                    });
                }
            } catch (err) {
                logger.error('contact upsert from inspection failed', { inspectionId: id }, err instanceof Error ? err : undefined);
            }
        }

        // Link selected services.
        // serviceSelections (IA-1 superset) takes precedence when present; otherwise
        // fall back to the legacy flat serviceIds list. The two may coexist — the
        // handler already merges them so only one branch fires here.
        const serviceSelectionsInput = (data as { serviceSelections?: Array<{ serviceId: string; priceOverrideCents?: number }> }).serviceSelections;
        const effectiveServiceIds: string[] = serviceSelectionsInput && serviceSelectionsInput.length > 0
            ? serviceSelectionsInput.map(s => s.serviceId)
            : (data.serviceIds ?? []);
        if (effectiveServiceIds.length > 0) {
            const db2 = this.getDrizzle();
            const svcRows = await db2.select().from(services)
                .where(and(eq(services.tenantId, tenantId), inArray(services.id, effectiveServiceIds)));
            if (svcRows.length > 0) {
                // Build a map from serviceId → priceOverrideCents for fast lookup.
                const overrideMap = new Map<string, number | undefined>(
                    (serviceSelectionsInput ?? []).map(s => [s.serviceId, s.priceOverrideCents]),
                );
                await db2.insert(inspectionServices).values(svcRows.map(s => ({
                    id:            crypto.randomUUID(),
                    tenantId,
                    inspectionId:  id,
                    serviceId:     s.id,
                    priceOverride: overrideMap.get(s.id) ?? null,
                    nameSnapshot:  s.name,
                    priceSnapshot: s.price,
                })));
            }
        }

        return {
            ...newInspection,
            clientEmail: newInspection.clientEmail as string | null,
            inspectorId: newInspection.inspectorId as string | null,
            createdAt: safeISODate(newInspection.createdAt)
        } as Inspection;
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
        const db = this.getDrizzle();

        const baseline = await db.select().from(inspections)
            .where(and(eq(inspections.id, baselineId), eq(inspections.tenantId, tenantId))).get();
        if (!baseline) throw new Error('Baseline inspection not found');

        const latestVersion = await db.select().from(reportVersions)
            .where(and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.inspectionId, baselineId)))
            .orderBy(desc(reportVersions.versionNumber)).limit(1).get();
        if (!latestVersion) throw new Error('Cannot re-inspect an unpublished baseline');

        // When an explicit inspectorId is supplied, it MUST resolve to a user in
        // this tenant. inspector_id has a DB FK to users.id; a foreign-tenant or
        // bogus id would either violate the FK at runtime or assign the round to
        // another tenant's user. Validate before use; omitted → baseline fallback.
        if (opts.inspectorId) {
            const owner = await db.select({ id: users.id }).from(users)
                .where(and(eq(users.id, opts.inspectorId), eq(users.tenantId, tenantId))).get();
            if (!owner) throw new Error('Inspector not found in this workspace');
        }

        const rootId = baseline.rootInspectionId ?? baseline.id;
        const existingRounds = await db.select().from(inspections)
            .where(and(eq(inspections.tenantId, tenantId), eq(inspections.rootInspectionId, rootId))).all();
        const round = existingRounds.length + 1;

        // The latest published snapshot is the carry-forward source. snapshotOnPublish
        // serialises { inspection, data, units }; we read .data[itemId].
        const baseSnapshot = JSON.parse(latestVersion.snapshotJson) as {
            data?: Record<string, Record<string, unknown>>;
        };
        const baselineIsReinspection = baseline.sourceInspectionId != null;

        const seeded: Record<string, unknown> = {};
        for (const itemId of opts.selectedItemIds) {
            const item = baseSnapshot.data?.[itemId] ?? {};
            // When the baseline is itself a re-inspection AND its snapshot item already
            // carries a propagated `.original` root finding, forward THAT (so round N
            // always shows the root defect, never the intermediate follow-up state).
            const original = baselineIsReinspection && item.original
                ? item.original
                : { rating: item.rating ?? null, notes: item.notes ?? null, photos: item.photos ?? [] };
            seeded[itemId] = { original, followupStatus: null };
        }

        const id = crypto.randomUUID();
        const createdAt = new Date();
        await db.insert(inspections).values({
            id,
            tenantId,
            // Reuse the baseline's property + client + template fields.
            inspectorId:             opts.inspectorId ?? baseline.inspectorId ?? null,
            propertyAddress:         baseline.propertyAddress,
            addressPlaceId:          baseline.addressPlaceId,
            addressStreet:           baseline.addressStreet,
            addressCity:             baseline.addressCity,
            addressState:            baseline.addressState,
            addressZip:              baseline.addressZip,
            addressCounty:           baseline.addressCounty,
            addressLat:              baseline.addressLat,
            addressLng:              baseline.addressLng,
            clientContactId:         baseline.clientContactId,
            clientName:              baseline.clientName,
            clientEmail:             baseline.clientEmail,
            clientPhone:             baseline.clientPhone,
            templateId:              baseline.templateId,
            templateSnapshot:        baseline.templateSnapshot,
            templateSnapshotVersion: baseline.templateSnapshotVersion,
            date:                    createdAt.toISOString(),
            status:                  INSPECTION_STATUS.REQUESTED,
            paymentStatus:           'unpaid',
            price:                   0,
            paymentRequired:         false,
            agreementRequired:       false,
            createdAt,
            // #119 link columns.
            sourceInspectionId: baselineId,
            rootInspectionId:   rootId,
            reinspectionRound:  round,
        });

        await db.insert(inspectionResults).values({
            id:           crypto.randomUUID(),
            tenantId,
            inspectionId: id,
            data:         seeded as unknown as object,
            lastSyncedAt: createdAt,
        });

        const created = await db.select().from(inspections).where(eq(inspections.id, id)).get();
        return created as unknown as Inspection;
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
        const db = this.getDrizzle();

        const baseline = await db.select().from(inspections)
            .where(and(eq(inspections.id, baselineId), eq(inspections.tenantId, tenantId))).get();
        if (!baseline) return [];

        const latestVersion = await db.select().from(reportVersions)
            .where(and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.inspectionId, baselineId)))
            .orderBy(desc(reportVersions.versionNumber)).limit(1).get();
        if (!latestVersion) return [];  // unpublished baseline → no candidates

        const baselineIsReinspection = baseline.sourceInspectionId != null;

        // Snapshot data is keyed by findingKey (unit:section:item) or, for legacy
        // inspections, the plain item id — the same keys createReinspection reads.
        const snapshot = JSON.parse(latestVersion.snapshotJson) as {
            data?: Record<string, Record<string, unknown>>;
        };
        const snapData = snapshot.data ?? {};

        // Resolve item labels from the baseline's templateSnapshot (authoritative
        // shape once an inspection exists). Both {sections:[...]} and flat-array
        // formats are supported, matching getReportData's schema resolution.
        const labelByItemId = new Map<string, string>();
        const rawSnap = baseline.templateSnapshot as unknown;
        const tplSnap = rawSnap
            ? (typeof rawSnap === 'string' ? JSON.parse(rawSnap as string) : rawSnap)
            : null;
        const sections: Array<{ id?: string; items?: Array<Record<string, unknown>> }> = Array.isArray(tplSnap)
            ? [{ id: 'general', items: tplSnap as Array<Record<string, unknown>> }]
            : Array.isArray((tplSnap as { sections?: unknown })?.sections)
                ? (tplSnap as { sections: Array<{ id?: string; items?: Array<Record<string, unknown>> }> }).sections
                : [];
        for (const sec of sections) {
            for (const it of sec.items ?? []) {
                const itemId = String(it.id ?? '');
                if (!itemId) continue;
                const label = String(it.label ?? it.title ?? it.name ?? itemId);
                labelByItemId.set(itemId, label);
                // Also map the composite findingKey so snapshot keys resolve.
                labelByItemId.set(findingKey(DEFAULT_UNIT, String(sec.id ?? ''), itemId), label);
            }
        }

        // Rating levels for bucket resolution (original-baseline rule). Read from
        // the templateSnapshot.ratingSystem when present; absence degrades to the
        // legacy string-bucket map inside getRatingBucket.
        const snapLevels = !Array.isArray(tplSnap)
            ? (tplSnap as { ratingSystem?: { levels?: unknown[] } } | null)?.ratingSystem?.levels
            : undefined;
        const levels: RatingLevel[] = Array.isArray(snapLevels)
            ? mapRatingSystemLevels(snapLevels as Array<Record<string, unknown>>)
            : [];

        // Resolve the tenant's configured follow-up status set (re-inspection rule).
        const configRow = await db.select({ reinspectionStatuses: tenantConfigs.reinspectionStatuses })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        const resolvedStatuses = parseReinspectionStatuses(configRow?.reinspectionStatuses ?? null);

        const out: Array<{ itemId: string; label: string; originalNotes: string | null; open: boolean }> = [];
        for (const [itemId, entry] of Object.entries(snapData)) {
            const rating = (entry.rating ?? null) as string | null;
            const notes = (entry.notes ?? null) as string | null;
            // A re-inspection snapshot may already carry the propagated root finding.
            const original = (entry.original ?? null) as { notes?: string | null } | null;
            const originalNotes = baselineIsReinspection && original ? (original.notes ?? null) : notes;

            let open: boolean;
            if (baselineIsReinspection) {
                open = isOpenStatus((entry.followupStatus ?? null) as string | null, resolvedStatuses);
            } else {
                const bucket = getRatingBucket(rating, levels);
                open = bucket === 'defect' || bucket === 'monitor';
            }

            out.push({
                itemId,
                label: labelByItemId.get(itemId) ?? itemId,
                originalNotes,
                open,
            });
        }
        // Open items first, then by label — the pre-checked carry-forward set surfaces on top.
        out.sort((a, b) => (a.open === b.open ? a.label.localeCompare(b.label) : a.open ? -1 : 1));
        return out;
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
        const db = this.getDrizzle();
        for (const sel of selections) {
            if (sel.priceOverrideCents !== undefined) {
                await db.update(inspectionServices)
                    .set({ priceOverride: sel.priceOverrideCents })
                    .where(
                        and(
                            eq(inspectionServices.inspectionId, inspectionId),
                            eq(inspectionServices.tenantId, tenantId),
                            eq(inspectionServices.serviceId, sel.serviceId),
                        ),
                    );
            }
        }
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
        // Build the base CreateInspectionData shape consumed by createInspection.
        // The wizard's schedule.startTime is appended to the ISO date so the
        // existing `date` column carries both — the editor's calendar pane
        // already round-trips this format.
        const dateTime = `${input.schedule.date}T${input.schedule.startTime}:00`;

        const created = await this.createInspection(tenantId, {
            inspectorId:     creatorUserId,
            propertyAddress: input.property.address,
            clientName:      'Private Client',  // wizard MVP — client picker is step-extension follow-up
            clientEmail:     null,
            clientPhone:     null,
            templateId:      null,
            date:            dateTime,
            yearBuilt:       input.property.yearBuilt ?? null,
            sqft:            input.property.sqft ?? null,
            foundationType:  null,
            bedrooms:        null,
            bathrooms:       null,
        } as unknown as CreateInspectionData & { inspectorId?: string });

        {
            const db = this.getDrizzle();
            const patch: Record<string, unknown> = {};
            if (input.property.propertyType) patch.propertyType = input.property.propertyType;
            if (input.property.propertyType === 'commercial' && input.property.commercialSubtype) {
                patch.commercialSubtype = input.property.commercialSubtype;
            }
            let teamFieldsPatched = false;
            let effectiveLead: string | null = null;
            let effectiveHelpers: string[] = [];
            if (input.teamMode || input.leadInspectorId || (input.helperInspectorIds?.length ?? 0) > 0) {
                patch.teamMode           = input.teamMode;
                patch.leadInspectorId    = input.teamMode ? (input.leadInspectorId ?? creatorUserId) : null;
                patch.helperInspectorIds = JSON.stringify(input.teamMode ? (input.helperInspectorIds ?? []) : []);
                teamFieldsPatched = true;
                effectiveLead    = patch.leadInspectorId as string | null;
                effectiveHelpers = input.teamMode ? (input.helperInspectorIds ?? []) : [];
            }
            if (Object.keys(patch).length > 0) {
                await db.update(inspections)
                    .set(patch)
                    .where(and(eq(inspections.id, created.id), eq(inspections.tenantId, tenantId)));
            }
            // DB-8: re-sync with effective post-patch assignment values when team
            // fields were written. Always pass creatorUserId as the inspectorId
            // fallback so that when teamMode=false but a stale leadInspectorId was
            // present in the request (effectiveLead=null, effectiveHelpers=[]),
            // syncInspectionAssignments still writes a lead row for the creator
            // rather than clearing all link rows while inspections.inspectorId
            // still holds creatorUserId (which would diverge the two sources of truth).
            if (teamFieldsPatched) {
                // Non-fatal — the link table is a denormalized mirror; a sync
                // failure must not surface to the caller after the canonical row
                // has already been written.
                try {
                    await syncInspectionAssignments(db, tenantId, created.id, {
                        inspectorId:        creatorUserId,
                        leadInspectorId:    effectiveLead,
                        helperInspectorIds: effectiveHelpers,
                    });
                } catch (e) {
                    logger.error('inspection.wizard-team-sync.failed', { inspectionId: created.id }, e instanceof Error ? e : undefined);
                }
            }
        }

        return { id: created.id };
    }

    /**
     * Clones an existing inspection.
     */
    async cloneInspection(id: string, tenantId: string): Promise<Inspection> {
        const { inspection: source } = await this.getInspection(id, tenantId);

        const clone = {
            ...source,
            id: crypto.randomUUID(),
            tenantId,
            date: new Date().toISOString(),
            status: 'draft' as const,
            paymentStatus: 'unpaid' as const,
            createdAt: new Date(),
        };
        delete (clone as { signedByClient?: boolean }).signedByClient; // Remove ephemeral field

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.getDrizzle().insert(inspections).values(clone as any);
        // DB-8: mirror the cloned inspection's assignment into inspection_inspectors.
        // Non-fatal — the link table is a denormalized mirror; a sync failure must
        // not abort a clone whose canonical inspection row already committed.
        try {
            await syncInspectionAssignments(this.getDrizzle(), tenantId, clone.id, {
                inspectorId:        (clone as { inspectorId?: string | null }).inspectorId ?? null,
                leadInspectorId:    (clone as { leadInspectorId?: string | null }).leadInspectorId ?? null,
                helperInspectorIds: JSON.parse((clone as { helperInspectorIds?: string }).helperInspectorIds ?? '[]') as string[],
            });
        } catch (e) {
            logger.error('inspection.clone-sync.failed', { inspectionId: clone.id }, e instanceof Error ? e : undefined);
        }

        return {
            ...clone,
            createdAt: safeISODate(clone.createdAt)
        };
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

    async patchItem(
        inspectionId: string,
        tenantId: string,
        itemId: string,
        field: 'rating' | 'notes' | 'value' | 'cannedToggle' | 'defectFields' | 'itemAttribute',
        value: unknown,
        expectedVersion: number,
        userId: string,
        opts?: { force?: boolean },
        sectionId?: string,
    ): Promise<
        | { kind: 'ok'; newVersion: number; by: string; at: number }
        | { kind: 'conflict'; current: { value: unknown; by?: string; at?: number; v: number }; yours: { value: unknown; expectedVersion: number } }
        | { kind: 'not_found' }
    > {
        return this.photo.patchItem(inspectionId, tenantId, itemId, field, value, expectedVersion, userId, opts, sectionId);
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
    ): Promise<{ annotatedKey: string }> {
        return this.annotations.saveAnnotation(inspectionId, tenantId, itemId, photoIndex, compositeBytes, nodesJson, sectionId);
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
    ): Promise<{ croppedKey: string }> {
        return this.annotations.saveCroppedItemPhoto(inspectionId, tenantId, itemId, photoIndex, bakedBytes, crop, sectionId);
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
        // Plan 7 — video walk-through. When present, each media entry is enriched
        // with its resolved kind (image / video-player / video-poster) so the web
        // report + PDF render chain can branch. Absent (legacy callers) ⇒ photos
        // resolve exactly as before (image only).
        videoCtx?: ReportMediaContext,
    ) {
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const template = inspection.templateId
            ? await db.select().from(templates).where(and(eq(templates.id, inspection.templateId), eq(templates.tenantId, tenantId))).get()
            : null;
        const resultsRow = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();

        // Spec 5B — v2 schema is the authoritative shape. Items are 'rich'
        // (rating + 3 tabs of canned comments) or 'text' (free-text notes).
        interface CannedInfoComment { id: string; title: string; comment: string; default: boolean }
        interface CannedDefect      { id: string; title: string; category: 'maintenance' | 'recommendation' | 'safety'; location: string; comment: string; photos: string[]; default: boolean }
        interface ItemTabs          { information: CannedInfoComment[]; limitations: CannedInfoComment[]; defects: CannedDefect[] }
        interface SchemaItem        { id: string; label: string; icon?: string; type?: string; ratingOptions?: string[]; tabs?: ItemTabs; number?: string }
        // Track E2 (Spectora App.A) — per-section disclaimer + force-page-break
        // are stored on the schema's section node so the editor can author
        // them and the published report can honor them. Both are optional —
        // legacy templates without these fields render unchanged.
        interface SchemaSection     { id: string; title: string; icon?: string; items: SchemaItem[]; disclaimerText?: string | null; alwaysPageBreak?: boolean }
        interface SchemaData        { schemaVersion?: number; sections: SchemaSection[]; ratingSystem?: { levels: RatingLevel[] } }
        interface PhotoEntry        { key: string; croppedKey?: string; annotatedKey?: string; annotationsJson?: string; mediaType?: 'photo' | 'video'; streamUid?: string; posterPct?: number; durationSec?: number }
        // Sprint 2 S2-3 / S2-4 — per-defect recommendation slug + repair
        // estimate range (cents). All optional so legacy defects render.
        interface DefectState       { cannedId: string; included: boolean; comment?: string | null; category?: 'maintenance' | 'recommendation' | 'safety'; location?: string | null; photos?: PhotoEntry[]; recommendationId?: string | null; estimateLow?: number | null; estimateHigh?: number | null; trade?: string | null; deadline?: string | null; timeframe?: string | null }
        interface CannedState       { cannedId: string; included: boolean; comment?: string | null }
        interface ResultEntry {
            rating?:         string;
            notes?:          string;
            photos?:         PhotoEntry[];
            recommendation?: string;
            estimateMin?:    number;
            estimateMax?:    number;
            attributes?:     Record<string, unknown>;
            tabs?: {
                information?: CannedState[];
                limitations?: CannedState[];
                defects?:     DefectState[];
            };
            // #119 — on a re-inspection result, the carried item retains a
            // snapshot of the original finding plus the follow-up disposition.
            original?:       { rating?: string | null; notes?: string | null; photos?: PhotoEntry[] };
            followupStatus?: string | null;
            followupNotes?:  string | null;
        }

        // Feature #20 — prefer the per-inspection templateSnapshot over the
        // source template.schema. The snapshot is the authoritative shape
        // for the inspection once it's been created: rating-system swaps,
        // inline added/removed sections + items, and per-job tweaks all
        // land there. Falling back to template.schema preserves behavior
        // for legacy inspections that pre-date the snapshot column.
        const inspectionSnapshotRaw = (inspection as unknown as { templateSnapshot?: unknown }).templateSnapshot;
        const inspectionSnapshot = inspectionSnapshotRaw
            ? (typeof inspectionSnapshotRaw === 'string' ? JSON.parse(inspectionSnapshotRaw as string) : inspectionSnapshotRaw)
            : null;
        const hasInspectionSnapshot = inspectionSnapshot
            && typeof inspectionSnapshot === 'object'
            && Array.isArray((inspectionSnapshot as { sections?: unknown }).sections)
            && (inspectionSnapshot as { sections: unknown[] }).sections.length > 0;
        const rawSchema = hasInspectionSnapshot
            ? inspectionSnapshot
            : template?.schema
                ? (typeof template.schema === 'string' ? JSON.parse(template.schema) : template.schema)
                : { sections: [] };
        // Support both formats: { sections: [...] } and flat array of items
        const schemaData: SchemaData = Array.isArray(rawSchema)
            ? { sections: [{ id: 'general', title: 'General', items: rawSchema }] }
            : (rawSchema as SchemaData).sections ? rawSchema as SchemaData : { sections: [] };

        // Sprint 2 S2-1 + Feature #20 — multi-rating system resolution.
        // Order of precedence:
        //   1. inspection_results.rating_system_snapshot (frozen at creation;
        //      cleared when the inspector switches systems mid-inspection)
        //   2. inspection.templateSnapshot.ratingSystem  ← phase 2 swap target
        //   3. template.rating_system_id → live rating_systems row
        //   4. legacy template.schema.ratingSystem.levels
        let levels: RatingLevel[] = [];
        const snapshotRaw = (resultsRow as unknown as { ratingSystemSnapshot?: unknown })?.ratingSystemSnapshot;
        if (snapshotRaw) {
            const snap = typeof snapshotRaw === 'string' ? JSON.parse(snapshotRaw) : snapshotRaw;
            if (snap && Array.isArray((snap as { levels?: unknown }).levels)) {
                levels = mapRatingSystemLevels((snap as { levels: Array<Record<string, unknown>> }).levels);
            }
        }
        if (levels.length === 0 && hasInspectionSnapshot) {
            const snapLevels = (inspectionSnapshot as { ratingSystem?: { levels?: unknown[] } }).ratingSystem?.levels;
            if (Array.isArray(snapLevels)) {
                levels = mapRatingSystemLevels(snapLevels as Array<Record<string, unknown>>);
            }
        }
        if (levels.length === 0 && template && (template as unknown as { ratingSystemId?: string | null }).ratingSystemId) {
            const ratingSystemId = (template as unknown as { ratingSystemId: string | null }).ratingSystemId as string | null;
            if (ratingSystemId) {
                const { ratingSystems } = await import('../lib/db/schema');
                const sysRow = await db.select().from(ratingSystems)
                    .where(and(eq(ratingSystems.id, ratingSystemId), eq(ratingSystems.tenantId, tenantId)))
                    .get();
                if (sysRow) {
                    const rawLevels = sysRow.levels as unknown;
                    const lvlArr = typeof rawLevels === 'string' ? JSON.parse(rawLevels) : rawLevels;
                    if (Array.isArray(lvlArr)) levels = mapRatingSystemLevels(lvlArr);
                }
            }
        }
        if (levels.length === 0) {
            levels = schemaData.ratingSystem?.levels ?? [];
        }
        const resultData: Record<string, ResultEntry> = resultsRow?.data
            ? (typeof resultsRow.data === 'string' ? JSON.parse(resultsRow.data) : resultsRow.data) as Record<string, ResultEntry>
            : {};

        const stats = computeReportStats(schemaData.sections, resultData, levels);

        // Plan 7 — map a stored media entry → its report photo object. Photos keep
        // the existing { key: displayKey, originalKey, url } shape; videos additionally
        // carry the resolved media kind (player vs poster) when `videoCtx` is present.
        // Without `videoCtx` (legacy callers) it degrades to the photo-only shape.
        const mapReportPhoto = (p: PhotoEntry) => {
            const isVideo = p.mediaType === 'video';
            const displayKey = p.annotatedKey || p.croppedKey || p.key;
            const url = isVideo ? '' : makePhotoUrl(displayKey);
            const base = { key: displayKey, originalKey: p.key, url };
            if (!videoCtx) return base;
            const media = selectReportMedia(
                { key: displayKey, url, mediaType: p.mediaType, streamUid: p.streamUid, posterPct: p.posterPct, durationSec: p.durationSec },
                videoCtx,
            );
            return { ...base, media };
        };

        // Spec 5B helper — for a given item, resolve the effective set of
        // included comments per tab. Honors per-inspection toggles + text
        // overrides, falling back to the template's `default: true` flag.
        function resolveTab<T extends CannedInfoComment | CannedDefect>(
            templateEntries: T[] | undefined,
            states: CannedState[] | DefectState[] | undefined,
        ): Array<T & { included: boolean; effectiveComment: string }> {
            if (!templateEntries) return [];
            const stateMap = new Map<string, CannedState | DefectState>();
            for (const s of states ?? []) stateMap.set(s.cannedId, s);
            return templateEntries.map(e => {
                const st = stateMap.get(e.id);
                const included = st ? !!st.included : !!e.default;
                const override = st && typeof st.comment === 'string' && st.comment.length > 0 ? st.comment : null;
                return {
                    ...e,
                    included,
                    effectiveComment: override ?? e.comment,
                };
            });
        }

        const sections = schemaData.sections.map((sec: SchemaSection) => ({
            id: sec.id,
            title: sec.title || (sec as unknown as Record<string, string>).name || 'Untitled',
            icon: sec.icon ?? null,
            defectCount: stats.sectionDefects[sec.id] ?? 0,
            // Track E2 — surface per-section flags so the report viewer can
            // render the disclaimer + apply the page-break attribute. Null
            // when unset so the renderer can short-circuit cleanly.
            disclaimerText:  (typeof sec.disclaimerText === 'string' && sec.disclaimerText.trim().length > 0)
                ? sec.disclaimerText.trim()
                : null,
            alwaysPageBreak: sec.alwaysPageBreak === true,
            items: sec.items.map((item: SchemaItem) => {
                const res = resultData[findingKey(DEFAULT_UNIT, sec.id, item.id)] || resultData[item.id] || {};
                const ratingId = res.rating ?? null;
                const bucket = getRatingBucket(ratingId, levels);
                const level = levels.find((l: RatingLevel) => l.id === ratingId);

                // Phase T (T16): prefer annotated composite when present; expose original via originalKey.
                // Plan 7: mapReportPhoto enriches video entries with their media kind.
                const photos = (res.photos || []).map(mapReportPhoto);

                // Spec 5B — resolve the three canned-comment tabs.
                const information = resolveTab(item.tabs?.information, res.tabs?.information);
                const limitations = resolveTab(item.tabs?.limitations, res.tabs?.limitations);
                // For defects, also let inspector override category, location, and attach photos.
                const defectStates = res.tabs?.defects ?? [];
                const defectStateMap = new Map<string, DefectState>();
                for (const s of defectStates) defectStateMap.set(s.cannedId, s);
                const defects = (item.tabs?.defects ?? []).map(d => {
                    const st = defectStateMap.get(d.id);
                    const included = st ? !!st.included : !!d.default;
                    const override = st && typeof st.comment === 'string' && st.comment.length > 0 ? st.comment : null;
                    return {
                        ...d,
                        included,
                        effectiveComment: renderTemplate(override ?? d.comment, resolveDefectMustacheVars(st as DefectCommentState | undefined, d as CannedDefect, res.attributes)),
                        effectiveCategory: st?.category ?? d.category,
                        effectiveLocation: (typeof st?.location === 'string' && st.location.length > 0) ? st.location : d.location,
                        defectPhotos: (st?.photos ?? []).map(mapReportPhoto),
                        // Sprint 2 S2-3 / S2-4 — per-defect contractor recommendation +
                        // repair estimate range. Null when the inspector left them blank.
                        recommendationId: st?.recommendationId ?? null,
                        estimateLow:      typeof st?.estimateLow  === 'number' ? st.estimateLow  : null,
                        estimateHigh:     typeof st?.estimateHigh === 'number' ? st.estimateHigh : null,
                    };
                });

                // FE-3/B-20 — field-authored custom defects join the resolved
                // list (they previously reached only the repair list + stats;
                // the published report silently dropped them).
                const customDefects = mapCustomDefectsForReport(
                    (res as { customComments?: { defects?: Array<{ id: string }> } }).customComments,
                    makePhotoUrl,
                );

                // Sprint 2 S2-3 / S2-4 — when the inspector left the legacy
                // top-level recommendation / estimate empty but tagged the
                // included canned defects with per-defect values, surface
                // those at the item level so the report card stack can
                // render the badge without extending its data contract.
                //   - estimateMin = min(defects[].estimateLow)
                //   - estimateMax = max(defects[].estimateHigh)
                //   - recommendation = the most-recent included defect's
                //     human-readable label (joined with " · " when several)
                let itemEstimateMin: number | null = res.estimateMin ?? null;
                let itemEstimateMax: number | null = res.estimateMax ?? null;
                let itemRecommendation: string | null = res.recommendation ?? null;
                const includedDefects = defects.filter(d => d.included);
                if (itemEstimateMin == null) {
                    const lows = includedDefects
                        .map(d => d.estimateLow)
                        .filter((n): n is number => typeof n === 'number');
                    if (lows.length > 0) itemEstimateMin = Math.round(Math.min(...lows) / 100);
                }
                if (itemEstimateMax == null) {
                    const highs = includedDefects
                        .map(d => d.estimateHigh)
                        .filter((n): n is number => typeof n === 'number');
                    if (highs.length > 0) itemEstimateMax = Math.round(Math.max(...highs) / 100);
                }
                if (itemRecommendation == null) {
                    const slugs = Array.from(new Set(
                        includedDefects
                            .map(d => d.recommendationId)
                            .filter((s): s is string => typeof s === 'string' && s.length > 0)
                    ));
                    if (slugs.length > 0) {
                        // Resolve labels from the catalog, joined with bullet.
                        // Lazy require so the import isn't pulled into every
                        // service consumer that doesn't render a report.
                        const cats = (RECOMMENDATION_CATEGORY_LABELS as Map<string, string>);
                        itemRecommendation = slugs
                            .map(s => cats.get(s) ?? s)
                            .join(' · ');
                    }
                }

                return {
                    id: item.id,
                    label: item.label || (item as unknown as Record<string, string>).name || 'Untitled',
                    type:  item.type ?? 'rich',
                    ratingOptions: item.ratingOptions ?? null,
                    // Spec 5B — pass the raw template canned tabs through so
                    // the editor can render checkbox toggles. Per-state
                    // resolution happens client-side; the resolved view is
                    // also exposed under `resolvedTabs` for report renderers.
                    tabs: item.tabs ?? null,
                    rating: ratingId,
                    ratingColor: getRatingColor(ratingId, levels),
                    ratingLabel: level?.label ?? ratingId,
                    severityBucket: bucket,
                    notes: res.notes ?? null,
                    photos,
                    recommendation: itemRecommendation,
                    estimateMin: itemEstimateMin,
                    estimateMax: itemEstimateMax,
                    repairItems: mapRepairItems(res),
                    // Non-rich item types persist the captured value on
                    // res.value; surface it to the report viewer plus the
                    // unit from item.options so the customer sees "Year
                    // built · 1995 · yr" instead of an empty rating chip.
                    value: (res as { value?: unknown }).value ?? null,
                    unit:  (item as unknown as { options?: { unit?: string } }).options?.unit ?? null,
                    // Spec 5B v2 resolved tab payload — report PDFs render
                    // only entries where `included === true`.
                    resolvedTabs: {
                        information,
                        limitations,
                        // Canned first, then custom — single list for renderers
                        // (custom rows carry isCustom: true).
                        defects: [...defects, ...customDefects],
                    },
                    // #119 — re-inspection passthrough. Null on normal reports;
                    // the report page only consults these when data.reinspection
                    // is set. `original.photos` are resolved to display URLs so
                    // the left column can render the baseline finding grayscale.
                    original: res.original
                        ? {
                            rating: res.original.rating ?? null,
                            notes:  res.original.notes ?? null,
                            photos: (res.original.photos || []).map(mapReportPhoto),
                        }
                        : null,
                    followupStatus: res.followupStatus ?? null,
                    followupNotes:  res.followupNotes ?? null,
                };
            }),
        }));

        let inspectorName: string | null = null;
        let inspectorLicense: string | null = null;
        if (inspection.inspectorId) {
            const inspector = await db.select({ name: users.name, email: users.email, licenseNumber: users.licenseNumber })
                .from(users).where(eq(users.id, inspection.inspectorId)).get();
            inspectorName = inspector?.name || (inspector?.email?.split('@')[0] ?? null);
            inspectorLicense = inspector?.licenseNumber ?? null;
        }

        // Sprint 2 S2-4 — per-tenant flag controls whether the published
        // report renders "Estimated cost: $X – $Y" badges on defect cards.
        let showEstimates = false;
        let reportTheme: 'modern' | 'classic' | 'minimal' = 'modern';
        // Per-tenant report-feature flags surfaced to the published report so the
        // client report can render the "View Repair List" and "Build repair request"
        // entries. Read live here (not part of the cached report content).
        let enableRepairList = false;
        let enableCustomerRepairExport = false;
        try {
            const cfg = await db.select({
                showEstimates: tenantConfigs.showEstimates,
                reportTheme:   tenantConfigs.reportTheme,
                enableRepairList: tenantConfigs.enableRepairList,
                enableCustomerRepairExport: tenantConfigs.enableCustomerRepairExport,
            })
                .from(tenantConfigs)
                .where(eq(tenantConfigs.tenantId, tenantId))
                .get();
            if (cfg) {
                showEstimates = Boolean(cfg.showEstimates);
                enableRepairList = Boolean(cfg.enableRepairList);
                enableCustomerRepairExport = Boolean(cfg.enableCustomerRepairExport);
                if (cfg.reportTheme === 'classic' || cfg.reportTheme === 'minimal') {
                    reportTheme = cfg.reportTheme;
                }
            }
        } catch {
            // tenant_configs row missing — defaults apply.
        }
        // Per-inspection override wins over tenant default.
        const inspectionThemeOverride = (inspection as { reportThemeOverride?: string | null }).reportThemeOverride;
        if (inspectionThemeOverride === 'classic' || inspectionThemeOverride === 'minimal') {
            reportTheme = inspectionThemeOverride;
        } else if (inspectionThemeOverride === 'modern') {
            reportTheme = 'modern';
        }

        // Round-2 backlog G1 (Spectora §E.2) — Property Facts banner rendered
        // at the top of the published report. Surface the six dedicated
        // columns; the report layer decides whether to render the strip
        // when at least one field is populated.
        const propertyFacts = {
            yearBuilt:      (inspection as { yearBuilt?: number | null }).yearBuilt           ?? null,
            sqft:           (inspection as { sqft?: number | null }).sqft                     ?? null,
            foundationType: (inspection as { foundationType?: string | null }).foundationType ?? null,
            lotSize:        (inspection as { lotSize?: string | null }).lotSize               ?? null,
            bedrooms:       (inspection as { bedrooms?: number | null }).bedrooms             ?? null,
            bathrooms:      (inspection as { bathrooms?: number | null }).bathrooms           ?? null,
        };

        // #120 — amendment trail. Surfaced to the client report page so a
        // re-published report shows "Amended on …" + per-version reasons.
        // Only meaningful when there is more than one published version; live
        // edits do not create versions, so the banner stays hidden until an
        // actual re-publish. Reason reuses report_versions.summary.
        const versionRows = await db.select({
            versionNumber: reportVersions.versionNumber,
            publishedAt:   reportVersions.publishedAt,
            summary:       reportVersions.summary,
            isAmendment:   reportVersions.isAmendment,
        })
            .from(reportVersions)
            .where(and(
                eq(reportVersions.tenantId, tenantId),
                eq(reportVersions.inspectionId, inspectionId),
            ))
            .orderBy(desc(reportVersions.versionNumber))
            .all();
        const amendmentTrail = {
            amended: versionRows.length > 1,
            latestVersion: versionRows[0]?.versionNumber ?? 0,
            versions: versionRows.map(v => ({
                versionNumber: v.versionNumber,
                publishedAt:   v.publishedAt,
                reason:        v.summary ?? null,
                isAmendment:   v.isAmendment,
            })),
        };

        // #119 — re-inspection context for the report page. When this
        // inspection is a re-inspection, the page renders only the carried
        // items with a left(original)/right(follow-up) layout. The status
        // catalog is the tenant's (falls back to defaults) so the follow-up
        // badge can resolve a human label from item.followupStatus.
        const reinspection = inspection.sourceInspectionId
            ? {
                round: inspection.reinspectionRound ?? 1,
                rootInspectionId: inspection.rootInspectionId,
                statuses: parseReinspectionStatuses(
                    (await db.select({ s: tenantConfigs.reinspectionStatuses })
                        .from(tenantConfigs)
                        .where(eq(tenantConfigs.tenantId, tenantId))
                        .get())?.s ?? null,
                ),
            }
            : null;

        // Layer-2 report signature + cryptographic verification metadata.
        // Both fields are null for draft/submitted reports; once published the
        // report page renders the inspector signature block and a verifiable QR.
        const isPublished = isReportPublished(inspection.reportStatus);

        // Extract _inspector_signature from the already-loaded results row.
        type InspectorSig = { signatureBase64?: string | null; signedAt?: number | null; userId?: string | null; auto?: boolean };
        const resultsData = resultsRow?.data as Record<string, unknown> | null | undefined;
        const rawSig = resultsData?._inspector_signature as InspectorSig | undefined;

        const signature = isPublished
            ? {
                signatureBase64: rawSig?.signatureBase64 ?? null,
                signedAt:        rawSig?.signedAt ?? null,
                inspectorName,
                inspectorLicense,
            }
            : null;

        let verification: { versionNumber: number; contentHash: string | null; verifyToken: string; publishedAt: number | null } | null = null;
        if (isPublished) {
            const vrow = await db.select({
                versionNumber:     reportVersions.versionNumber,
                contentHash:       reportVersions.contentHash,
                verificationToken: reportVersions.verificationToken,
                publishedAt:       reportVersions.publishedAt,
            }).from(reportVersions)
                .where(and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.inspectionId, inspectionId)))
                .orderBy(desc(reportVersions.versionNumber))
                .limit(1)
                .get();
            if (vrow?.verificationToken) {
                verification = {
                    versionNumber: vrow.versionNumber,
                    contentHash:   vrow.contentHash ?? null,
                    verifyToken:   vrow.verificationToken,
                    publishedAt:   vrow.publishedAt ?? null,
                };
            }
        }

        return {
            inspection: { ...inspection, inspectorName },
            theme: reportTheme,
            amendmentTrail,
            reinspection,
            // DB-16 — resolved report cover image URL (cover_photo_id holds the
            // R2 key of an attached/pool photo). null when the inspector has not
            // picked a cover. The renderer consumes this directly.
            coverPhotoUrl: resolveCoverUrl(inspection as { coverImageKey?: string | null; coverPhotoId?: string | null }, makePhotoUrl),
            stats: { total: stats.total, satisfactory: stats.satisfactory, monitor: stats.monitor, defect: stats.defect },
            sections,
            ratingLevels: levels.length > 0 ? levels : [
                { id: 'Satisfactory', label: 'Satisfactory', abbreviation: 'SAT', color: '#22c55e', severity: 'good', isDefect: false },
                { id: 'Monitor', label: 'Monitor', abbreviation: 'MON', color: '#f59e0b', severity: 'marginal', isDefect: false },
                { id: 'Defect', label: 'Defect', abbreviation: 'DEF', color: '#f43f5e', severity: 'significant', isDefect: true },
                { id: 'Not Inspected', label: 'Not Inspected', abbreviation: 'NI', color: '#3b82f6', severity: 'minor', isDefect: false },
            ],
            showEstimates,
            enableRepairList,
            enableCustomerRepairExport,
            propertyFacts,
            // Layer-2 report signature + verification (see docs/superpowers/specs/report-signature).
            isPublished,
            signature,
            verification,
        };
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
        const db = this.getDrizzle();
        const insp = await db.select({
            id:                inspections.id,
            propertyAddress:   inspections.propertyAddress,
            date:              inspections.date,
            inspectorId:       inspections.inspectorId,
            paymentRequired:   inspections.paymentRequired,
            paymentStatus:     inspections.paymentStatus,
            agreementRequired: inspections.agreementRequired,
        }).from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!insp) return null;

        // Resolve the outstanding gate. Agreement before payment (signed first).
        let reason: 'payment' | 'agreement' | null = null;
        let agreementToken: string | null = null;
        if (insp.agreementRequired === true) {
            const signed = await db.select({ id: agreementRequests.id })
                .from(agreementRequests)
                .where(and(
                    eq(agreementRequests.inspectionId, inspectionId),
                    eq(agreementRequests.tenantId, tenantId),
                    eq(agreementRequests.status, 'signed'),
                ))
                .limit(1);
            if (signed.length === 0) {
                reason = 'agreement';
                const pending = await db.select({ token: agreementRequests.token })
                    .from(agreementRequests)
                    .where(and(
                        eq(agreementRequests.inspectionId, inspectionId),
                        eq(agreementRequests.tenantId, tenantId),
                    ))
                    .orderBy(desc(agreementRequests.createdAt))
                    .limit(1)
                    .get();
                agreementToken = pending?.token ?? null;
            }
        }
        // Payment-outstanding is computed independently of `reason` so the
        // dual-gate (agreement AND payment) case can route to combined checkout.
        const paymentOutstanding = insp.paymentRequired === true && insp.paymentStatus !== 'paid';
        if (!reason && paymentOutstanding) {
            reason = 'payment';
        }
        if (!reason) return null;   // not gated — nothing to surface

        // Track I-a Task 7 — both gates outstanding → combined "Sign & pay".
        const bothOutstanding = reason === 'agreement' && paymentOutstanding;

        const branding = await db.select({ siteName: tenantConfigs.siteName, primaryColor: tenantConfigs.primaryColor })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();

        let inspector: { name: string | null; email: string | null; phone: string | null; licenseNumber: string | null } | undefined;
        if (insp.inspectorId) {
            inspector = await db.select({
                name: users.name, email: users.email, phone: users.phone, licenseNumber: users.licenseNumber,
            }).from(users)
                .where(and(eq(users.id, insp.inspectorId), eq(users.tenantId, tenantId)))
                .get();
        }

        // Surface the invoice amount whenever payment is part of the gate (the
        // payment-only page AND the combined Sign & pay page both show it).
        let amountCents: number | null = null;
        if (paymentOutstanding) {
            const invoice = await db.select({ amountCents: invoices.amountCents })
                .from(invoices)
                .where(and(eq(invoices.tenantId, tenantId), eq(invoices.inspectionId, inspectionId)))
                .orderBy(desc(invoices.createdAt))
                .limit(1)
                .get();
            amountCents = invoice?.amountCents ?? null;
        }

        // Reconstruct the first outstanding signer's tier-2 link token
        // server-side. Used by BOTH the combined "Sign & pay" checkout URL and
        // the agreement-only sign URL — `agreementRequests.token` is an
        // UNDISTRIBUTED placeholder for envelope-v2 (real tokens live per-signer),
        // so routing the customer to it would 404. When the helper is unavailable
        // or yields no outstanding signer, fall back to the legacy envelope token
        // (still resolves for legacy `createSigningRequest` envelopes whose
        // plaintext token IS distributed) — last resort, never break those.
        let signerLink: string | null = null;
        if ((bothOutstanding || reason === 'agreement') && agreementService) {
            signerLink = await agreementService.getFirstOutstandingSignerLink(tenantId, inspectionId);
        }
        const agreementLinkToken = signerLink ?? agreementToken;

        const actionUrl = bothOutstanding && signerLink
            ? `/checkout/${tenantSlug}/${signerLink}`
            : reason === 'payment'
                ? `/invoice/${inspectionId}`
                : (agreementLinkToken ? `/agreements/sign/${tenantSlug}/${agreementLinkToken}` : `/report-gate/${tenantSlug}/${inspectionId}`);

        const actionLabel = bothOutstanding && signerLink
            ? 'Sign & pay'
            : reason === 'payment' ? 'Pay invoice' : 'Sign agreement';

        return {
            reason,
            companyName: branding?.siteName ?? 'OpenInspection',
            // A-10 — nullable: null means "tenant set no accent", the page
            // keeps the platform design tokens (no per-surface fallback hex).
            primaryColor: branding?.primaryColor ?? null,
            actionUrl,
            actionLabel,
            propertyAddress: insp.propertyAddress ?? null,
            inspectorName: inspector?.name ?? null,
            inspectorEmail: inspector?.email ?? null,
            inspectorPhone: inspector?.phone ?? null,
            inspectorLicense: inspector?.licenseNumber ?? null,
            scheduledDate: insp.date ?? null,
            amountCents,
            currency: amountCents != null ? 'USD' : null,
        };
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
        const db = this.getDrizzle();

        // Authority row — gate on existence + tenant ownership first.
        const insp = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!insp) return null;

        // Service lines — effective price = priceOverride ?? priceSnapshot
        // (P-4 authority chain, tier 2). Tenant-scoped on both columns.
        const serviceRows = await db.select({
            id:            inspectionServices.id,
            nameSnapshot:  inspectionServices.nameSnapshot,
            priceSnapshot: inspectionServices.priceSnapshot,
            priceOverride: inspectionServices.priceOverride,
        }).from(inspectionServices)
            .where(and(
                eq(inspectionServices.tenantId, tenantId),
                eq(inspectionServices.inspectionId, inspectionId),
            ))
            .all();

        // Tenant's agreement templates — drives a "send agreement" dropdown later.
        const agreementRows = await db.select({ id: agreements.id, name: agreements.name })
            .from(agreements)
            .where(eq(agreements.tenantId, tenantId))
            .orderBy(desc(agreements.createdAt))
            .all();

        // Agreement requests for this inspection, newest first.
        const requestRows = await db.select({
            id:          agreementRequests.id,
            status:      agreementRequests.status,
            clientEmail: agreementRequests.clientEmail,
            signedAt:    agreementRequests.signedAt,
            createdAt:   agreementRequests.createdAt,
        }).from(agreementRequests)
            .where(and(
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.inspectionId, inspectionId),
            ))
            .orderBy(desc(agreementRequests.createdAt))
            .all();

        // Reused primitives. getPeopleCard/computePublishReadiness throw NotFound
        // when the row is absent — but we already confirmed it exists above, so
        // they resolve. InvoiceService is constructed inline (it takes only a
        // D1Database, same handle this service holds) per the DI guidance: no
        // constructor-chain redesign, just compose the read.
        const invoiceSvc = new InvoiceService(this.db);
        const [people, readiness, invoice] = await Promise.all([
            this.getPeopleCard(inspectionId, tenantId),
            this.computePublishReadiness(inspectionId, tenantId),
            invoiceSvc.findByInspectionId(tenantId, inspectionId),
        ]);

        return {
            inspection: {
                id:                insp.id,
                propertyAddress:   insp.propertyAddress,
                clientName:        insp.clientName ?? null,
                clientEmail:       insp.clientEmail ?? null,
                clientPhone:       insp.clientPhone ?? null,
                clientContactId:   insp.clientContactId ?? null,
                status:            insp.status,
                reportStatus:      insp.reportStatus as string,
                date:              insp.date ?? null,
                inspectorId:       insp.inspectorId ?? null,
                templateId:        insp.templateId ?? null,
                price:             insp.price,
                paymentStatus:     insp.paymentStatus,
                paymentRequired:   insp.paymentRequired === true,
                agreementRequired: insp.agreementRequired === true,
                coverPhoto:        insp.coverPhotoId ?? null,
                referredByAgentId: insp.referredByAgentId ?? null,
                sellingAgentId:    insp.sellingAgentId ?? null,
                createdAt:         safeISODate(insp.createdAt),
            },
            tenantSlug,
            people,
            services: serviceRows.map(s => ({
                id:        s.id,
                name:      s.nameSnapshot,
                priceCents: s.priceOverride ?? s.priceSnapshot,
            })),
            agreements: agreementRows.map(a => ({ id: a.id, name: a.name })),
            agreementRequests: requestRows.map(r => ({
                id:          r.id,
                status:      r.status,
                clientEmail: r.clientEmail,
                signedAt:    r.signedAt ? safeISODate(r.signedAt) : null,
                createdAt:   safeISODate(r.createdAt),
            })),
            invoice: invoice
                ? {
                    id:         invoice.id,
                    status:     invoice.status,
                    amountCents: invoice.amountCents,
                    sentAt:     invoice.sentAt,
                    paidAt:     invoice.paidAt,
                }
                : null,
            publishReadiness: {
                ready:         readiness.ready,
                blockingCount: readiness.blockingDefects.length,
            },
        };
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
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const recipients: Array<{
            contactId: string | null;
            name:      string;
            role:      'client' | 'agent_buyer' | 'agent_listing';
            email:     string | null;
            phone:     string | null;
        }> = [];

        // Client — stored inline on inspections (not contacts table). Only
        // include when there is at least a name AND at least one channel.
        if ((inspection.clientName ?? '').trim() && (inspection.clientEmail || inspection.clientPhone)) {
            recipients.push({
                contactId: null,
                name:      inspection.clientName as string,
                role:      'client',
                email:     (inspection.clientEmail as string | null) ?? null,
                phone:     (inspection.clientPhone as string | null) ?? null,
            });
        }

        // Agents — buyer's agent (referredByAgentId) + listing agent (sellingAgentId).
        const agentIds = [inspection.referredByAgentId, inspection.sellingAgentId]
            .filter((x): x is string => typeof x === 'string' && x.length > 0);
        if (agentIds.length > 0) {
            const agentRows = await db.select().from(contacts)
                .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, agentIds)));
            const byId = new Map<string, typeof agentRows[number]>();
            for (const row of agentRows) byId.set(row.id as string, row);

            const buyerId   = inspection.referredByAgentId as string | null;
            const listingId = inspection.sellingAgentId   as string | null;

            for (const [id, role] of [
                [buyerId,   'agent_buyer'  as const],
                [listingId, 'agent_listing' as const],
            ] as Array<[string | null, 'agent_buyer' | 'agent_listing']>) {
                if (!id) continue;
                const row = byId.get(id);
                if (!row) continue;
                const email = (row.email as string | null) ?? null;
                const phone = (row.phone as string | null) ?? null;
                if (!email && !phone) continue; // no delivery channel
                recipients.push({
                    contactId: row.id as string,
                    name:      row.name as string,
                    role,
                    email,
                    phone,
                });
            }
        }

        return recipients;
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
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        // Inspector — users table (tenant-scoped).
        let inspector: { id: string; name: string | null; email: string; phone: string | null } | null = null;
        if (inspection.inspectorId) {
            const u = await db.select().from(users)
                .where(and(eq(users.id, inspection.inspectorId as string), eq(users.tenantId, tenantId)))
                .get();
            if (u) {
                inspector = {
                    id:    u.id as string,
                    name:  (u.name  as string | null) ?? null,
                    email: u.email as string,
                    phone: (u.phone as string | null) ?? null,
                };
            }
        }

        // Client — inline on inspections. Only return when there's at least
        // a name (otherwise nothing meaningful to render in the card).
        const clientName = (inspection.clientName as string | null) ?? null;
        const client = clientName && clientName.trim().length > 0
            ? {
                name:  clientName,
                email: (inspection.clientEmail as string | null) ?? null,
                phone: (inspection.clientPhone as string | null) ?? null,
            }
            : null;

        // Agents — fetch both in one query.
        const agentIds = [inspection.referredByAgentId, inspection.sellingAgentId]
            .filter((x): x is string => typeof x === 'string' && x.length > 0);
        const agentRowsById = new Map<string, typeof contacts.$inferSelect>();
        if (agentIds.length > 0) {
            const rows = await db.select().from(contacts)
                .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, agentIds)));
            for (const row of rows) agentRowsById.set(row.id as string, row);
        }
        const toAgent = (id: string | null) => {
            if (!id) return null;
            const row = agentRowsById.get(id);
            if (!row) return null;
            return {
                id:     row.id as string,
                name:   row.name as string,
                email:  (row.email  as string | null) ?? null,
                phone:  (row.phone  as string | null) ?? null,
                agency: (row.agency as string | null) ?? null,
            };
        };
        const buyerAgent   = toAgent(inspection.referredByAgentId as string | null);
        const listingAgent = toAgent(inspection.sellingAgentId   as string | null);

        return {
            inspector,
            client,
            buyerAgents:   buyerAgent   ? [buyerAgent]   : [],
            listingAgents: listingAgent ? [listingAgent] : [],
        };
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
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');
        if (inspection.status !== INSPECTION_STATUS.COMPLETED) throw Errors.BadRequest('Inspection must be completed before publishing the report.');

        await db.update(inspections)
            .set({ reportStatus: REPORT_STATUS.PUBLISHED })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
        // Await so AutomationService.trigger actually inserts automation_logs
        // before the response goes out — the prior fire-and-forget pattern
        // dangled the promise so CF terminated the isolate before the insert
        // completed (and ditto for inspection.confirmed / cancelled / created
        // below — all four paths now block on trigger).
        await fireAutomation(this.db, tenantId, inspectionId, 'report.published');

        // Spec 5H D2 — auto-sign on publish: if the inspection has the flag
        // enabled AND the assigned inspector has a saved signature, inject
        // _inspector_signature into inspection_results.data so the published
        // report renders with the signature without requiring a manual step.
        const inspForSign = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (inspForSign?.autoSignOnPublish && inspForSign.inspectorId) {
            const inspector = await db.select().from(users)
                .where(eq(users.id, inspForSign.inspectorId)).get();
            if (inspector?.defaultSignatureBase64) {
                const resultsRow = await db.select().from(inspectionResults)
                    .where(eq(inspectionResults.inspectionId, inspectionId)).get();
                const data: Record<string, unknown> = (resultsRow?.data as Record<string, unknown>) ?? {};
                data._inspector_signature = {
                    signatureBase64: inspector.defaultSignatureBase64,
                    signedAt:        Date.now(),
                    userId:          inspector.id,
                    auto:            true,
                };
                if (resultsRow) {
                    await db.update(inspectionResults)
                        .set({ data: data as object, lastSyncedAt: new Date() })
                        .where(eq(inspectionResults.id, resultsRow.id));
                } else {
                    await db.insert(inspectionResults).values({
                        id:           crypto.randomUUID(),
                        tenantId,
                        inspectionId,
                        data:         data as object,
                        lastSyncedAt: new Date(),
                    });
                }
            }
        }

        const tenantRow = await db.select({ slug: tenants.slug })
            .from(tenants).where(eq(tenants.id, tenantId)).get();
        const tenantSlug = tenantRow?.slug ?? '';
        return {
            reportUrl: `/report/${tenantSlug}/${inspectionId}`,
            reportStatus: REPORT_STATUS.PUBLISHED,
        };
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
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const template = inspection.templateId
            ? await db.select().from(templates)
                .where(and(eq(templates.id, inspection.templateId as string), eq(templates.tenantId, tenantId)))
                .get()
            : null;

        const resultsRow = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();

        // Prefer per-inspection snapshot over live template schema (mirrors getReportData).
        const inspectionSnapshotRaw = (inspection as unknown as { templateSnapshot?: unknown }).templateSnapshot;
        const inspectionSnapshot = inspectionSnapshotRaw
            ? (typeof inspectionSnapshotRaw === 'string' ? JSON.parse(inspectionSnapshotRaw as string) : inspectionSnapshotRaw)
            : null;
        const hasInspectionSnapshot = inspectionSnapshot
            && typeof inspectionSnapshot === 'object'
            && Array.isArray((inspectionSnapshot as { sections?: unknown }).sections)
            && (inspectionSnapshot as { sections: unknown[] }).sections.length > 0;

        const rawSchema = hasInspectionSnapshot
            ? inspectionSnapshot
            : template?.schema
                ? (typeof template.schema === 'string' ? JSON.parse(template.schema) : template.schema)
                : { sections: [] };

        interface RawSchemaData { sections?: unknown[] }
        const schemaData: TemplateSchemaV2 = Array.isArray(rawSchema)
            ? ({ schemaVersion: 2, sections: [{ id: 'general', title: 'General', items: rawSchema }] } as unknown as TemplateSchemaV2)
            : (rawSchema as RawSchemaData).sections
                ? rawSchema as TemplateSchemaV2
                : ({ schemaVersion: 2, sections: [] } as unknown as TemplateSchemaV2);

        const resultData: Record<string, unknown> = resultsRow?.data
            ? (typeof resultsRow.data === 'string' ? JSON.parse(resultsRow.data) : resultsRow.data) as Record<string, unknown>
            : {};

        // Track H (IA-7 / P-6②) — effective requirement: per-inspection
        // override beats the tenant default; both unset → 'none' (loose).
        const cfgRow = await db.select({ requireDefectFields: tenantConfigs.requireDefectFields })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        const override = (inspection as unknown as { requireDefectFieldsOverride?: RequireDefectFields | null }).requireDefectFieldsOverride;
        const requirement = resolveRequireDefectFields(override, cfgRow?.requireDefectFields);

        return computePublishReadinessFromState(schemaData, resultData, requirement);
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
        const data = await this.getReportData(id, tenantId, (key: string) => key);
        const payload = JSON.stringify({ v: RENDER_VERSION, data });
        return sha256Hex(payload);
    }

    /**
     * Layer ③ report-print footer context. Tenant-scoped lookup of the three
     * inputs the PDF running footer needs:
     *  - settings: resolved tenant PDF settings (showFooter/showPageNumbers/
     *    showLicense + companyAddress) from tenant_configs (default ON).
     *  - address: the inspection's property address (footer fallback when the
     *    tenant has no companyAddress configured).
     *  - license: the assigned inspector's users.licenseNumber (or null when no
     *    inspector is assigned / the user row carries no license).
     *
     * All reads are filtered by tenantId so a footer can never leak a foreign
     * tenant's address/license.
     */
    async getReportPdfFooterContext(
        id: string,
        tenantId: string,
    ): Promise<{ settings: PdfSettings; address: string; license: string | null }> {
        const db = drizzle(this.db);

        const insp = await db
            .select({ propertyAddress: inspections.propertyAddress, inspectorId: inspections.inspectorId })
            .from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();

        const cfg = await db
            .select({
                companyAddress: tenantConfigs.companyAddress,
                pdfShowFooter: tenantConfigs.pdfShowFooter,
                pdfShowPageNumbers: tenantConfigs.pdfShowPageNumbers,
                pdfShowLicense: tenantConfigs.pdfShowLicense,
            })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();

        let license: string | null = null;
        if (insp?.inspectorId) {
            const owner = await db
                .select({ licenseNumber: users.licenseNumber })
                .from(users)
                .where(and(eq(users.id, insp.inspectorId), eq(users.tenantId, tenantId)))
                .get();
            license = owner?.licenseNumber ?? null;
        }

        return {
            settings: resolvePdfSettings(cfg),
            address: insp?.propertyAddress ?? '',
            license,
        };
    }
}
