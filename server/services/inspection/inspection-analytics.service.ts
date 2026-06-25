import { eq, and, sql, inArray, isNull } from 'drizzle-orm';
import { inspections, inspectionResults, tenantConfigs, invoices, agreementRequests, users } from '../../lib/db/schema';
import { contacts } from '../../lib/db/schema/contact';
import { parseFindingKey } from '../../lib/finding-key';
import { RECOMMENDATION_CATEGORIES } from '../../lib/recommendation-categories';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import { REPORT_STATUS, isReportPublished } from '../../lib/status/report-status';
import { InspectionSubService } from './base';
import type { InspectionService } from '../inspection.service';

type DefectCategory = 'safety' | 'recommendation' | 'maintenance';
type DefectCounts = Record<DefectCategory, number>;

/** A fresh all-zero defect tally. Each call returns a new object so callers
 *  can mutate it without sharing state. */
function zeroCounts(): DefectCounts {
    return { safety: 0, recommendation: 0, maintenance: 0 };
}

/** Tally per-inspection custom defects (results[itemId].customComments.defects)
 *  into an existing stats bucket. Skips explicitly-excluded rows; unknown
 *  categories fall back to "maintenance". Mutates and returns `stats`. */
function countCustomDefects(
    data: Record<string, { customComments?: { defects?: Array<{ included?: boolean; category?: DefectCategory }> } }>,
    stats: DefectCounts,
): DefectCounts {
    for (const key of Object.keys(data)) {
        for (const d of (data[key]?.customComments?.defects ?? [])) {
            if (d.included === false) continue;
            const cat = d.category ?? 'maintenance';
            if (cat in stats) stats[cat]++;
        }
    }
    return stats;
}

/**
 * Dashboard + report analytics aggregation. Defect stats, repair list,
 * counts, dashboard buckets, observer progress. Extracted verbatim from
 * InspectionService. Methods that need the full resolved report call back
 * through the facade's getReportData (cross-service dependency made explicit).
 */
export class InspectionAnalyticsService extends InspectionSubService {
    constructor(
        db: D1Database,
        r2: R2Bucket | undefined,
        sdb: import('../../lib/db/scoped').ScopedDB | undefined,
        kv: KVNamespace | undefined,
        images: import('../../lib/media/strip-exif').ImagesBinding | undefined,
        private facade: InspectionService,
    ) {
        super(db, r2, sdb, kv, images);
    }

