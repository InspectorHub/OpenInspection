import { eq, and, sql, inArray } from 'drizzle-orm';
import { inspections, inspectionResults, users, inspectionPeople, contactRoleProfiles } from '../../lib/db/schema';
import { contacts } from '../../lib/db/schema/contact';
import { parseFindingKey } from '../../lib/finding-key';
import { getEffectivePriceCents } from '../../lib/effective-price';
import { RECOMMENDATION_CATEGORY_LABELS } from '../../lib/recommendation-categories';
import { DEFECT_TRADE_LABELS, isDefectTrade } from '../../types/defect-fields';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import { REPORT_STATUS, isReportPublished } from '../../lib/status/report-status';
import { visibleInspectionsCondition, type InspectionScope } from '../../lib/inspection/visibility';
import { chunkIds } from '../../lib/id-chunks';
import { readDashboardInputs } from './dashboard-reads';
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
 * Track E1 (ITB §11) — one contractor punch-list row returned by
 * `getRepairList`. Moved here from inside that method (shape unchanged).
 *
 * @declarationEmit Exported so the emitted `.d.ts` can NAME it: it is the
 * method's element type, and a composite project cannot reference a
 * function-local interface (TS4053/TS4055). No module imports it by name —
 * hence the tag for knip.
 */
export interface RepairListEntry {
    sectionId:           string;
    sectionTitle:        string;
    itemId:              string;
    itemLabel:           string;
    // IA-55 — the defect's own title, distinct from the item label.
    defectTitle:         string;
    comment:             string;
    location:            string | null;
    category:            'safety' | 'recommendation' | 'maintenance';
    // IA-42 — the parent item's rating-axis severity, distinct from the
    // safety/recommendation/maintenance category. Lets the repair builder
    // offer a real "worst first" sort.
    severityBucket:      'satisfactory' | 'monitor' | 'defect' | 'other';
    // IA-57 — the resolved trade label ("licensed roofer"). Same
    // resolution the report card renders, so the repair surfaces and
    // the report surface never disagree about who should fix this.
    trade:               string | null;
    recommendationId:    string | null;
    recommendationLabel: string | null;
    // No estimateLow / estimateHigh. This list is served over
    // `GET /api/inspections/{id}/repair-list` — an endpoint on the MCP
    // `extended` tier — and it had no equivalent of the report's
    // `showEstimates` gate, so a price on a stored finding walked straight
    // out of it. A punch list says what needs doing and which trade does it;
    // what the work costs belongs to whoever bids. Their ABSENCE is the
    // guarantee here, not a flag.
    photos:              Array<{ key: string; url: string }>;
    // Source — distinguishes canned (template-driven) vs custom
    // (per-inspection ad-hoc) defects so realtors can see the mix.
    source:              'canned' | 'custom';
}

