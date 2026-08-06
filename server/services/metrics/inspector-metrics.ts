/**
 * Per-inspector metrics (#278) — what each person did, earned, and generated.
 *
 * FOUR THINGS HERE ARE EASY TO GET WRONG, and each is wrong in a different
 * direction:
 *
 * 1. COUNTS ARE SPLIT, MONEY IS NOT DOUBLE-COUNTED. The old query grouped on
 *    `role = 'lead'` alone, with a comment saying why: widening the grouping to
 *    the whole roster counts an inspection once per assigned person AND doubles
 *    its revenue the moment a job has a helper. So the count widens (a helper
 *    was there; hiding their work to keep one number clean is the wrong trade)
 *    and it widens into TWO fields — `ledCount` and `assistedCount` — while the
 *    company's revenue figure does not come along. What comes along instead is
 *    `attributedRevenueCents`, which is explicitly an attribution and is NOT
 *    additive across people: two inspectors on one job are each credited with
 *    the work they were on. Summing that column is a category error, which is
 *    why it is never labelled "revenue" on its own.
 *
 * 2. PAY IS NOT ATTRIBUTED REVENUE. `payCents` is the sum of that person's
 *    recorded split rows — money owed to them. `attributedRevenueCents` is what
 *    the business billed for the lines they worked. They differ by margin and
 *    the difference is the business. Housecall Pro calls the first one
 *    `Commission Cost`; we do not, because our inspector can see this figure.
 *
 * 3. MEDIAN, NOT MEAN. One delayed report on a complex property drags a mean
 *    and misrepresents the person it is attached to.
 *
 * 4. TURNAROUND HAS NO START TIMESTAMP IN PRACTICE, AND SAYS SO. The industry
 *    definition runs from when the FIELD WORK finished to when the report
 *    reached the client, so the start is `MAX(inspection_events.completed_at)`
 *    — MAX because an order with a radon pickup cannot produce its report until
 *    the last piece of fieldwork is done. That column has no frontend writer
 *    yet, so most tenants have no start at all, and the metric reports
 *    `turnaroundBasis: 'no_data'` rather than substituting a different clock.
 *    A turnaround computed from a booking-confirmation timestamp measures how
 *    fast the office confirms bookings, which is a different number wearing
 *    this one's name.
 *
 * The END anchor is `reports.published_at` — per deliverable and nullable — not
 * `report_versions.published_at`, which is NOT NULL and fires per version AND
 * per amendment, so an amended report would score a second, later turnaround.
 * The previous query also joined `report_versions` on `version_number = 1`
 * scoped only by `inspection_id`, which under an order with several reports
 * picks an arbitrary one's v1.
 */