    /**
     * C-10 ③-A.4 — live progress for the public observer view
     * (`/observe/inspections/:id`). Derives per-section completion from the same
     * resolved report shape getReportData builds, so the section/item structure
     * (templateSnapshot-aware) stays in one place. An item counts as "done" once
     * the inspector has captured a rating (rich items) or a value (data points).
     */
    async getObserveProgress(inspectionId: string, tenantId: string) {
        const report = await this.facade.getReportData(inspectionId, tenantId);
        const insp = report.inspection;
        return {
            address: insp.propertyAddress,
            date: insp.date ?? null,
            inspectorName: insp.inspectorName ?? '',
            status: insp.status,
            sections: report.sections.map((s) => ({
                name: s.title,
                totalItems: s.items.length,
                completedItems: s.items.filter(
                    (it) => it.rating != null || (it as { value?: unknown }).value != null,
                ).length,
            })),
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
        const report = await this.facade.getReportData(inspectionId, tenantId);

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
                // Canned defects from the resolved tabs. FE-3: the resolved
                // list now also carries custom rows (isCustom) — skip them
                // here, the dedicated custom pass below already emits them
                // (with their richer per-row fields).
                const cannedDefects = item.resolvedTabs?.defects ?? [];
                for (const d of cannedDefects) {
                    if (!d.included || ('isCustom' in d && d.isCustom)) continue;
                    if (!('recommendationId' in d)) continue; // type guard: canned shape only
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
            unconfirmed: sql<number>`sum(case when ${inspections.status} = 'requested' and ${inspections.createdAt} < ${cutoff} then 1 else 0 end)`,
            inProgress:  sql<number>`sum(case when ${inspections.status} = 'completed' and ${inspections.reportStatus} = 'in_progress' then 1 else 0 end)`,
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
     * Spec 5B P2B — Compute defect category counts for a single inspection.
     *
     * Walks the resolved v2 tabs (template canned defects + per-inspection
     * custom defects) and returns counts of `included` defects bucketed by
     * category. Used by the inspection list / dashboard cards. Returns
     * zeros when the inspection has no template / no results.
     */
    async getDefectStats(inspectionId: string, tenantId: string): Promise<DefectCounts> {
        const stats = zeroCounts();
        try {
            const report = await this.facade.getReportData(inspectionId, tenantId);
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
                const data = (typeof resultsRow.data === 'string' ? JSON.parse(resultsRow.data) : resultsRow.data) as
                    Record<string, { customComments?: { defects?: Array<{ included?: boolean; category?: DefectCategory }> } }>;
                countCustomDefects(data, stats);
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
    async getDefectStatsBatch(tenantId: string, inspectionIds: string[]): Promise<Map<string, DefectCounts>> {
        const out = new Map<string, DefectCounts>();
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

        interface CannedDefect { id: string; category: DefectCategory; default: boolean }
        interface DefectState  { cannedId: string; included?: boolean; category?: DefectCategory }
        interface CustomDefect { included?: boolean; category?: DefectCategory }

        for (const id of inspectionIds) {
            const stats = zeroCounts();
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
            countCustomDefects(data, stats);
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
        // created before the threshold default existed). 72h is the new default applied at insert time.
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
        // Track I-a — agreement-signed truth rides the envelope: a signed
        // agreement_requests row (any channel) lights the dashboard 📋 icon.
        const signedRows = await db.select({ inspectionId: agreementRequests.inspectionId })
            .from(agreementRequests)
            .where(and(eq(agreementRequests.tenantId, tenantId), eq(agreementRequests.status, 'signed')));
        const signedSet = new Set(signedRows.map(r => r.inspectionId as string));
        // 2) Unpaid invoices with dueDate past invoice-overdue threshold.
        const overdueInvoices = await db.select({ inspectionId: invoices.inspectionId, dueDate: invoices.dueDate })
            .from(invoices)
            .where(and(eq(invoices.tenantId, tenantId), sql`${invoices.paidAt} IS NULL`, isNull(invoices.voidedAt)));
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
            if (i.status === INSPECTION_STATUS.SCHEDULED && d && d <= in48h) return true;
            // Report not yet published past threshold (completed but reportStatus still in_progress/submitted)
            if (i.status === INSPECTION_STATUS.COMPLETED && !isReportPublished(i.reportStatus) && new Date(i.createdAt) <= reportStaleAt) return true;
            // Submitted reports awaiting manager review
            if (i.reportStatus === REPORT_STATUS.SUBMITTED) return true;
            if (i.status !== INSPECTION_STATUS.CANCELLED && new Date(i.createdAt) <= agreementStaleAt && !signedSet.has(i.id as string)) return true;
            if (i.status !== INSPECTION_STATUS.CANCELLED && overdueSet.has(i.id as string)) return true;
            return false;
        });

        const today = all.filter(i => isToday(i) && i.status !== INSPECTION_STATUS.CANCELLED);

        const thisWeek = all.filter(i => {
            const d = insDate(i);
            return d !== null && d > endOfToday && d <= in7days && i.status !== INSPECTION_STATUS.CANCELLED;
        });

        const laterAll = all.filter(i => {
            const d = insDate(i);
            return d !== null && d > in7days && i.status !== INSPECTION_STATUS.CANCELLED;
        });
        const later      = laterAll.slice(0, 50);
        const laterTotal = laterAll.length;

        const recentReports = all.filter(i =>
            i.status === INSPECTION_STATUS.COMPLETED && isReportPublished(i.reportStatus)
        );

        // Cancelled within last 30 days (no updatedAt on inspections — use createdAt as fallback proxy).
        const cancelled = all.filter(i =>
            i.status === INSPECTION_STATUS.CANCELLED && new Date(i.createdAt) >= minus30days
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
            .where(and(eq(invoices.tenantId, tenantId), sql`${invoices.paidAt} IS NOT NULL`, isNull(invoices.voidedAt)));
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
            defectStats:    DefectCounts;
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
                // (published = publish workflow completed). reportPublished is the
                // canonical flag; sent is an alias for the ✈️ icon on the dashboard.
                const reportReady = r.status === INSPECTION_STATUS.COMPLETED;
                const sent        = isReportPublished((r as { reportStatus?: unknown }).reportStatus);
                return {
                    ...r,
                    defectStats: statsMap.get(id) ?? zeroCounts(),
                    ...(agentName ? { agentName } : {}),
                    ...(inspectorName ? { inspectorName } : {}),
                    statusFlags: {
                        reportPublished: reportReady,
                        reportReady,
                        agreementSigned: signedSet.has(id),
                        paid:            paidIdSet.has(id),
                        sent,
                        flagged:         overdueSet.has(id),
                        canceled:        r.status === INSPECTION_STATUS.CANCELLED,
                    },
                    ...(reqId ? { requestId: reqId, siblingCount } : {}),
                };
            });

        // Sub-spec B Task 5 (B-4) — portfolio defect aggregation per top card.
        // Sums per-bucket safety / recommendation / maintenance counts so the
        // top 4 dashboard cards can render colored chips alongside the count.
        const aggregate = (rows: Array<{ id: unknown }>): DefectCounts =>
            rows.reduce((acc, r) => {
                const s = statsMap.get(r.id as string) ?? zeroCounts();
                acc.safety         += s.safety;
                acc.recommendation += s.recommendation;
                acc.maintenance    += s.maintenance;
                return acc;
            }, zeroCounts());

        const defectAggregate = {
            // Maps to the 4 top cards on /inspections.
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
}
