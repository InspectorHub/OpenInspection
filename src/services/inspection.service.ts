import { drizzle } from 'drizzle-orm/d1';
import { eq, and, or, lt, gte, lte, sql, inArray } from 'drizzle-orm';
import { inspections, inspectionResults, templates, inspectionAgreements, users, services, inspectionServices, tenantConfigs, invoices, inspectionMediaPool, tenants } from '../lib/db/schema';
import { contacts } from '../lib/db/schema/contact';
import { Errors } from '../lib/errors';
import { computeReportStats, getRatingColor, getRatingBucket, type RatingLevel } from '../lib/report-utils';
import { z } from 'zod';
import { InspectionSchema, InspectionListQuerySchema, CreateInspectionSchema } from '../lib/validations/inspection.schema';

import { ScopedDB } from '../lib/db/scoped';
import { escapeLikePattern } from '../lib/db/like-escape';
import { safeISODate, safeTimestamp } from '../lib/date';
import { AutomationService } from './automation.service';
import { logger } from '../lib/logger';
import { RECOMMENDATION_CATEGORIES, RECOMMENDATION_CATEGORY_IDS } from '../lib/recommendation-categories';
import { computePreflightFromData } from '../lib/preflight';
import { decideFieldWrite, applyFieldWrite } from '../lib/field-version';
import { ApprenticeService } from './apprentice.service';
import { findingKey, parseFindingKey, DEFAULT_UNIT } from '../lib/finding-key';
import { isDefectTrade, isDefectDeadline, isDefectTimeframe, DEFECT_TRADE_LABELS, DEFECT_DEADLINE_LABELS, DEFECT_TIMEFRAME_LABELS } from '../types/defect-fields';
import { renderTemplate, listUnresolved } from '../lib/mustache';
import type { DefectCommentState } from '../types/inspection-item-state';
import type { CannedDefect, TemplateSchemaV2 } from '../types/template-schema';

/** Slug → label map for resolving aggregated recommendation badges in
 *  getReportData. Built once at module load. */
const RECOMMENDATION_CATEGORY_LABELS = new Map<string, string>(
    RECOMMENDATION_CATEGORIES.map(c => [c.id, c.label]),
);

/**
 * Sprint 2 S2-3 / S2-4 — sanitize the new per-defect fields on every
 * inspection-results write. Mutates the supplied `data` record in place.
 *
 *   - `recommendationId` must be one of {@link RECOMMENDATION_CATEGORY_IDS};
 *     unknown slugs are dropped (set to null) so an outdated client doesn't
 *     poison the JSON payload.
 *   - `estimateLow` / `estimateHigh` must be non-negative finite integers
 *     (cents). Anything else collapses to null.
 *
 * The sanitizer is intentionally lossy + per-row: a single malformed defect
 * does not reject the whole patch. Mirrors the canned-comment + photo merge
 * strategy used elsewhere in updateResults().
 */
export function sanitizeDefectStates(data: Record<string, unknown>): void {
    const validSlugs = new Set<string>(RECOMMENDATION_CATEGORY_IDS);
    for (const key of Object.keys(data)) {
        const entry = data[key] as { tabs?: { defects?: unknown } } | null | undefined;
        if (!entry || typeof entry !== 'object') continue;
        const defects = entry.tabs?.defects;
        if (!Array.isArray(defects)) continue;
        for (const d of defects as Array<Record<string, unknown>>) {
            if (!d || typeof d !== 'object') continue;
            // recommendationId — string slug or null
            if ('recommendationId' in d) {
                const v = d.recommendationId;
                d.recommendationId = (typeof v === 'string' && validSlugs.has(v)) ? v : null;
            }
            // estimateLow / estimateHigh — non-negative integers (cents) or null
            for (const side of ['estimateLow', 'estimateHigh'] as const) {
                if (side in d) {
                    const v = d[side];
                    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
                        d[side] = Math.round(v);
                    } else {
                        d[side] = null;
                    }
                }
            }
            // trade / deadline / timeframe — enum or null (drop unknown values)
            if ('trade' in d) {
                d.trade = isDefectTrade(d.trade) ? d.trade : null;
            }
            if ('deadline' in d) {
                d.deadline = isDefectDeadline(d.deadline) ? d.deadline : null;
            }
            if ('timeframe' in d) {
                d.timeframe = isDefectTimeframe(d.timeframe) ? d.timeframe : null;
            }
        }
    }
}

/**
 * Returns the trigger Promise so callers can keep the worker isolate alive
 * via `c.executionCtx.waitUntil(...)`. The previous fire-and-forget version
 * dangled the promise — CF Workers terminated the isolate after the
 * response was sent, so AutomationService.trigger never inserted the
 * automation_logs row, and report.published / inspection.confirmed /
 * inspection.cancelled / inspection.created automations never fired.
 */
function fireAutomation(db: D1Database, tenantId: string, inspectionId: string, event: string): Promise<void> {
    return new AutomationService(db)
        .trigger({ tenantId, inspectionId, triggerEvent: event, companyName: '', reportBaseUrl: '' })
        .catch(err => logger.error('automation trigger failed', { event }, err instanceof Error ? err : undefined));
}

/**
 * Sprint 2 S2-1 — Translate a rating_systems.levels[] payload into the
 * legacy `RatingLevel` shape consumed by computeReportStats / getRatingColor.
 *
 *   `bucket: 'satisfactory'` → severity: 'good'  / isDefect: false
 *   `bucket: 'monitor'`      → severity: 'marginal' / isDefect: false
 *   `bucket: 'defect'`       → severity: 'significant' / isDefect: true
 *   `bucket: 'na'`           → severity: 'minor' / isDefect: false
 */
function mapRatingSystemLevels(levels: Array<Record<string, unknown>>): RatingLevel[] {
    const sevByBucket: Record<string, RatingLevel['severity']> = {
        satisfactory: 'good',
        monitor:      'marginal',
        defect:       'significant',
        na:           'minor',
    };
    return levels
        .slice()
        .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
        .map((lvl) => {
            const bucket = String(lvl.bucket ?? 'na');
            const severity = sevByBucket[bucket] ?? 'minor';
            const id = String(lvl.id ?? lvl.label ?? lvl.abbr ?? crypto.randomUUID());
            return {
                id,
                label:        String(lvl.label ?? lvl.abbr ?? id),
                abbreviation: String(lvl.abbr ?? lvl.label ?? id),
                color:        String(lvl.color ?? '#9ca3af'),
                severity,
                isDefect:     bucket === 'defect',
                ...(typeof lvl.description === 'string' ? { description: lvl.description } : {}),
            };
        });
}

/**
 * Resolve a defect-state row into the variables consumed by the Mustache
 * renderer when substituting tokens like `{{location}}` / `{{trade}}` in
 * canned-comment prose. Falls back to the template's default `location`
 * when the inspector hasn't filled an inspection-specific override.
 */
function stringifyAttributeValue(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v.length > 0 ? v : null;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    return null;
}

function resolveDefectMustacheVars(
    st: DefectCommentState | undefined,
    d: CannedDefect,
    itemAttributes?: Record<string, unknown>,
): Record<string, string | null> {
    const location = (typeof st?.location === 'string' && st.location.length > 0)
        ? st.location
        : (d.location || null);
    const vars: Record<string, string | null> = {
        location,
        trade:     st?.trade     ? DEFECT_TRADE_LABELS[st.trade]         : null,
        deadline:  st?.deadline  ? DEFECT_DEADLINE_LABELS[st.deadline]   : null,
        timeframe: st?.timeframe ? DEFECT_TIMEFRAME_LABELS[st.timeframe] : null,
    };
    if (itemAttributes) {
        for (const [k, v] of Object.entries(itemAttributes)) {
            if (k in vars) continue; // defect-level vars take precedence
            vars[k] = stringifyAttributeValue(v);
        }
    }
    return vars;
}

export interface PublishBlockingDefect {
    sectionId:        string;
    sectionTitle:     string;
    itemId:           string;
    itemLabel:        string;
    cannedId:         string;
    cannedTitle:      string;
    missing:          Array<'location' | 'trade'>;
    unresolvedTokens: string[];
}

export interface PublishReadiness {
    ready: boolean;
    blockingDefects: PublishBlockingDefect[];
}

/**
 * Task 12 — pure function: walks the template schema + inspection results
 * and returns the set of included defects that are missing required fields
 * (location and/or trade). Unresolved Mustache tokens in the rendered comment
 * are also reported.
 *
 * Required: location + trade.
 * Advisory (not blocking): deadline, timeframe.
 */
export function computePublishReadinessFromState(
    schema: TemplateSchemaV2,
    results: Record<string, unknown>,
): PublishReadiness {
    const blocking: PublishBlockingDefect[] = [];
    for (const section of schema.sections ?? []) {
        for (const item of section.items ?? []) {
            if (item.type !== 'rich') continue;
            const defectsTpl = item.tabs?.defects ?? [];
            const entry = results[item.id] as { tabs?: { defects?: DefectCommentState[] }; attributes?: Record<string, unknown> } | undefined;
            const stateRows = entry?.tabs?.defects ?? [];
            const stateById = new Map(stateRows.map(d => [d.cannedId, d]));
            const itemAttrVars: Record<string, string | null> = {};
            if (entry?.attributes) {
                for (const [k, v] of Object.entries(entry.attributes)) {
                    itemAttrVars[k] = stringifyAttributeValue(v);
                }
            }
            for (const d of defectsTpl) {
                const st = stateById.get(d.id);
                const included = st ? !!st.included : !!d.default;
                if (!included) continue;
                const missing: Array<'location' | 'trade'> = [];
                const hasLocation = (typeof st?.location === 'string' && st.location.length > 0)
                    || (typeof d.location === 'string' && d.location.length > 0);
                if (!hasLocation) missing.push('location');
                if (!st?.trade) missing.push('trade');
                const effectiveComment = (st?.comment && st.comment.length > 0) ? st.comment : d.comment;
                const unresolved = listUnresolved(effectiveComment, {
                    location:  hasLocation ? 'x' : null,
                    trade:     st?.trade     ?? null,
                    deadline:  st?.deadline  ?? null,
                    timeframe: st?.timeframe ?? null,
                    ...itemAttrVars,
                });
                if (missing.length === 0 && unresolved.length === 0) continue;
                blocking.push({
                    sectionId:        section.id,
                    sectionTitle:     section.title,
                    itemId:           item.id,
                    itemLabel:        item.label,
                    cannedId:         d.id,
                    cannedTitle:      d.title,
                    missing,
                    unresolvedTokens: unresolved,
                });
            }
        }
    }
    return { ready: blocking.length === 0, blockingDefects: blocking };
}