import { and, eq, gte, lte, isNotNull, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import {
    inspections, inspectionServices, inspectionInspectors, inspectionServicePaySplits,
    inspectionEvents, reports, users, serviceInspectors,
} from '../../lib/db/schema';
import { inclusiveUpperBound } from '../../lib/metrics-window';

type TurnaroundBasis = 'field_complete_to_report_published' | 'no_data';

export interface InspectorMetricsRow {
    inspectorId: string;
    inspectorName: string;
    /** Inspections where this person was the lead. */
    ledCount: number;
    /** Inspections where this person assisted. Deliberately a separate figure. */
    assistedCount: number;
    /** Sum of this person's recorded pay split rows — what they earn. */
    payCents: number;
    /** Effective price of the lines they were assigned to — what the business billed. */
    attributedRevenueCents: number;
    /** Median days from field completion to report publish; null when there is no basis. */
    medianTurnaroundDays: number | null;
    turnaroundBasis: TurnaroundBasis;
}

/** The maximum rows returned, matching the previous query's cap. */
const MAX_ROWS = 50;

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Who may be paid — and therefore credited — on a line. ZERO qualification rows
 * for a service means everyone is qualified; rows restrict. This is the SAME
 * rule `pay-split/core.ts#eligibleFor` applies, on purpose: if attributed
 * revenue used a different eligibility rule from pay, the two columns sitting
 * side by side in the UI would not be comparable, and the reader has no way to
 * know that.
 */
function eligible(serviceId: string, roster: string[], quals: Map<string, Set<string>>): string[] {
    const restricted = quals.get(serviceId);
    if (!restricted || restricted.size === 0) return roster;
    return roster.filter(u => restricted.has(u));
}

export async function perInspectorMetrics(
    db: DrizzleD1Database,
    tenantId: string,
    window: { from: string; to: string },
): Promise<InspectorMetricsRow[]> {
    const inWindow = and(
        eq(inspections.tenantId, tenantId),
        gte(inspections.date, window.from),
        lte(inspections.date, inclusiveUpperBound(window.to)),
    );

    const [roster, lines, quals, pay, published, fieldDone] = await Promise.all([
        db.select({
            inspectionId: inspectionInspectors.inspectionId,
            userId:       inspectionInspectors.userId,
            role:         inspectionInspectors.role,
            name:         users.name,
        })
            .from(inspectionInspectors)
            .innerJoin(inspections, and(
                eq(inspections.id, inspectionInspectors.inspectionId),
                eq(inspections.tenantId, inspectionInspectors.tenantId),
            ))
            .leftJoin(users, eq(users.id, inspectionInspectors.userId))
            .where(inWindow)
            .all(),

        // Soft-deleted lines are history; a declined service bills nobody and
        // credits nobody.
        db.select({
            inspectionId:  inspectionServices.inspectionId,
            serviceId:     inspectionServices.serviceId,
            priceOverride: inspectionServices.priceOverride,
            priceSnapshot: inspectionServices.priceSnapshot,
        })
            .from(inspectionServices)
            .innerJoin(inspections, and(
                eq(inspections.id, inspectionServices.inspectionId),
                eq(inspections.tenantId, inspectionServices.tenantId),
            ))
            .where(and(inWindow, eq(inspectionServices.active, true)))
            .all(),

        db.select({ serviceId: serviceInspectors.serviceId, userId: serviceInspectors.userId })
            .from(serviceInspectors)
            .where(eq(serviceInspectors.tenantId, tenantId))
            .all(),

        // Correction rows are included: they are part of what the person is
        // owed, which is the whole reason they exist as rows rather than edits.
        db.select({
            userId: inspectionServicePaySplits.userId,
            total:  sql<number>`sum(${inspectionServicePaySplits.amountCents})`,
        })
            .from(inspectionServicePaySplits)
            .innerJoin(inspectionServices, and(
                eq(inspectionServices.id, inspectionServicePaySplits.inspectionServiceId),
                eq(inspectionServices.tenantId, inspectionServicePaySplits.tenantId),
            ))
            .innerJoin(inspections, and(
                eq(inspections.id, inspectionServices.inspectionId),
                eq(inspections.tenantId, inspectionServices.tenantId),
            ))
            .where(inWindow)
            .groupBy(inspectionServicePaySplits.userId)
            .all(),

        db.select({ inspectionId: reports.inspectionId, publishedAt: reports.publishedAt })
            .from(reports)
            .innerJoin(inspections, and(
                eq(inspections.id, reports.inspectionId),
                eq(inspections.tenantId, reports.tenantId),
            ))
            .where(and(inWindow, isNotNull(reports.publishedAt)))
            .all(),

        // MAX, not the primary visit: the report cannot ship until the LAST
        // piece of fieldwork on the order is done.
        db.select({
            inspectionId: inspectionEvents.inspectionId,
            lastDoneMs:   sql<number | null>`max(${inspectionEvents.completedAt})`,
        })
            .from(inspectionEvents)
            .innerJoin(inspections, and(
                eq(inspections.id, inspectionEvents.inspectionId),
                eq(inspections.tenantId, inspectionEvents.tenantId),
            ))
            .where(inWindow)
            .groupBy(inspectionEvents.inspectionId)
            .all(),
    ]);

    const qualMap = new Map<string, Set<string>>();
    for (const q of quals) {
        const set = qualMap.get(q.serviceId) ?? new Set<string>();
        set.add(q.userId);
        qualMap.set(q.serviceId, set);
    }

    const rosterByInspection = new Map<string, { userId: string; role: string }[]>();
    const names = new Map<string, string>();
    const led = new Map<string, number>();
    const assisted = new Map<string, number>();
    for (const r of roster) {
        const list = rosterByInspection.get(r.inspectionId) ?? [];
        list.push({ userId: r.userId, role: r.role });
        rosterByInspection.set(r.inspectionId, list);
        names.set(r.userId, r.name || r.userId);
        const bucket = r.role === 'lead' ? led : assisted;
        bucket.set(r.userId, (bucket.get(r.userId) ?? 0) + 1);
    }

    const attributed = new Map<string, number>();
    const linesByInspection = new Map<string, typeof lines>();
    for (const l of lines) {
        const list = linesByInspection.get(l.inspectionId) ?? [];
        list.push(l);
        linesByInspection.set(l.inspectionId, list);
    }
    for (const [inspectionId, list] of linesByInspection) {
        const crew = (rosterByInspection.get(inspectionId) ?? []).map(m => m.userId);
        if (crew.length === 0) continue;
        for (const line of list) {
            const price = line.priceOverride ?? line.priceSnapshot;
            for (const userId of eligible(line.serviceId, crew, qualMap)) {
                attributed.set(userId, (attributed.get(userId) ?? 0) + price);
            }
        }
    }

    const doneMs = new Map<string, number>();
    for (const f of fieldDone) {
        if (f.lastDoneMs != null) doneMs.set(f.inspectionId, Number(f.lastDoneMs));
    }

    // Turnaround is attributed to the LEAD only. The report is one artifact with
    // one publisher; dividing a duration between two people means nothing.
    const samples = new Map<string, number[]>();
    for (const p of published) {
        const start = doneMs.get(p.inspectionId);
        if (start === undefined || p.publishedAt == null) continue;
        const lead = (rosterByInspection.get(p.inspectionId) ?? []).find(m => m.role === 'lead');
        if (!lead) continue;
        const days = (Number(p.publishedAt) - start) / 86_400_000;
        const list = samples.get(lead.userId) ?? [];
        list.push(days);
        samples.set(lead.userId, list);
    }

    const payByUser = new Map(pay.map(p => [p.userId, Number(p.total || 0)]));

    const out: InspectorMetricsRow[] = [...names.keys()].map((userId) => {
        const med = median(samples.get(userId) ?? []);
        return {
            inspectorId:            userId,
            inspectorName:          names.get(userId) ?? userId,
            ledCount:               led.get(userId) ?? 0,
            assistedCount:          assisted.get(userId) ?? 0,
            payCents:               payByUser.get(userId) ?? 0,
            attributedRevenueCents: attributed.get(userId) ?? 0,
            medianTurnaroundDays:   med === null ? null : Math.round(med * 10) / 10,
            turnaroundBasis:        med === null ? 'no_data' : 'field_complete_to_report_published',
        };
    });

    out.sort((a, b) => (b.ledCount + b.assistedCount) - (a.ledCount + a.assistedCount)
        || a.inspectorName.localeCompare(b.inspectorName));
    return out.slice(0, MAX_ROWS);
}