/**
 * Dashboard + report analytics aggregation. Defect stats, repair list,
 * counts, dashboard buckets, section progress. Extracted verbatim from
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
     * Live per-section progress (client portal progress section)
     * (`/observe/inspections/:id`). Derives per-section completion from the same
     * resolved report shape getReportData builds, so the section/item structure
     * (templateSnapshot-aware) stays in one place. An item counts as "done" once
     * the inspector has captured a rating (rich items) or a value (data points).
     */
    async getSectionProgress(inspectionId: string, tenantId: string) {
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
     * label + the effective comment + contractor recommendation tag + photo
     * URLs. No money: see the RepairListEntry declaration below.
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
            trade?:     string | null;
            recommendationId?: string | null;
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

        // Resolve recommendation slug → label from the catalog's own map,
        // which is already built once at module load.
        const labelBySlug = RECOMMENDATION_CATEGORY_LABELS;

        // RepairListEntry is declared at module scope (top of this file) — it is
        // this method's element type, so a declaration-emitting project cannot
        // name it from a function-local declaration (TS4053/TS4055).
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
                        defectTitle:  d.title ?? item.label,
                        comment:      d.effectiveComment ?? '',
                        location:     (typeof d.effectiveLocation === 'string' && d.effectiveLocation.length > 0)
                            ? d.effectiveLocation
                            : null,
                        category:            cat,
                        severityBucket:      item.severityBucket,
                        trade:               ('effectiveTrade' in d ? d.effectiveTrade : null) ?? null,
                        recommendationId:    slug,
                        recommendationLabel: slug ? (labelBySlug.get(slug) ?? slug) : null,
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
                        defectTitle:  c.title || item.label,
                        comment:      c.comment ?? '',
                        location:     (typeof c.location === 'string' && c.location.length > 0)
                            ? c.location
                            : null,
                        category:            cat,
                        severityBucket:      item.severityBucket,
                        // The LABEL, matching the canned branch above. This row
                        // is read straight off the JSON blob, so the slug is
                        // resolved here; an unknown one resolves to null rather
                        // than reaching the repair page as a raw enum id.
                        trade:               isDefectTrade(c.trade) ? DEFECT_TRADE_LABELS[c.trade] : null,
                        recommendationId:    slug,
                        recommendationLabel: slug ? (labelBySlug.get(slug) ?? slug) : null,
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
                // Guard the fixed legacy-bucket increment: DefectCategory widened to
                // a free string (Plan-4 K), so a custom tenant category must not
                // create a stray NaN property here — mirror getDefectStats' guard.
                if (e.category === 'safety' || e.category === 'recommendation' || e.category === 'maintenance') {
                    acc[e.category]++;
                }
                return acc;
            },
            // Counts, not money. `estimateLowSum` / `estimateHighSum` were
            // summed here and published by the repair-list API.
            { count: 0, safety: 0, recommendation: 0, maintenance: 0 },
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
    async getCounts(tenantId: string, scope: InspectionScope): Promise<{
        all: number; today: number; upcoming: number;
        past: number; needsConfirmation: number; awaitingReport: number;
    }> {
        const db = this.getDrizzle();
        const todayStr = new Date().toISOString().slice(0, 10);

        const result = await db.select({
            all:         sql<number>`count(*)`,
            today:       sql<number>`sum(case when date(${inspections.date}) = ${todayStr} then 1 else 0 end)`,
            upcoming:    sql<number>`sum(case when ${inspections.date} > ${todayStr} and ${inspections.status} not in ('completed','cancelled') then 1 else 0 end)`,
            past:        sql<number>`sum(case when ${inspections.date} < ${todayStr} or ${inspections.status} in ('completed','cancelled') then 1 else 0 end)`,
            // Same two definitions the workspace filters use, so a stat tile and
            // its filter can never disagree about what they count.
            needsConfirmation: sql<number>`sum(case when ${inspections.status} in (${INSPECTION_STATUS.SCHEDULED}, ${INSPECTION_STATUS.REQUESTED}) then 1 else 0 end)`,
            awaitingReport:    sql<number>`sum(case when ${inspections.status} = ${INSPECTION_STATUS.COMPLETED} and ${inspections.reportStatus} <> ${REPORT_STATUS.PUBLISHED} then 1 else 0 end)`,
        }).from(inspections).where(and(eq(inspections.tenantId, tenantId), visibleInspectionsCondition(db, scope, tenantId)));

        const row = result[0] ?? {};
        return {
            all:         Number(row.all ?? 0),
            today:       Number(row.today ?? 0),
            upcoming:    Number(row.upcoming ?? 0),
            past:        Number(row.past ?? 0),
            needsConfirmation: Number(row.needsConfirmation ?? 0),
            awaitingReport:    Number(row.awaitingReport ?? 0),
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
     *
     * `snapshots` lets a caller that already holds the inspection rows pass the
     * template snapshots it read, which saves the statement that would read them
     * again. The ids are bound in chunks (D1 binds at most 100 parameters per
     * statement) and the chunks are read together.
     */
    async getDefectStatsBatch(
        tenantId: string,
        inspectionIds: string[],
        snapshots?: ReadonlyMap<string, unknown>,
    ): Promise<Map<string, DefectCounts>> {
        const out = new Map<string, DefectCounts>();
        if (inspectionIds.length === 0) return out;

        const db = this.getDrizzle();
        const insRows = snapshots
            ? Promise.resolve([] as Array<{ id: string; templateSnapshot: unknown }>)
            : db.select({ id: inspections.id, templateSnapshot: inspections.templateSnapshot }).from(inspections)
                .where(and(eq(inspections.tenantId, tenantId), inArray(inspections.id, inspectionIds)));
        const [snapshotRows, resultChunks] = await Promise.all([
            insRows,
            Promise.all(chunkIds(inspectionIds).map((part) => db.select({
                inspectionId: inspectionResults.inspectionId,
                data:         inspectionResults.data,
            }).from(inspectionResults)
                .where(and(eq(inspectionResults.tenantId, tenantId), inArray(inspectionResults.inspectionId, part))))),
        ]);
        const resultRows = resultChunks.flat();

        const tplById   = new Map<string, unknown>(snapshots ?? []);
        for (const r of snapshotRows) tplById.set(r.id as string, r.templateSnapshot);
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
    async getDashboardBuckets(tenantId: string, scope: InspectionScope) {
        const db  = this.getDrizzle();
        const [all, cfg, signedRows, invoiceRows, serviceRows] = await readDashboardInputs(db, tenantId, scope);

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

        const signedSet = new Set(signedRows.map(r => r.inspectionId as string));
        const overdueSet = new Set(
            invoiceRows
                .filter(r => {
                    // Unpaid only; voided ones were left out by the read.
                    if (r.paidAt != null) return false;
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

        // Sub-spec B Task 7 (B-6) — list row metadata: agent name lookup. We surface:
        //   agentName  → from inspection_people (listing_agent, else buyer_agent)
        //
        // Task 9c-X3 — replaces the legacy inspections.sellingAgentId /
        // .referredByAgentId column reads (frozen cache, dropped Task 13).
        // A batch query (role-scoped, tenant-scoped) resolves both roles for every
        // rendered inspection — listing_agent = the selling agent, buyer_agent = the
        // referred/buyer's agent — mirroring the priority the legacy code gave
        // sellingAgentId over referredByAgentId.
        // Scope to `uniqueIds` (rendered bucket ids), NOT every inspection in
        // `all` — only bucket rows are decorate()'d — and chunk under D1's ~100
        // bound-param cap. The pre-fix code bound the full per-tenant inspection
        // set and threw past ~95 inspections, breaking the dashboard (#258 review).
        const listingAgentNameByInspection = new Map<string, string>();
        const buyerAgentNameByInspection   = new Map<string, string>();

        // Round-2 backlog #2 — Inspector name lookup so the "Inspector" column
        // (Customize Columns) can render the assigned inspector without a
        // second round-trip. Self-assigned (inspectorId NULL) renders blank.
        const inspectorIdSet = new Set<string>();
        for (const i of all) {
            if (i.inspectorId) inspectorIdSet.add(i.inspectorId as string);
        }
        const inspectorNameMap = new Map<string, string>();

        // The second group of reads: everything that needs the inspection set. Defect counts take the
        // template snapshots from `all` instead of reading them again.
        const snapshotById = new Map<string, unknown>(all.map(i => [i.id as string, i.templateSnapshot]));
        const [statsMap, agentRoleChunks, inspectorChunks] = await Promise.all([
            this.getDefectStatsBatch(tenantId, uniqueIds, snapshotById),
            Promise.all(chunkIds(uniqueIds).map((chunk) => db.select({
                inspectionId: inspectionPeople.inspectionId,
                roleKey:      contactRoleProfiles.key,
                contactName:  contacts.name,
            })
                .from(inspectionPeople)
                .innerJoin(contactRoleProfiles, and(
                    eq(contactRoleProfiles.id, inspectionPeople.roleProfileId),
                    eq(contactRoleProfiles.tenantId, tenantId),
                    eq(contactRoleProfiles.active, true),
                    inArray(contactRoleProfiles.key, ['listing_agent', 'buyer_agent']),
                ))
                .leftJoin(contacts, and(
                    eq(contacts.id, inspectionPeople.contactId),
                    eq(contacts.tenantId, tenantId),
                ))
                .where(and(
                    eq(inspectionPeople.tenantId, tenantId),
                    inArray(inspectionPeople.inspectionId, chunk),
                )))),
            Promise.all(chunkIds(Array.from(inspectorIdSet)).map((chunk) => db
                .select({ id: users.id, name: users.name, email: users.email })
                .from(users)
                .where(and(eq(users.tenantId, tenantId), inArray(users.id, chunk))))),
        ]);
        for (const r of agentRoleChunks.flat()) {
            if (!r.contactName) continue;
            const map = r.roleKey === 'listing_agent' ? listingAgentNameByInspection : buyerAgentNameByInspection;
            map.set(r.inspectionId as string, r.contactName as string);
        }
        for (const r of inspectorChunks.flat()) {
            // Recorded names only; a nameless account is left out of the map.
            const nice = (r.name as string | null) ?? '';
            if (nice) inspectorNameMap.set(r.id as string, nice);
        }

        // IA-131 — the dashboard used to render `inspections.price` straight from
        // the row. That is tier 3 of the P-4 authority chain, the denormalized
        // cache, and on seeded production-shaped data it read 0 for inspections
        // whose invoices said $450 and $380 — so the busiest list in the app
        // announced "$0" for jobs that had been billed. `insp.price != null`
        // could not save it either: the cache holds 0, not NULL, so there was no
        // "unknown" to fall back to.
        //
        // The invoices and service lines were read with the first group (same
        // shape and scale: the row set is already fully in memory here), so the
        // chain can be resolved per row without an N+1.
        const invoiceAmountByInspection = new Map<string, number>();
        for (const r of invoiceRows) {
            // Earliest non-voided invoice wins — same tie-break as
            // effective-price.sql.ts and contact.service.ts.
            if (r.inspectionId && !invoiceAmountByInspection.has(r.inspectionId as string)) {
                invoiceAmountByInspection.set(r.inspectionId as string, r.amountCents ?? 0);
            }
        }

        const serviceLinesByInspection = new Map<string, Array<{ priceSnapshot: number; priceOverride: number | null }>>();
        for (const r of serviceRows) {
            const key = r.inspectionId as string;
            const list = serviceLinesByInspection.get(key);
            const line = { priceSnapshot: r.priceSnapshot ?? 0, priceOverride: r.priceOverride ?? null };
            if (list) list.push(line);
            else serviceLinesByInspection.set(key, [line]);
        }

        // Sprint 2 S2-2 — count sibling inspections per request_id so list rows
        // can show a "(2 inspections)" hint when the inspection belongs to a
        // multi-service booking. Built once for the entire bucket sweep.
        const requestSiblingCounts = new Map<string, number>();
        for (const i of all) {
            const rid = (i as typeof inspections.$inferSelect).requestId;
            if (rid) requestSiblingCounts.set(rid, (requestSiblingCounts.get(rid) ?? 0) + 1);
        }

        const decorate = <T extends { id: unknown; status?: unknown; inspectorId?: unknown; price?: unknown; requestId?: unknown }>(rows: T[]): Array<T & {
            defectStats:    DefectCounts;
            // These four are ALWAYS PRESENT, null when they do not apply — NOT
            // optional. Why that is load-bearing rather than a style choice is
            // written on `InspectionListItemSchema` in validations/inspection/read.ts.
            agentName:      string | null;
            inspectorName:  string | null;
            requestId:      string | null;
            siblingCount:   number | null;
        }> =>
            rows.map(r => {
                const id = r.id as string;
                const agentName = listingAgentNameByInspection.get(id) || buyerAgentNameByInspection.get(id) || undefined;
                const reqId = (r as { requestId?: unknown }).requestId as string | null | undefined;
                const siblingCount = reqId ? (requestSiblingCounts.get(reqId) ?? 1) : 1;
                const inspectorId = r.inspectorId as string | null;
                const inspectorName = inspectorId ? inspectorNameMap.get(inspectorId) : undefined;
                return {
                    ...r,
                    // IA-131 — overrides the row's cached `price` with the
                    // authority chain. Placed after the spread so it wins.
                    price: getEffectivePriceCents({
                        invoiceAmountCents:   invoiceAmountByInspection.get(id) ?? null,
                        serviceLines:         serviceLinesByInspection.get(id) ?? null,
                        inspectionPriceCents: (r.price as number | null) ?? null,
                    }),
                    defectStats: statsMap.get(id) ?? zeroCounts(),
                    agentName:     agentName ?? null,
                    inspectorName: inspectorName ?? null,
                    // null, not 1: an inspection in no request has no sibling group.
                    requestId:    reqId ?? null,
                    siblingCount: reqId ? siblingCount : null,
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