type Inspection = z.infer<typeof InspectionSchema>;
type InspectionListParams = z.infer<typeof InspectionListQuerySchema>;
type CreateInspectionData = z.infer<typeof CreateInspectionSchema>;

/** Round-2 backlog G1 — Property Facts strip payload. Mirrors the canonical
 *  Zod shape declared in inspection.schema.ts (PropertyFactsSchema). */
type PropertyFactFoundation = 'basement' | 'slab' | 'crawlspace' | 'other';
export interface PropertyFacts {
    yearBuilt:      number | null;
    sqft:           number | null;
    foundationType: PropertyFactFoundation | null;
    lotSize:        string | null;
    bedrooms:       number | null;
    bathrooms:      number | null;
}

/**
 * Service to handle all inspection-related business logic.
 */
export class InspectionService {
    constructor(private db: D1Database, private r2?: R2Bucket, private sdb?: ScopedDB, private kv?: KVNamespace) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Lists inspections with pagination and filtering.
     */
    async listInspections(tenantId: string, params: InspectionListParams) {
        const db = this.getDrizzle();
        const conditions = [eq(inspections.tenantId, tenantId)];

        if (params.status) conditions.push(eq(inspections.status, params.status as 'draft' | 'completed' | 'delivered'));
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
                    conditions.push(eq(inspections.status, 'in_progress'));
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
            status: row.status as 'draft' | 'completed' | 'delivered',
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

        const stats = { total: 0, draft: 0, completed: 0, delivered: 0 };
        for (const row of counts) {
            const n = Number(row.count);
            stats.total += n;
            if (row.status === 'draft') stats.draft = n;
            else if (row.status === 'completed') stats.completed = n;
            else if (row.status === 'delivered') stats.delivered = n;
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
     * delegates to the pure aggregator in src/lib/preflight.ts. The
     * apprentice pending count is read from apprentice_reviews; if
     * that table is missing (subsystem C not yet merged) we pass
     * `undefined` so the gate gracefully no-ops to "reviewed".
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

        // Apprentice pending — subsystem C dependency. Wrap the query
        // so a missing-table error degrades to undefined (gate passes).
        let pendingApprenticeCount: number | undefined;
        try {
            const rows = await this.db.prepare(
                'SELECT COUNT(*) AS cnt FROM apprentice_reviews WHERE inspection_id = ?1 AND tenant_id = ?2 AND status = "pending"'
            ).bind(inspectionId, tenantId).first<{ cnt: number }>();
            pendingApprenticeCount = rows?.cnt ?? 0;
        } catch {
            pendingApprenticeCount = undefined;
        }

        return computePreflightFromData(
            {
                coverPhotoId:      (ins.coverPhotoId as string | null) ?? null,
                propertyFacts:     (ins.propertyFacts as Record<string, unknown> | null) ?? null,
                agreementSignedAt: (ins.agreementSignedAt as number | null) ?? null,
            },
            items,
            pendingApprenticeCount,
        );
    }

    async getInspection(id: string, tenantId: string) {
        if (!this.sdb) throw new Error('ScopedDB session missing');

        const result = await this.sdb.getById(inspections, id);
        if (!result) throw Errors.NotFound('Inspection not found');

        const template = result.templateId
            ? await this.sdb.getById(templates, result.templateId as string)
            : null;
        const signed = await this.sdb.raw.select().from(inspectionAgreements)
            .where(and(eq(inspectionAgreements.inspectionId, id), eq(inspectionAgreements.tenantId, tenantId)))
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
    async createInspection(tenantId: string, data: CreateInspectionData & { inspectorId?: string }): Promise<Inspection> {
        if (!this.sdb) throw new Error('ScopedDB session missing');
        const id = crypto.randomUUID();
        const createdAt = new Date();
        const status = 'draft' as const;
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

        // Link selected services
        if (data.serviceIds && data.serviceIds.length > 0) {
            const db2 = this.getDrizzle();
            const svcRows = await db2.select().from(services)
                .where(and(eq(services.tenantId, tenantId), inArray(services.id, data.serviceIds)));
            if (svcRows.length > 0) {
                await db2.insert(inspectionServices).values(svcRows.map(s => ({
                    id:            crypto.randomUUID(),
                    tenantId,
                    inspectionId:  id,
                    serviceId:     s.id,
                    priceOverride: null,
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
            if (input.teamMode || input.leadInspectorId || (input.helperInspectorIds?.length ?? 0) > 0) {
                patch.teamMode           = input.teamMode;
                patch.leadInspectorId    = input.teamMode ? (input.leadInspectorId ?? creatorUserId) : null;
                patch.helperInspectorIds = JSON.stringify(input.teamMode ? (input.helperInspectorIds ?? []) : []);
            }
            if (Object.keys(patch).length > 0) {
                await db.update(inspections)
                    .set(patch)
                    .where(and(eq(inspections.id, created.id), eq(inspections.tenantId, tenantId)));
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

        return {
            ...clone,
            createdAt: safeISODate(clone.createdAt)
        };
    }

    /**
     * Round-2 backlog G1 (Spectora §E.2) — return the Property Facts strip
     * payload for a single inspection. Each field is null when the inspector
     * hasn't filled it in yet so the UI can show its "—" placeholder.
     */
    async getPropertyFacts(id: string, tenantId: string): Promise<PropertyFacts> {
        const db = this.getDrizzle();
        const row = await db.select({
            yearBuilt:      inspections.yearBuilt,
            sqft:           inspections.sqft,
            foundationType: inspections.foundationType,
            lotSize:        inspections.lotSize,
            bedrooms:       inspections.bedrooms,
            bathrooms:      inspections.bathrooms,
        }).from(inspections)
          .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
          .get();
        if (!row) throw Errors.NotFound('Inspection not found');
        // Foundation column is free-text in SQLite; coerce to the canonical
        // four-value enum so the API response schema validates. Anything
        // unexpected falls back to 'other'.
        const allowedFoundations: ReadonlyArray<PropertyFactFoundation> =
            ['basement', 'slab', 'crawlspace', 'other'] as const;
        const ft = row.foundationType ?? null;
        const foundationType: PropertyFactFoundation | null = ft === null
            ? null
            : (allowedFoundations.includes(ft as PropertyFactFoundation) ? (ft as PropertyFactFoundation) : 'other');
        return {
            yearBuilt:      row.yearBuilt      ?? null,
            sqft:           row.sqft           ?? null,
            foundationType,
            lotSize:        row.lotSize        ?? null,
            bedrooms:       row.bedrooms       ?? null,
            bathrooms:      row.bathrooms      ?? null,
        };
    }

    /**
     * Round-2 backlog G1 — patch the six Property Facts columns in a single
     * write. Undefined keys are skipped (so the caller can save one field at
     * a time without clobbering the others). Null values clear the field.
     * Returns the resulting facts row so the UI doesn't need a re-fetch.
     */
    async updatePropertyFacts(id: string, tenantId: string, facts: {
        yearBuilt?:      number | null | undefined;
        sqft?:           number | null | undefined;
        foundationType?: PropertyFactFoundation | null | undefined;
        lotSize?:        string | null | undefined;
        bedrooms?:       number | null | undefined;
        bathrooms?:      number | null | undefined;
    }): Promise<PropertyFacts> {
        const db = this.getDrizzle();
        const existing = await db.select({ id: inspections.id }).from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!existing) throw Errors.NotFound('Inspection not found');

        const update: Partial<typeof inspections.$inferInsert> = {};
        if (facts.yearBuilt      !== undefined) update.yearBuilt      = facts.yearBuilt;
        if (facts.sqft           !== undefined) update.sqft           = facts.sqft;
        if (facts.foundationType !== undefined) update.foundationType = facts.foundationType;
        if (facts.lotSize        !== undefined) update.lotSize        = facts.lotSize;
        if (facts.bedrooms       !== undefined) update.bedrooms       = facts.bedrooms;
        if (facts.bathrooms      !== undefined) update.bathrooms      = facts.bathrooms;

        if (Object.keys(update).length > 0) {
            await db.update(inspections).set(update)
                .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));
        }

        return this.getPropertyFacts(id, tenantId);
    }

    /**
     * Updates an inspection's results.
     */
    async updateResults(id: string, tenantId: string, data: Record<string, unknown>) {
        const db = this.getDrizzle();
        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) {
            throw Errors.NotFound('Inspection not found or access denied');
        }

        // Sprint 2 S2-3 / S2-4 — validate the per-defect recommendation slug
        // and estimate range fields before persisting. Unknown slugs are
        // dropped (silently — the legacy fields stay intact); negative or
        // non-finite cents collapse to null. This guards the JSON payload
        // without rejecting the entire write on a single bad row.
        sanitizeDefectStates(data);

        const existing = await db.select().from(inspectionResults).where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, tenantId))).get();

        if (existing) {
            const mergedData = { ...(existing.data as Record<string, unknown>), ...data };
            await db.update(inspectionResults).set({ data: mergedData, lastSyncedAt: new Date() }).where(eq(inspectionResults.id, existing.id));
        } else {
            // Sprint 2 S2-1 — when seeding an inspection_results row for the
            // first time, also freeze the active rating system onto the row
            // so future edits to the source system never mutate this report.
            let ratingSystemId: string | null = null;
            let ratingSystemSnapshot: unknown = null;
            if (inspection.templateId) {
                const tpl = await db.select().from(templates)
                    .where(and(eq(templates.id, inspection.templateId), eq(templates.tenantId, tenantId)))
                    .get();
                const tplRatingSystemId = tpl
                    ? ((tpl as unknown as { ratingSystemId?: string | null }).ratingSystemId ?? null)
                    : null;
                if (tplRatingSystemId) {
                    const { ratingSystems } = await import('../lib/db/schema');
                    const sysRow = await db.select().from(ratingSystems)
                        .where(and(eq(ratingSystems.id, tplRatingSystemId), eq(ratingSystems.tenantId, tenantId)))
                        .get();
                    if (sysRow) {
                        ratingSystemId = sysRow.id as string;
                        const rawLevels = sysRow.levels as unknown;
                        const lvls = typeof rawLevels === 'string' ? JSON.parse(rawLevels) : rawLevels;
                        ratingSystemSnapshot = { id: sysRow.id, slug: sysRow.slug, name: sysRow.name, levels: lvls };
                    }
                }
            }
            const insertValues = {
                id: crypto.randomUUID(),
                inspectionId: id,
                tenantId,
                data,
                lastSyncedAt: new Date(),
                ratingSystemId,
                ratingSystemSnapshot: ratingSystemSnapshot as never,
            };
            await db.insert(inspectionResults).values(insertValues);
        }
    }

    /**
     * Feature: inline template-snapshot edit.
     *
     * Replaces the per-inspection template snapshot wholesale — used by the
     * editor when an inspector swaps rating system, adds/removes sections or
     * items, or otherwise tailors the report structure for one job without
     * touching the source template row. Validation happens upstream at the
     * Zod boundary, so by the time we land here `snapshot` is a parsed v2
     * schema object; we stringify on the way to D1.
     */
    async updateTemplateSnapshot(id: string, tenantId: string, snapshot: unknown) {
        const db = this.getDrizzle();
        const row = await db.select({ id: inspections.id }).from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!row) throw Errors.NotFound('Inspection not found or access denied');
        await db.update(inspections)
            .set({ templateSnapshot: JSON.stringify(snapshot) as never })
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));
    }

    /**
     * Feature #20 phase 2 — swap the rating system on a per-inspection
     * snapshot, with controlled handling of already-saved item ratings.
     *
     * Mode:
     *   'remap'  — try to map each existing rating to the new system by
     *              severity bucket (good / marginal / significant). Levels
     *              whose bucket has no match in the new system are cleared.
     *   'clear'  — wipe every rating; preserve notes, photos, custom
     *              comments.
     *
     * Also clears inspection_results.ratingSystemSnapshot so getReportData
     * picks the new system from the template snapshot on the next read,
     * and re-freezes against the new system on the next write.
     */
    async switchRatingSystem(
        id: string,
        tenantId: string,
        ratingSystemId: string,
        mode: 'remap' | 'clear',
    ): Promise<{ remapped: number; cleared: number; total: number }> {
        const db = this.getDrizzle();
        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found or access denied');

        const { ratingSystems } = await import('../lib/db/schema');
        const sysRow = await db.select().from(ratingSystems)
            .where(and(eq(ratingSystems.id, ratingSystemId), eq(ratingSystems.tenantId, tenantId)))
            .get();
        if (!sysRow) throw Errors.NotFound('Rating system not found');

        type SeedLevel = { id?: string; abbr?: string; label: string; color?: string; bucket: string };
        const rawLevels = sysRow.levels as unknown;
        const newLevels: SeedLevel[] = typeof rawLevels === 'string' ? JSON.parse(rawLevels) as SeedLevel[] : rawLevels as SeedLevel[];

        // bucket → severity mapping (rating-systems table uses 'bucket',
        // TemplateSchemaV2 uses 'severity' on the embedded ratingSystem)
        const bucketToSeverity = (b: string): 'good' | 'marginal' | 'significant' | 'minor' => {
            if (b === 'satisfactory') return 'good';
            if (b === 'monitor') return 'marginal';
            if (b === 'defect') return 'significant';
            return 'minor';
        };

        // Build new embedded rating system for the snapshot
        const newSnapLevels = newLevels.map(l => ({
            id:           l.label,
            label:        l.label,
            ...(l.abbr ? { abbreviation: l.abbr } : {}),
            ...(l.color ? { color: l.color } : {}),
            severity:     bucketToSeverity(l.bucket),
            isDefect:     l.bucket === 'defect',
        }));

        // Build remap: old level label/id → new level id, via bucket
        const snapStr = inspection.templateSnapshot as unknown as string | null;
        const oldSnapshot = snapStr ? JSON.parse(snapStr) as { ratingSystem?: { levels?: Array<{ id: string; label?: string; severity?: string }> }; [k: string]: unknown } : {};
        const oldLevels = oldSnapshot.ratingSystem?.levels ?? [];
        const severityToBucket = (s: string | undefined): string | null => {
            if (s === 'good') return 'satisfactory';
            if (s === 'marginal') return 'monitor';
            if (s === 'significant') return 'defect';
            return null;
        };
        const remap = new Map<string, string | null>();
        for (const oldL of oldLevels) {
            const bucket = severityToBucket(oldL.severity);
            const newL = bucket ? newLevels.find(n => n.bucket === bucket) : null;
            remap.set(oldL.id, newL?.label ?? null);
            if (oldL.label && oldL.label !== oldL.id) remap.set(oldL.label, newL?.label ?? null);
        }

        // Overwrite snapshot
        const newSnapshot = {
            ...oldSnapshot,
            ratingSystem: {
                name:           sysRow.name,
                defaultLevelId: newSnapLevels[0]?.id,
                levels:         newSnapLevels,
            },
        };
        await db.update(inspections)
            .set({ templateSnapshot: JSON.stringify(newSnapshot) as never })
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));

        // Rewrite per-item ratings on inspection_results
        const existing = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, tenantId)))
            .get();
        let remapped = 0, cleared = 0, total = 0;
        if (existing) {
            const data = { ...(existing.data as Record<string, Record<string, unknown>>) };
            for (const itemId of Object.keys(data)) {
                const it = data[itemId];
                if (!it || !('rating' in it)) continue;
                const oldRating = it.rating as string | null | undefined;
                if (!oldRating) continue;
                total++;
                if (mode === 'clear') {
                    it.rating = null;
                    cleared++;
                } else {
                    const next = remap.has(oldRating) ? remap.get(oldRating) : null;
                    if (next) {
                        it.rating = next;
                        remapped++;
                    } else {
                        it.rating = null;
                        cleared++;
                    }
                }
            }
            // Clear the ratingSystemSnapshot freeze so the new one re-freezes
            // on the next write.
            await db.update(inspectionResults).set({
                data,
                ratingSystemId: null as never,
                ratingSystemSnapshot: null as never,
                lastSyncedAt: new Date(),
            }).where(eq(inspectionResults.id, existing.id));
        }

        return { remapped, cleared, total };
    }

    /**
     * Multi-photo upload to R2.
     */
    async uploadPhoto(id: string, tenantId: string, itemId: string, file: File) {
        if (!this.r2) throw Errors.BadRequest('Storage not available');
        await this.getInspection(id, tenantId); // Ownership check

        const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
        if (file.size > MAX_PHOTO_BYTES) {
            throw Errors.BadRequest(`Photo exceeds ${MAX_PHOTO_BYTES} bytes (got ${file.size})`);
        }

        const key = `${tenantId}/${id}/${itemId}_${crypto.randomUUID()}_${file.name}`;
        await this.r2.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type }
        });
        return key;
    }

    /**
     * Round-2 backlog #9 (Spectora §E.3) — Media Center.
     *
     * Aggregates every photo associated with an inspection in two groups:
     *   - `attached` — photos already pinned to a specific item, sourced
     *     from inspection_results.data[itemId].photos[]. Includes the item
     *     label and section title so the drawer card can show provenance.
     *   - `pool`     — loose photos uploaded to the inspection_media_pool
     *     table that have not yet been dragged onto an item.
     *
     * Sections/items come from the inspection's template snapshot when
     * available (so a mid-inspection template edit doesn't break labels);
     * otherwise we fall back to the live template row.
     */
    async getMediaCenter(
        inspectionId: string,
        tenantId: string,
    ): Promise<{
        attached: Array<{
            key: string;
            url: string;
            itemId: string;
            itemLabel: string;
            sectionId: string;
            sectionTitle: string;
            photoIndex: number;
            annotated: boolean;
        }>;
        pool: Array<{
            id: string;
            key: string;
            url: string;
            uploadedAt: number;
            takenAt: number | null;
        }>;
    }> {
        const db = this.getDrizzle();

        const insp = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!insp) throw Errors.NotFound('Inspection not found');

        // Resolve section/item label map from the snapshot (preferred) or
        // the live template row. Falls back to using the item id as label
        // when neither resolves — the drawer is still usable, just less
        // descriptive.
        interface SchemaItemLite { id: string; label?: string; title?: string }
        interface SchemaSectionLite { id: string; title?: string; name?: string; items?: SchemaItemLite[] }
        let sections: SchemaSectionLite[] = [];
        const snap = insp.templateSnapshot as { sections?: SchemaSectionLite[] } | null;
        if (snap && Array.isArray(snap.sections)) {
            sections = snap.sections;
        } else if (insp.templateId) {
            const tpl = await db.select().from(templates)
                .where(and(eq(templates.id, insp.templateId), eq(templates.tenantId, tenantId)))
                .get();
            const live = tpl?.schema as { sections?: SchemaSectionLite[] } | null;
            if (live && Array.isArray(live.sections)) sections = live.sections;
        }

        const itemMeta = new Map<string, { itemLabel: string; sectionId: string; sectionTitle: string }>();
        for (const sec of sections) {
            const sectionTitle = sec.title || sec.name || 'Section';
            for (const item of (sec.items ?? [])) {
                itemMeta.set(item.id, {
                    itemLabel: item.label || item.title || item.id,
                    sectionId: sec.id,
                    sectionTitle,
                });
            }
        }

        // Pull results — photos live under data[itemId].photos[]. Mirrors
        // the same shape used by getReportData().
        interface PhotoEntry { key: string; annotatedKey?: string; annotationsJson?: string }
        interface ResultEntry { photos?: PhotoEntry[] }
        const resultsRow = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();
        const resultData: Record<string, ResultEntry> = resultsRow?.data
            ? (typeof resultsRow.data === 'string' ? JSON.parse(resultsRow.data) : resultsRow.data) as Record<string, ResultEntry>
            : {};

        const attached: Array<{
            key: string;
            url: string;
            itemId: string;
            itemLabel: string;
            sectionId: string;
            sectionTitle: string;
            photoIndex: number;
            annotated: boolean;
        }> = [];
        for (const [key, entry] of Object.entries(resultData)) {
            const parsedKey = parseFindingKey(key);
            const itemId = parsedKey.itemId;
            const photos = Array.isArray(entry?.photos) ? entry.photos : [];
            const meta = itemMeta.get(itemId) ?? {
                itemLabel:    itemId,
                sectionId:    parsedKey.sectionId || 'unknown',
                sectionTitle: 'Unsectioned',
            };
            photos.forEach((p, idx) => {
                if (!p || typeof p.key !== 'string') return;
                const displayKey = p.annotatedKey || p.key;
                attached.push({
                    key:          displayKey,
                    url:          `/api/inspections/${inspectionId}/photos/${encodeURIComponent(displayKey)}`,
                    itemId,
                    itemLabel:    meta.itemLabel,
                    sectionId:    meta.sectionId,
                    sectionTitle: meta.sectionTitle,
                    photoIndex:   idx,
                    annotated:    !!p.annotatedKey,
                });
            });
        }

        // Pool — loose uploads, ordered newest first.
        const poolRows = await db.select().from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.inspectionId, inspectionId),
                eq(inspectionMediaPool.tenantId, tenantId),
            ))
            .orderBy(sql`${inspectionMediaPool.uploadedAt} desc`)
            .all();

        const pool = poolRows.map(r => ({
            id:          r.id,
            key:         r.r2Key,
            url:         r.url,
            uploadedAt:  r.uploadedAt,
            takenAt:     (r.exifData as { takenAt?: number } | null)?.takenAt ?? null,
        }));

        return { attached, pool };
    }

    /**
     * Round-2 backlog #9 — bulk upload to the loose pool. The photo is not
     * tied to any item until the inspector drags its card onto an item
     * textarea; see {@link attachPoolPhoto}.
     */
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
        if (!this.r2) throw Errors.BadRequest('Storage not available');
        await this.getInspection(inspectionId, tenantId); // ownership check

        const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
        if (file.size > MAX_PHOTO_BYTES) {
            throw Errors.BadRequest(`Photo exceeds ${MAX_PHOTO_BYTES} bytes (got ${file.size})`);
        }

        const id = crypto.randomUUID();
        const safeName = (file.name || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `${tenantId}/${inspectionId}/_pool_${id}_${safeName}`;
        await this.r2.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type || 'image/jpeg' },
        });

        const uploadedAt = Date.now();
        const takenAt = (opts?.takenAt && Number.isFinite(opts.takenAt) && opts.takenAt > 0) ? opts.takenAt : null;
        const url = `/api/inspections/${inspectionId}/photos/${encodeURIComponent(key)}`;
        const exifData = takenAt !== null ? { takenAt } : null;

        const db = this.getDrizzle();
        await db.insert(inspectionMediaPool).values({
            id,
            inspectionId,
            tenantId,
            r2Key: key,
            url,
            uploadedAt,
            exifData,
        });

        return { id, key, url, uploadedAt, takenAt };
    }

    /**
     * Round-2 backlog #9 — atomically attach a pool photo to an item.
     * Moves the photo entry into inspection_results.data[itemId].photos[]
     * and deletes the pool row. The R2 object is preserved (only the
     * pointer moves) so an in-flight drag can be replayed safely.
     */
    async attachPoolPhoto(
        inspectionId: string,
        tenantId: string,
        poolId: string,
        itemId: string,
        sectionId?: string,
    ): Promise<{ key: string; itemId: string; photoIndex: number }> {
        if (!itemId) throw Errors.BadRequest('itemId is required');
        await this.getInspection(inspectionId, tenantId); // ownership check
        const db = this.getDrizzle();

        const poolRow = await db.select().from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.id, poolId),
                eq(inspectionMediaPool.inspectionId, inspectionId),
                eq(inspectionMediaPool.tenantId, tenantId),
            ))
            .get();
        if (!poolRow) throw Errors.NotFound('Pool photo not found');

        // Locate or create the inspection_results row, then append the
        // photo to data[key].photos[].
        interface ResultEntry { photos?: Array<{ key: string }> }
        const existing = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();

        const data: Record<string, ResultEntry> = existing?.data
            ? (typeof existing.data === 'string' ? JSON.parse(existing.data) : existing.data) as Record<string, ResultEntry>
            : {};
        const key = sectionId ? findingKey(DEFAULT_UNIT, sectionId, itemId) : itemId;
        const entry = data[key] ?? data[itemId] ?? {};
        const photos = Array.isArray(entry.photos) ? entry.photos.slice() : [];
        photos.push({ key: poolRow.r2Key });
        data[key] = { ...entry, photos };
        if (key !== itemId) delete data[itemId]; // migrate on write
        const photoIndex = photos.length - 1;

        if (existing) {
            await db.update(inspectionResults)
                .set({ data: data as unknown as object, lastSyncedAt: new Date() })
                .where(eq(inspectionResults.id, existing.id));
        } else {
            await db.insert(inspectionResults).values({
                id:           crypto.randomUUID(),
                tenantId,
                inspectionId,
                data:         data as unknown as object,
                lastSyncedAt: new Date(),
            });
        }

        await db.delete(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.id, poolId),
                eq(inspectionMediaPool.tenantId, tenantId),
            ));

        return { key: poolRow.r2Key, itemId, photoIndex };
    }

    /**
     * Design System 0520 M14 — PhotoStudio annotation save (subsystem A,
     * phase 4). Server treats `annotations` as opaque text; only enforces
     * the size bound via Zod at the route layer. Caption is user-supplied,
     * displayed in published reports.
     *
     * Returns null when the media row does not belong to the caller's
     * tenant (or the id is unknown) — the route surfaces this as 404 to
     * avoid enumeration leaks.
     */
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
        await this.getInspection(inspectionId, tenantId); // ownership check
        const db = this.getDrizzle();

        const row = await db.select().from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.id, mediaId),
                eq(inspectionMediaPool.inspectionId, inspectionId),
                eq(inspectionMediaPool.tenantId, tenantId),
            ))
            .get();
        if (!row) return null;

        await db.update(inspectionMediaPool)
            .set({ annotations, caption })
            .where(and(
                eq(inspectionMediaPool.id, mediaId),
                eq(inspectionMediaPool.tenantId, tenantId),
            ));

        return {
            id:          mediaId,
            annotations,
            caption,
            updatedAt:   Date.now(),
        };
    }

    /**
     * Design System 0520 subsystem B phase 3 — field-version-aware item patch.
     *
     * Reads inspection_results.data, runs the field through the version-
     * arithmetic helper (decideFieldWrite), persists on match, returns a
     * conflict payload otherwise. Bumps inspections.dataVersion on every
     * successful write so the offline-queue can detect staleness without
     * fetching the full results blob.
     *
     * Tenant isolation enforced via getInspection ownership check before
     * any read/write touches inspection_results.
     */
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
        | { kind: 'queued'; reviewId: string }
    > {
        // Verify ownership — throws if foreign tenant.
        try {
            await this.getInspection(inspectionId, tenantId);
        } catch {
            return { kind: 'not_found' };
        }

        // Design System 0520 subsystem C phase 2 — apprentice write-gating.
        // If the caller is an apprentice AND we're NOT in force mode (mentor
        // approval re-applies values with force: true), route the write into
        // the apprentice_reviews queue instead of mutating inspection_results
        // directly. Mentor decides → ApprenticeService.decide → this method
        // again with { force: true } to land the value.
        //
        // Soft-detect role from the users row. apprentice_reviews table may
        // not exist on standalone profiles that opted out of subsystem C —
        // graceful no-op: any error here falls through to the legacy write
        // path, never blocking a regular inspector save.
        if (!opts?.force) {
            try {
                const u = await this.getDrizzle().select().from(users)
                    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
                    .get();
                if (u?.role === 'apprentice') {
                    const apprenticeSvc = new ApprenticeService(this.db);
                    const queued = await apprenticeSvc.submitForReview(
                        tenantId, userId, inspectionId, itemId, field as 'rating' | 'notes' | 'value', value,
                    );
                    return queued;
                }
            } catch {
                // Table missing, schema mismatch, or apprentice without mentor
                // — fall through to legacy write path. The ApprenticeService
                // itself throws explicitly when a mentor is missing; in that
                // edge case the route surface should surface 400 rather than
                // silently writing as inspector, so re-throw if it's that
                // specific message.
                // (Pragmatic MVP: any error → legacy path. Mentor-missing UX
                // lives at the route layer via a separate guard.)
            }
        }

        const db = this.getDrizzle();

        const existing = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();
        const data: Record<string, Record<string, unknown>> = existing?.data
            ? (typeof existing.data === 'string' ? JSON.parse(existing.data) : existing.data) as Record<string, Record<string, unknown>>
            : {};

        const key = sectionId ? findingKey(DEFAULT_UNIT, sectionId, itemId) : itemId;
        const cur = data[key] ?? data[itemId]; // fallback for legacy

        // Compound writes: defectFields / itemAttribute mutate nested shapes
        // inside the item entry instead of overwriting a single scalar field.
        // We translate them into a normalized entry update on the umbrella
        // sub-key (`tabs` or `attributes`), then let applyFieldWrite handle
        // the version bump on that sub-key so the optimistic-concurrency
        // counter is preserved.
        let mutableField: string = field;
        let mutableValue: unknown = value;
        if (field === 'defectFields' && value && typeof value === 'object' && 'cannedId' in (value as Record<string, unknown>)) {
            const v = value as { cannedId: string; location?: string | null; trade?: string | null; deadline?: string | null; timeframe?: string | null };
            const base = (cur ?? {}) as Record<string, unknown>;
            const tabs = (base.tabs ?? {}) as Record<string, unknown>;
            const defects = Array.isArray(tabs.defects) ? (tabs.defects as Array<Record<string, unknown>>) : [];
            const idx = defects.findIndex(d => d?.cannedId === v.cannedId);
            const next: Record<string, unknown> = idx >= 0 ? { ...defects[idx] } : { cannedId: v.cannedId, included: true };
            if ('location'  in v) next.location  = v.location;
            if ('trade'     in v) next.trade     = v.trade;
            if ('deadline'  in v) next.deadline  = v.deadline;
            if ('timeframe' in v) next.timeframe = v.timeframe;
            const nextDefects = idx >= 0 ? defects.map((d, i) => i === idx ? next : d) : [...defects, next];
            mutableValue = { ...tabs, defects: nextDefects };
            mutableField = 'tabs';
        }
        if (field === 'itemAttribute' && value && typeof value === 'object' && 'attributeId' in (value as Record<string, unknown>)) {
            const v = value as { attributeId: string; value: unknown };
            const base = (cur ?? {}) as Record<string, unknown>;
            const attrs = (base.attributes ?? {}) as Record<string, unknown>;
            const nextAttrs = { ...attrs, [v.attributeId]: v.value };
            mutableField = 'attributes' as typeof field;
            mutableValue = nextAttrs;
        }

        const decision = decideFieldWrite(cur, mutableField, mutableValue, expectedVersion, { force: opts?.force ?? false });
        if (decision.kind === 'conflict') return decision;

        const now = Math.floor(Date.now() / 1000);
        const { entry, newVersion } = applyFieldWrite(cur, mutableField, mutableValue, userId, now);
        data[key] = entry;
        sanitizeDefectStates(data);
        if (key !== itemId) delete data[itemId]; // migrate on write

        if (existing) {
            await db.update(inspectionResults)
                .set({ data: data as unknown as object, lastSyncedAt: new Date() })
                .where(eq(inspectionResults.id, existing.id));
        } else {
            await db.insert(inspectionResults).values({
                id:           crypto.randomUUID(),
                tenantId,
                inspectionId,
                data:         data as unknown as object,
                lastSyncedAt: new Date(),
            });
        }

        // Bump inspections.dataVersion — offline queue uses this counter
        // to detect "the rest of the world moved" without re-fetching the
        // entire results JSON.
        await db.update(inspections)
            .set({ dataVersion: sql`${inspections.dataVersion} + 1` })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));

        return { kind: 'ok', newVersion, by: userId, at: now };
    }

    /**
     * Round-2 backlog #9 — delete a loose pool photo (drag cancel / cleanup).
     * Hard-deletes both the DB row and the R2 object.
     */
    async deletePoolPhoto(
        inspectionId: string,
        tenantId: string,
        poolId: string,
    ): Promise<void> {
        await this.getInspection(inspectionId, tenantId); // ownership check
        const db = this.getDrizzle();

        const row = await db.select().from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.id, poolId),
                eq(inspectionMediaPool.inspectionId, inspectionId),
                eq(inspectionMediaPool.tenantId, tenantId),
            ))
            .get();
        if (!row) throw Errors.NotFound('Pool photo not found');

        await db.delete(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.id, poolId),
                eq(inspectionMediaPool.tenantId, tenantId),
            ));

        if (this.r2) {
            await this.r2.delete(row.r2Key).catch(err => {
                logger.warn('[media-pool] R2 delete failed', { key: row.r2Key, error: String(err) });
            });
        }
    }

    /**
     * Phase T (T11): Saves an annotated composite PNG and Konva node tree for re-editing.
     * Updates inspection_results.data so that data[itemId].photos[photoIndex] gains
     * `annotatedKey` and `annotationsJson` fields. The original photo key is preserved.
     */
    async saveAnnotation(
        inspectionId: string,
        tenantId: string,
        itemId: string,
        photoIndex: number,
        compositeBytes: ArrayBuffer,
        nodesJson: string,
        sectionId?: string,
    ): Promise<{ annotatedKey: string }> {
        if (!this.r2) throw Errors.BadRequest('Storage not available');
        await this.getInspection(inspectionId, tenantId);

        const annotatedKey = `${tenantId}/${inspectionId}/${itemId}_${crypto.randomUUID()}_annotated.png`;
        await this.r2.put(annotatedKey, compositeBytes, {
            httpMetadata: { contentType: 'image/png' }
        });

        const db = this.getDrizzle();
        const [row] = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .limit(1);

        interface ResultEntry {
            rating?: string;
            notes?: string;
            photos?: Array<{ key: string; annotatedKey?: string; annotationsJson?: string }>;
        }
        const data: Record<string, ResultEntry> = (typeof row?.data === 'string'
            ? JSON.parse(row.data)
            : row?.data) ?? {};
        const key = sectionId ? findingKey(DEFAULT_UNIT, sectionId, itemId) : itemId;
        const entry = data[key] ?? data[itemId] ?? {};
        const photos = entry.photos ?? [];
        if (!photos[photoIndex]) throw Errors.NotFound('Photo not found at index');
        photos[photoIndex] = { ...photos[photoIndex], annotatedKey, annotationsJson: nodesJson };
        data[key] = { ...entry, photos };
        if (key !== itemId) delete data[itemId]; // migrate on write

        if (row) {
            await db.update(inspectionResults)
                .set({ data, lastSyncedAt: new Date() })
                .where(eq(inspectionResults.id, row.id));
        } else {
            await db.insert(inspectionResults).values({
                id: crypto.randomUUID(),
                tenantId,
                inspectionId,
                data,
                lastSyncedAt: new Date(),
            });
        }
        return { annotatedKey };
    }

    /**
     * Builds structured report data for a given inspection.
     */
    async getReportData(inspectionId: string, tenantId: string) {
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
        interface PhotoEntry        { key: string; annotatedKey?: string; annotationsJson?: string }
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
                const photos = (res.photos || []).map((p: PhotoEntry) => {
                    const displayKey = p.annotatedKey || p.key;
                    return {
                        key: displayKey,
                        originalKey: p.key,
                        url: `/api/inspections/${inspectionId}/photos/${encodeURIComponent(displayKey)}`,
                    };
                });

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
                        defectPhotos: (st?.photos ?? []).map(p => {
                            const displayKey = p.annotatedKey || p.key;
                            return {
                                key: displayKey,
                                originalKey: p.key,
                                url: `/api/inspections/${inspectionId}/photos/${encodeURIComponent(displayKey)}`,
                            };
                        }),
                        // Sprint 2 S2-3 / S2-4 — per-defect contractor recommendation +
                        // repair estimate range. Null when the inspector left them blank.
                        recommendationId: st?.recommendationId ?? null,
                        estimateLow:      typeof st?.estimateLow  === 'number' ? st.estimateLow  : null,
                        estimateHigh:     typeof st?.estimateHigh === 'number' ? st.estimateHigh : null,
                    };
                });

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
                        defects,
                    },
                };
            }),
        }));

        let inspectorName: string | null = null;
        if (inspection.inspectorId) {
            const inspector = await db.select({ name: users.name, email: users.email })
                .from(users).where(eq(users.id, inspection.inspectorId)).get();
            inspectorName = inspector?.name || (inspector?.email?.split('@')[0] ?? null);
        }

        // Sprint 2 S2-4 — per-tenant flag controls whether the published
        // report renders "Estimated cost: $X – $Y" badges on defect cards.
        let showEstimates = false;
        let reportTheme: 'modern' | 'classic' | 'minimal' = 'modern';
        try {
            const cfg = await db.select({
                showEstimates: tenantConfigs.showEstimates,
                reportTheme:   tenantConfigs.reportTheme,
            })
                .from(tenantConfigs)
                .where(eq(tenantConfigs.tenantId, tenantId))
                .get();
            if (cfg) {
                showEstimates = Boolean(cfg.showEstimates);
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

        return {
            inspection: { ...inspection, inspectorName },
            theme: reportTheme,
            stats: { total: stats.total, satisfactory: stats.satisfactory, monitor: stats.monitor, defect: stats.defect },
            sections,
            ratingLevels: levels.length > 0 ? levels : [
                { id: 'Satisfactory', label: 'Satisfactory', abbreviation: 'SAT', color: '#22c55e', severity: 'good', isDefect: false },
                { id: 'Monitor', label: 'Monitor', abbreviation: 'MON', color: '#f59e0b', severity: 'marginal', isDefect: false },
                { id: 'Defect', label: 'Defect', abbreviation: 'DEF', color: '#f43f5e', severity: 'significant', isDefect: true },
                { id: 'Not Inspected', label: 'Not Inspected', abbreviation: 'NI', color: '#3b82f6', severity: 'minor', isDefect: false },
            ],
            showEstimates,
            propertyFacts,
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
        const report = await this.getReportData(inspectionId, tenantId);

        // Pull custom defects directly from inspection_results since
        // getReportData only resolves the template canned tabs.
        interface CustomDefect {
            id?:        string;
            title?:     string;
            comment?:   string;
            included?:  boolean;
            category?:  'safety' | 'recommendation' | 'maintenance';
            location?:  string | null;
            recommendationId?: string | null;
            estimateLow?:      number | null;
            estimateHigh?:     number | null;
        }
        const resultsRow = await this.getDrizzle()
            .select({ data: inspectionResults.data })
            .from(inspectionResults)
            .where(and(
                eq(inspectionResults.inspectionId, inspectionId),
                eq(inspectionResults.tenantId, tenantId),
            ))
            .get();
        const customByItem = new Map<string, CustomDefect[]>();
        if (resultsRow?.data) {
            const rawData = typeof resultsRow.data === 'string'
                ? JSON.parse(resultsRow.data) as Record<string, unknown>
                : resultsRow.data as Record<string, unknown>;
            for (const key of Object.keys(rawData)) {
                const parsedKey = parseFindingKey(key);
                const entry = rawData[key] as { customComments?: { defects?: CustomDefect[] } } | null;
                const customDefects = entry?.customComments?.defects ?? [];
                if (customDefects.length > 0) customByItem.set(parsedKey.itemId, customDefects);
            }
        }

        // Resolve recommendation slug → label once.
        const labelBySlug = new Map<string, string>(
            RECOMMENDATION_CATEGORIES.map(c => [c.id, c.label]),
        );

        interface RepairListEntry {
            sectionId:           string;
            sectionTitle:        string;
            itemId:              string;
            itemLabel:           string;
            comment:             string;
            location:            string | null;
            category:            'safety' | 'recommendation' | 'maintenance';
            recommendationId:    string | null;
            recommendationLabel: string | null;
            estimateLow:         number | null;
            estimateHigh:        number | null;
            photos:              Array<{ key: string; url: string }>;
            // Source — distinguishes canned (template-driven) vs custom
            // (per-inspection ad-hoc) defects so realtors can see the mix.
            source:              'canned' | 'custom';
        }
        const entries: RepairListEntry[] = [];

        for (const section of report.sections) {
            for (const item of section.items) {
                // Canned defects from the resolved tabs.
                const cannedDefects = item.resolvedTabs?.defects ?? [];
                for (const d of cannedDefects) {
                    if (!d.included) continue;
                    const cat = (d.effectiveCategory ?? 'maintenance') as RepairListEntry['category'];
                    const slug = d.recommendationId ?? null;
                    entries.push({
                        sectionId:    section.id,
                        sectionTitle: section.title,
                        itemId:       item.id,
                        itemLabel:    item.label,
                        comment:      d.effectiveComment ?? '',
                        location:     (typeof d.effectiveLocation === 'string' && d.effectiveLocation.length > 0)
                            ? d.effectiveLocation
                            : null,
                        category:            cat,
                        recommendationId:    slug,
                        recommendationLabel: slug ? (labelBySlug.get(slug) ?? slug) : null,
                        estimateLow:         d.estimateLow ?? null,
                        estimateHigh:        d.estimateHigh ?? null,
                        photos:              (d.defectPhotos ?? []).map(p => ({ key: p.key, url: p.url })),
                        source:              'canned',
                    });
                }
                // Custom defects (ad-hoc additions by the inspector).
                const customs = customByItem.get(item.id) ?? [];
                for (const c of customs) {
                    if (c.included === false) continue;
                    const cat = (c.category ?? 'maintenance') as RepairListEntry['category'];
                    const slug = c.recommendationId ?? null;
                    entries.push({
                        sectionId:    section.id,
                        sectionTitle: section.title,
                        itemId:       item.id,
                        itemLabel:    c.title || item.label,
                        comment:      c.comment ?? '',
                        location:     (typeof c.location === 'string' && c.location.length > 0)
                            ? c.location
                            : null,
                        category:            cat,
                        recommendationId:    slug,
                        recommendationLabel: slug ? (labelBySlug.get(slug) ?? slug) : null,
                        estimateLow:         c.estimateLow ?? null,
                        estimateHigh:        c.estimateHigh ?? null,
                        // Custom defect photos are not currently aggregated by
                        // getReportData — the canned defect photo path stays
                        // authoritative for now. A future iteration may pull
                        // custom defect photos straight off the JSON payload.
                        photos:              [],
                        source:              'custom',
                    });
                }
            }
        }

        const totals = entries.reduce(
            (acc, e) => {
                acc.count++;
                acc[e.category]++;
                if (typeof e.estimateLow  === 'number') acc.estimateLowSum  += e.estimateLow;
                if (typeof e.estimateHigh === 'number') acc.estimateHighSum += e.estimateHigh;
                return acc;
            },
            { count: 0, safety: 0, recommendation: 0, maintenance: 0, estimateLowSum: 0, estimateHighSum: 0 },
        );

        return {
            inspection: {
                id:              report.inspection.id as string,
                propertyAddress: report.inspection.propertyAddress as string,
                date:            report.inspection.date as string | null,
                inspectorName:   report.inspection.inspectorName,
            },
            defects: entries,
            totals,
            showEstimates: report.showEstimates,
        };
    }

    /**
     * Returns tab counts for the inspection list UI.
     * Single query with 6 conditional aggregates to avoid N+1.
     */
    async getCounts(tenantId: string): Promise<{
        all: number; today: number; upcoming: number;
        past: number; unconfirmed: number; inProgress: number;
    }> {
        const db = this.getDrizzle();
        const todayStr = new Date().toISOString().slice(0, 10);
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const result = await db.select({
            all:         sql<number>`count(*)`,
            today:       sql<number>`sum(case when date(${inspections.date}) = ${todayStr} then 1 else 0 end)`,
            upcoming:    sql<number>`sum(case when ${inspections.date} > ${todayStr} and ${inspections.status} not in ('completed','cancelled') then 1 else 0 end)`,
            past:        sql<number>`sum(case when ${inspections.date} < ${todayStr} or ${inspections.status} in ('completed','cancelled') then 1 else 0 end)`,
            unconfirmed: sql<number>`sum(case when ${inspections.status} = 'scheduled' and ${inspections.createdAt} < ${cutoff} then 1 else 0 end)`,
            inProgress:  sql<number>`sum(case when ${inspections.status} = 'in_progress' then 1 else 0 end)`,
        }).from(inspections).where(eq(inspections.tenantId, tenantId));

        const row = result[0] ?? {};
        return {
            all:         Number(row.all ?? 0),
            today:       Number(row.today ?? 0),
            upcoming:    Number(row.upcoming ?? 0),
            past:        Number(row.past ?? 0),
            unconfirmed: Number(row.unconfirmed ?? 0),
            inProgress:  Number(row.inProgress ?? 0),
        };
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
        if (inspection.status === 'delivered') throw Errors.BadRequest('Inspection is already published');

        await db.update(inspections)
            .set({ status: 'delivered' })
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

        const tenantRow = await db.select({ subdomain: tenants.subdomain })
            .from(tenants).where(eq(tenants.id, tenantId)).get();
        const tenantSlug = tenantRow?.subdomain ?? '';
        return {
            reportUrl: `/report/${tenantSlug}/${inspectionId}`,
            status: 'delivered',
        };
    }

    /**
     * Fetches an inspection row by id+tenantId, throwing NotFound if missing.
     */
    private async fetchForStatusChange(tenantId: string, id: string) {
        const db = this.getDrizzle();
        const rows = await db.select().from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId))).limit(1);
        if (!rows[0]) throw Errors.NotFound('Inspection not found');
        return { db, inspection: rows[0] };
    }

    async confirmInspection(tenantId: string, id: string): Promise<void> {
        const { db, inspection } = await this.fetchForStatusChange(tenantId, id);
        if (inspection.status === 'cancelled') throw Errors.BadRequest('Cannot confirm a cancelled inspection');
        await db.update(inspections).set({
            status:      'confirmed',
            confirmedAt: new Date().toISOString(),
        }).where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));
        await fireAutomation(this.db, tenantId, id, 'inspection.confirmed');
    }

    async cancelInspection(tenantId: string, id: string, reason: string, notes?: string): Promise<void> {
        const { db } = await this.fetchForStatusChange(tenantId, id);
        await db.update(inspections).set({
            status:       'cancelled',
            cancelReason: reason,
            cancelNotes:  notes ?? null,
        }).where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));
        await fireAutomation(this.db, tenantId, id, 'inspection.cancelled');
    }

    async uncancelInspection(tenantId: string, id: string): Promise<void> {
        const { db, inspection } = await this.fetchForStatusChange(tenantId, id);
        if (inspection.status !== 'cancelled') throw Errors.BadRequest('Inspection is not cancelled');
        await db.update(inspections).set({
            status:       'scheduled',
            cancelReason: null,
            cancelNotes:  null,
        }).where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));
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
        const stats = { safety: 0, recommendation: 0, maintenance: 0 };
        try {
            const report = await this.getReportData(inspectionId, tenantId);
            for (const sec of report.sections) {
                for (const item of sec.items) {
                    const tab = item.resolvedTabs?.defects ?? [];
                    for (const d of tab) {
                        if (!d.included) continue;
                        const cat = (d.effectiveCategory ?? 'maintenance') as keyof typeof stats;
                        if (cat in stats) stats[cat]++;
                    }
                }
            }
            // Custom defects live on results[itemId].customComments.defects
            // — getReportData doesn't surface them, so pull them straight
            // from inspection_results.
            const resultsRow = await this.getDrizzle().select().from(inspectionResults)
                .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
                .get();
            if (resultsRow?.data) {
                interface CustomDefect { included?: boolean; category?: 'safety' | 'recommendation' | 'maintenance' }
                const data: Record<string, { customComments?: { defects?: CustomDefect[] } }> = typeof resultsRow.data === 'string'
                    ? JSON.parse(resultsRow.data)
                    : resultsRow.data as Record<string, { customComments?: { defects?: CustomDefect[] } }>;
                for (const key of Object.keys(data)) {
                    const customDefects = data[key]?.customComments?.defects ?? [];
                    for (const d of customDefects) {
                        if (d.included === false) continue;
                        const cat = (d.category ?? 'maintenance');
                        if (cat in stats) stats[cat as keyof typeof stats]++;
                    }
                }
            }
        } catch {
            // Inspection lookup may fail (deleted between bucket load + stats
            // call) — return zero counts rather than crashing the dashboard.
        }
        return stats;
    }

    /**
     * Spec 5B P2B — Batch defect stats for many inspections at once.
     *
     * Single SQL fetch of all inspection_results rows for the given IDs,
     * then in-memory aggregation. Avoids N+1 round trips when the
     * dashboard renders 50+ cards. Returns a Map keyed by inspection id.
     */
    async getDefectStatsBatch(tenantId: string, inspectionIds: string[]): Promise<Map<string, { safety: number; recommendation: number; maintenance: number }>> {
        const out = new Map<string, { safety: number; recommendation: number; maintenance: number }>();
        if (inspectionIds.length === 0) return out;

        const db = this.getDrizzle();
        // Pull both result rows and template snapshots in parallel.
        const insRows = await db.select({
            id:               inspections.id,
            templateSnapshot: inspections.templateSnapshot,
        }).from(inspections)
          .where(and(eq(inspections.tenantId, tenantId), inArray(inspections.id, inspectionIds)));
        const resultRows = await db.select({
            inspectionId: inspectionResults.inspectionId,
            data:         inspectionResults.data,
        }).from(inspectionResults)
          .where(and(eq(inspectionResults.tenantId, tenantId), inArray(inspectionResults.inspectionId, inspectionIds)));

        const tplById   = new Map<string, unknown>();
        for (const r of insRows) tplById.set(r.id as string, r.templateSnapshot);
        const dataById  = new Map<string, unknown>();
        for (const r of resultRows) dataById.set(r.inspectionId as string, r.data);

        interface CannedDefect { id: string; category: 'safety' | 'recommendation' | 'maintenance'; default: boolean }
        interface DefectState  { cannedId: string; included?: boolean; category?: 'safety' | 'recommendation' | 'maintenance' }
        interface CustomDefect { included?: boolean; category?: 'safety' | 'recommendation' | 'maintenance' }

        for (const id of inspectionIds) {
            const stats = { safety: 0, recommendation: 0, maintenance: 0 };
            const rawTpl = tplById.get(id);
            const tpl = rawTpl ? (typeof rawTpl === 'string' ? JSON.parse(rawTpl) : rawTpl) : null;
            const rawData = dataById.get(id);
            const data: Record<string, { tabs?: { defects?: DefectState[] }; customComments?: { defects?: CustomDefect[] } }> =
                rawData ? (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) : {};

            // Walk template canned defects, applying state overrides.
            if (tpl && Array.isArray((tpl as { sections?: unknown }).sections)) {
                const sections = (tpl as { sections: Array<{ items?: Array<{ id: string; tabs?: { defects?: CannedDefect[] } }> }> }).sections;
                for (const sec of sections) {
                    for (const item of (sec.items ?? [])) {
                        const canned = item.tabs?.defects ?? [];
                        const stateMap = new Map<string, DefectState>();
                        for (const s of (data[item.id]?.tabs?.defects ?? [])) stateMap.set(s.cannedId, s);
                        for (const c of canned) {
                            const st = stateMap.get(c.id);
                            const included = st ? !!st.included : !!c.default;
                            if (!included) continue;
                            const cat = (st?.category ?? c.category ?? 'maintenance') as keyof typeof stats;
                            if (cat in stats) stats[cat]++;
                        }
                    }
                }
            }
            // Custom defects (per-inspection additions).
            for (const itemId of Object.keys(data)) {
                const customDefects = data[itemId]?.customComments?.defects ?? [];
                for (const d of customDefects) {
                    if (d.included === false) continue;
                    const cat = (d.category ?? 'maintenance') as keyof typeof stats;
                    if (cat in stats) stats[cat]++;
                }
            }
            out.set(id, stats);
        }
        return out;
    }

    /**
     * Returns bucketed inspection lists for the dashboard view.
     * All filtering is done in-process from a single tenant query.
     * Note: uses the `date` column (TEXT "YYYY-MM-DD") for scheduling logic.
     */
    async getDashboardBuckets(tenantId: string) {
        const db  = this.getDrizzle();
        const all = await db.select().from(inspections)
            .where(eq(inspections.tenantId, tenantId));

        // handoff-decisions §1 — pull the configurable report-unpublished
        // threshold. Falls back to 24h when the row is missing (legacy tenants
        // pre-migration 0040). 72h is the new default applied at insert time.
        const cfg = await db.select({ thresholds: tenantConfigs.attentionThresholds })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .limit(1);
        const thresholds = cfg[0]?.thresholds ?? null;
        const reportUnpublishedH  = thresholds?.report_unpublished_h ?? 24;
        const agreementUnsignedH  = thresholds?.agreement_unsigned_h ?? 72;
        const invoiceOverdueH     = thresholds?.invoice_overdue_h    ?? 72;

        const now           = Date.now();
        // Use UTC boundaries to match the `date` column which stores "YYYY-MM-DD" (UTC midnight when parsed).
        const startOfToday  = new Date(); startOfToday.setUTCHours(0, 0, 0, 0);
        const endOfToday    = new Date(); endOfToday.setUTCHours(23, 59, 59, 999);
        const in48h         = new Date(now + 48 * 3600 * 1000);
        const in7days       = new Date(now + 7 * 86400 * 1000);
        const minus30days   = new Date(now - 30 * 86400 * 1000);
        const reportStaleAt    = new Date(now - reportUnpublishedH * 3600 * 1000);
        const agreementStaleAt = new Date(now - agreementUnsignedH * 3600 * 1000);
        const invoiceStaleAt   = new Date(now - invoiceOverdueH    * 3600 * 1000);

        // handoff §1 — extra signals for needsAttention bucket.
        // 1) Inspections with NO signed agreement record older than threshold.
        const signedRows = await db.select({ inspectionId: inspectionAgreements.inspectionId })
            .from(inspectionAgreements)
            .where(eq(inspectionAgreements.tenantId, tenantId));
        const signedSet = new Set(signedRows.map(r => r.inspectionId as string));
        // 2) Unpaid invoices with dueDate past invoice-overdue threshold.
        const overdueInvoices = await db.select({ inspectionId: invoices.inspectionId, dueDate: invoices.dueDate })
            .from(invoices)
            .where(and(eq(invoices.tenantId, tenantId), sql`${invoices.paidAt} IS NULL`));
        const overdueSet = new Set(
            overdueInvoices
                .filter(r => {
                    if (!r.dueDate || !r.inspectionId) return false;
                    return new Date(r.dueDate as string) <= invoiceStaleAt;
                })
                .map(r => r.inspectionId as string)
        );

        // Parse the text `date` column ("YYYY-MM-DD") to a Date at midnight UTC.
        const insDate = (i: typeof inspections.$inferSelect) =>
            i.date ? new Date(i.date) : null;

        const isToday = (i: typeof inspections.$inferSelect) => {
            const d = insDate(i);
            return d !== null && d >= startOfToday && d <= endOfToday;
        };

        // Needs attention (handoff §1):
        //  - scheduled within 48h, OR
        //  - in_progress past the report-unpublished threshold, OR
        //  - active inspection with no signed agreement past the agreement threshold, OR
        //  - active inspection with an overdue invoice past the invoice threshold.
        const needsAttention = all.filter(i => {
            const d = insDate(i);
            if (i.status === 'scheduled' && d && d <= in48h) return true;
            if (i.status === 'in_progress' && d && d <= reportStaleAt) return true;
            if (i.status !== 'cancelled' && new Date(i.createdAt) <= agreementStaleAt && !signedSet.has(i.id as string)) return true;
            if (i.status !== 'cancelled' && overdueSet.has(i.id as string)) return true;
            return false;
        });

        const today = all.filter(i => isToday(i) && i.status !== 'cancelled');

        const thisWeek = all.filter(i => {
            const d = insDate(i);
            return d !== null && d > endOfToday && d <= in7days && i.status !== 'cancelled';
        });

        const laterAll = all.filter(i => {
            const d = insDate(i);
            return d !== null && d > in7days && i.status !== 'cancelled';
        });
        const later      = laterAll.slice(0, 50);
        const laterTotal = laterAll.length;

        const recentReports = all.filter(i => i.status === 'completed' || i.status === 'delivered');

        // Cancelled within last 30 days (no updatedAt on inspections — use createdAt as fallback proxy).
        const cancelled = all.filter(i =>
            i.status === 'cancelled' && new Date(i.createdAt) >= minus30days
        ).slice(0, 20);

        // Spec 5B P2B — annotate every surfaced inspection with defect counts
        // so the dashboard cards can render colored chips. Only fetch stats
        // for the IDs that actually appear in the rendered buckets to keep
        // the query small.
        const allBucketIds = [
            ...needsAttention, ...today, ...thisWeek, ...later, ...recentReports, ...cancelled,
        ].map(i => i.id as string);
        const uniqueIds = Array.from(new Set(allBucketIds));
        const statsMap = await this.getDefectStatsBatch(tenantId, uniqueIds);

        // Sub-spec B Task 7 (B-6) — list row metadata: agent name lookup +
        // status flags + invoice paid lookup. We surface:
        //   agentName  → from contacts (sellingAgentId or referredByAgentId)
        //   statusFlags = { reportPublished, agreementSigned, paid, flagged, canceled }
        const agentIdSet = new Set<string>();
        for (const i of all) {
            if (i.sellingAgentId)    agentIdSet.add(i.sellingAgentId as string);
            if (i.referredByAgentId) agentIdSet.add(i.referredByAgentId as string);
        }
        const agentNameMap = new Map<string, string>();
        if (agentIdSet.size > 0) {
            const agentRows = await db.select({ id: contacts.id, name: contacts.name })
                .from(contacts)
                .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, Array.from(agentIdSet))));
            for (const r of agentRows) agentNameMap.set(r.id as string, r.name as string);
        }
        // Paid invoice lookup — any inspection with at least one paid invoice
        // counts as paid in the row indicator.
        const paidIdSet = new Set<string>();
        const paidRows = await db.select({ inspectionId: invoices.inspectionId })
            .from(invoices)
            .where(and(eq(invoices.tenantId, tenantId), sql`${invoices.paidAt} IS NOT NULL`));
        for (const r of paidRows) {
            if (r.inspectionId) paidIdSet.add(r.inspectionId as string);
        }

        // Round-2 backlog #2 — Inspector name lookup so the "Inspector" column
        // (Customize Columns) can render the assigned inspector without a
        // second round-trip. Self-assigned (inspectorId NULL) renders blank.
        const inspectorIdSet = new Set<string>();
        for (const i of all) {
            if (i.inspectorId) inspectorIdSet.add(i.inspectorId as string);
        }
        const inspectorNameMap = new Map<string, string>();
        if (inspectorIdSet.size > 0) {
            const insRows = await db
                .select({ id: users.id, name: users.name, email: users.email })
                .from(users)
                .where(and(eq(users.tenantId, tenantId), inArray(users.id, Array.from(inspectorIdSet))));
            for (const r of insRows) {
                const nice = (r.name as string | null)
                    || ((r.email as string | null)?.split('@')[0] ?? '')
                    || '';
                if (nice) inspectorNameMap.set(r.id as string, nice);
            }
        }

        // Sprint 2 S2-2 — count sibling inspections per request_id so list rows
        // can show a "(2 inspections)" hint when the inspection belongs to a
        // multi-service booking. Built once for the entire bucket sweep.
        const requestSiblingCounts = new Map<string, number>();
        for (const i of all) {
            const rid = (i as typeof inspections.$inferSelect).requestId;
            if (rid) requestSiblingCounts.set(rid, (requestSiblingCounts.get(rid) ?? 0) + 1);
        }

        const decorate = <T extends { id: unknown; status?: unknown; sellingAgentId?: unknown; referredByAgentId?: unknown; inspectorId?: unknown; price?: unknown; requestId?: unknown }>(rows: T[]): Array<T & {
            defectStats:    { safety: number; recommendation: number; maintenance: number };
            agentName?:     string;
            inspectorName?: string;
            statusFlags:    { reportPublished: boolean; reportReady: boolean; agreementSigned: boolean; paid: boolean; sent: boolean; flagged: boolean; canceled: boolean };
            requestId?:     string;
            siblingCount?:  number;
        }> =>
            rows.map(r => {
                const id = r.id as string;
                const sellingId    = r.sellingAgentId as string | null;
                const referredById = r.referredByAgentId as string | null;
                const agentName = (sellingId && agentNameMap.get(sellingId)) || (referredById && agentNameMap.get(referredById)) || undefined;
                const reqId = (r as { requestId?: unknown }).requestId as string | null | undefined;
                const siblingCount = reqId ? (requestSiblingCounts.get(reqId) ?? 1) : 1;
                const inspectorId = r.inspectorId as string | null;
                const inspectorName = inspectorId ? inspectorNameMap.get(inspectorId) : undefined;
                // Round-2 F2 — split "report ready" (built/completed) from "sent"
                // (delivered = publish workflow completed). Older clients still
                // see `reportPublished` (alias of reportReady) for backward-
                // compat; new dashboard JSX reads `sent` for the ✈️ icon.
                const reportReady = r.status === 'completed' || r.status === 'delivered';
                const sent        = r.status === 'delivered';
                return {
                    ...r,
                    defectStats: statsMap.get(id) ?? { safety: 0, recommendation: 0, maintenance: 0 },
                    ...(agentName ? { agentName } : {}),
                    ...(inspectorName ? { inspectorName } : {}),
                    statusFlags: {
                        reportPublished: reportReady,
                        reportReady,
                        agreementSigned: signedSet.has(id),
                        paid:            paidIdSet.has(id),
                        sent,
                        flagged:         overdueSet.has(id),
                        canceled:        r.status === 'cancelled',
                    },
                    ...(reqId ? { requestId: reqId, siblingCount } : {}),
                };
            });

        // Sub-spec B Task 5 (B-4) — portfolio defect aggregation per top card.
        // Sums per-bucket safety / recommendation / maintenance counts so the
        // top 4 dashboard cards can render colored chips alongside the count.
        const aggregate = (rows: Array<{ id: unknown }>): { safety: number; recommendation: number; maintenance: number } =>
            rows.reduce((acc, r) => {
                const s = statsMap.get(r.id as string) ?? { safety: 0, recommendation: 0, maintenance: 0 };
                acc.safety         += s.safety;
                acc.recommendation += s.recommendation;
                acc.maintenance    += s.maintenance;
                return acc;
            }, { safety: 0, recommendation: 0, maintenance: 0 });

        const defectAggregate = {
            // Maps to the 4 top cards on /dashboard.
            //   later          → "Upcoming"
            //   thisWeek       → "In Progress"
            //   needsAttention → "Needs Attention"
            //   recentReports  → "Recent Reports"
            later:          aggregate(later),
            thisWeek:       aggregate(thisWeek),
            needsAttention: aggregate(needsAttention),
            recentReports:  aggregate(recentReports),
        };

        return {
            needsAttention: decorate(needsAttention),
            today:          decorate(today),
            thisWeek:       decorate(thisWeek),
            later:          decorate(later),
            laterTotal,
            recentReports:  decorate(recentReports),
            cancelled:      decorate(cancelled),
            defectAggregate,
        };
    }

    /**
     * Generates a 30-day shareable agent view token stored in KV.
     * The token grants read-only access to the report without requiring login.
     */
    async generateAgentViewToken(tenantId: string, inspectionId: string): Promise<string> {
        const db = this.getDrizzle();
        const rows = await db.select({ id: inspections.id })
            .from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .limit(1);
        if (!rows[0]) throw Errors.NotFound('Inspection not found');
        if (!this.kv) throw Errors.Internal('KV not available');

        const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
        await this.kv.put(`agent_view_token:${token}`, `${inspectionId}:${tenantId}`, {
            expirationTtl: 30 * 24 * 60 * 60,
        });
        return token;
    }

    /**
     * Resolves an agent view token from KV.
     */
    async resolveAgentViewToken(token: string): Promise<{ inspectionId: string; tenantId: string } | null> {
        if (!this.kv) return null;
        const val = await this.kv.get(`agent_view_token:${token}`);
        if (!val) return null;
        const [inspectionId, tenantId] = val.split(':');
        return { inspectionId, tenantId };
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

        return computePublishReadinessFromState(schemaData, resultData);
    }
}

// -----------------------------------------------------------------------
// Sprint 1 Sub-spec A Task 5 — ITEM-aware Quick Comments ranking helper.
//
// Scores a list of canned comments against the active item label so that
// the QUICK COMMENTS panel surfaces the most relevant entries first.
// Pure function (no DB) — exported for unit-test isolation; the API caller
// is expected to fetch the section's comments first, then rank in memory.
// -----------------------------------------------------------------------

export type CannedRatingBucket = 'satisfactory' | 'monitor' | 'defect' | null;

export interface CannedCommentLike {
    id:            string;
    text:          string;
    section?:      string | null;
    category?:     string | null;
    ratingBucket?: CannedRatingBucket;
}

export interface RankCommentsOpts {
    section:    string;
    itemLabel:  string;
    rating?:    'satisfactory' | 'monitor' | 'defect';
    limit?:     number;
}

function tokenize(input: string): string[] {
    return (input || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter(t => t.length >= 3);
}

function scoreCanned(c: CannedCommentLike, opts: RankCommentsOpts): number {
    const lcItem = (opts.itemLabel || '').toLowerCase().trim();
    const itemTokens = tokenize(opts.itemLabel);
    const lcCategory = (c.category || '').toLowerCase();
    const lcText = (c.text || '').toLowerCase();
    const lcSection = (c.section || '').toLowerCase();

    let s = 0;
    // Strongest signal: category exactly matches the item label.
    if (lcCategory && lcCategory === lcItem) s += 100;
    // Substring overlap (either direction) — handles "Gutters" vs "Gutters & Downspouts".
    else if (lcCategory && (lcCategory.includes(lcItem) || lcItem.includes(lcCategory))) s += 60;
    // Comment text contains all item tokens (length >= 3 each).
    if (itemTokens.length > 0) {
        const hits = itemTokens.filter(t => lcText.includes(t) || lcCategory.includes(t)).length;
        if (hits === itemTokens.length) s += 40;
        else if (hits > 0) s += 20 * (hits / itemTokens.length);
    }
    // Section match.
    if (lcSection && lcSection === opts.section.toLowerCase()) s += 10;
    // Rating-bucket boost when caller knows the active item's rating.
    if (opts.rating && c.ratingBucket === opts.rating) s += 5;
    return s;
}

export function rankCannedCommentsForItem<T extends CannedCommentLike>(
    comments: T[],
    opts: RankCommentsOpts,
): T[] {
    if (!Array.isArray(comments) || comments.length === 0) return [];
    const scored = comments.map((c, idx) => ({ c, s: scoreCanned(c, opts), idx }));
    // Stable sort: higher score first, then preserve original order for ties.
    scored.sort((a, b) => (b.s - a.s) || (a.idx - b.idx));
    const out = scored.map(x => x.c);
    return typeof opts.limit === 'number' ? out.slice(0, opts.limit) : out;
}
