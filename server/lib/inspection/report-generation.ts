/**
 * Reports are GENERATED, not assembled.
 *
 * Selling the services produces the deliverables: three lines on the order —
 * standard, sewer, radon — are three reports, each with its own document, its
 * own signature chain and its own notification. Adding one by hand exists for
 * the two cases that genuinely need it (a late finding, a specialised separated
 * report) and is the exception path, not the primary interaction.
 *
 * WHEN it runs is as load-bearing as what it does. Generation happens at the
 * point the work is scheduled to begin, never at booking: a report that
 * materialises weeks early clutters the order and, worse, freezes a template the
 * tenant may still be editing. It runs ONCE — `inspections.reports_generated_at`
 * is the latch — because a second run would re-title and re-template documents
 * somebody has already filled in.
 */
import { and, asc, eq, isNull, lte, ne } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections, inspectionResults, inspectionServices, reports, services } from '../db/schema';
import { INSPECTION_STATUS } from '../status/inspection-status';
import { REPORT_STATUS } from '../status/report-status';

/**
 * The number of reports on one order past which things get unpleasant.
 *
 * A soft ceiling, deliberately: the competitor's own guidance is "no strict
 * limit, keep below 15", and ours carry Yjs documents so the same pressure
 * applies — every extra report is another collaborative document to open, sync
 * and render. Nothing is refused. An inspector who genuinely needs sixteen
 * deliverables knows something the software does not.
 */
export const REPORT_COUNT_SOFT_CEILING = 15;

export interface ReportGenerationResult {
    /** Reports inserted by this run. Adopting the placeholder primary is not a creation. */
    created: number;
    /** Advisory only — nothing here blocks the caller. */
    warnings: string[];
}

/** The soft-ceiling advisory, or nothing. Pure, so the wording is testable. */
export function reportCountWarnings(reportCount: number): string[] {
    if (reportCount <= REPORT_COUNT_SOFT_CEILING) return [];
    return [
        `This order has ${reportCount} reports. Keeping an order under ${REPORT_COUNT_SOFT_CEILING} `
        + 'reports is recommended — each one carries its own editable document, and past that the '
        + 'order gets slow to open and hard to read. Nothing is blocked.',
    ];
}

/** Has anyone written into the primary report's document yet? */
async function primaryIsUntouched(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    primaryReportId: string,
): Promise<boolean> {
    // Both shapes count: a row already bound to this report, and the row the
    // inspection was born with, which carries no `report_id` until the
    // collaborative document writes one.
    const rows = await db.select({
        data: inspectionResults.data,
        ydocState: inspectionResults.ydocState,
        reportId: inspectionResults.reportId,
    }).from(inspectionResults)
        .where(and(
            eq(inspectionResults.tenantId, tenantId),
            eq(inspectionResults.inspectionId, inspectionId),
        ))
        .all();

    for (const row of rows) {
        if (row.reportId != null && row.reportId !== primaryReportId) continue;
        if (row.ydocState != null) return false;
        const raw = row.data;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw;
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) return false;
    }
    return true;
}

/**
 * Turn this order's sold service lines into reports.
 *
 * Idempotent PER LINE: a line that already has a report is skipped, and the
 * title and template are snapshotted at the moment the report is created. That
 * pair is what makes "a default template configured today must not replace a
 * document already filled in" true rather than merely intended — running this
 * again after the catalogue changes rewrites nothing.
 *
 * It does not refuse to run twice, deliberately. A client who adds a sewer
 * scope at the door should get a sewer report, and the `reports_generated_at`
 * latch belongs to the SWEEP (which must not re-scan finished orders for ever),
 * not to the reconciliation.
 *
 * The FIRST line in catalogue order becomes the primary. Every order is born
 * with a placeholder primary (the collab route resolves an inspection to its
 * primary and fails closed without one), so that placeholder is ADOPTED by the
 * first line rather than left orphaned beside a fourth report nobody asked for
 * — but only while it is still empty. A primary somebody has already written
 * into keeps its title and its template, and the line gets its own report.
 */
export async function generateReportsForServices(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    now: Date = new Date(),
): Promise<ReportGenerationResult> {
    const inspection = await db.select({
        id: inspections.id,
        reportsGeneratedAt: inspections.reportsGeneratedAt,
    }).from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
        .get();
    if (!inspection) return { created: 0, warnings: [] };

    // Catalogue order, which is the order the tenant thinks of the work in —
    // and the same order `listServices` returns, so the order screen and the
    // report list cannot disagree. Soft-deleted lines are excluded: a service
    // the client declined at the door is history, not a deliverable.
    const lines = await db.select({
        lineId: inspectionServices.id,
        title: inspectionServices.nameSnapshot,
        templateId: services.templateId,
    }).from(inspectionServices)
        .innerJoin(services, and(
            eq(services.id, inspectionServices.serviceId),
            eq(services.tenantId, tenantId),
        ))
        .where(and(
            eq(inspectionServices.tenantId, tenantId),
            eq(inspectionServices.inspectionId, inspectionId),
            eq(inspectionServices.active, true),
        ))
        .orderBy(asc(services.sortOrder), asc(services.name))
        .all();

    const existing = await db.select().from(reports)
        .where(and(eq(reports.tenantId, tenantId), eq(reports.inspectionId, inspectionId)))
        .all();
    const boundLines = new Set(existing.map((r) => r.inspectionServiceId).filter((v): v is string => v != null));

    // The placeholder the order was born with, if it is still adoptable. Set to
    // null the moment it is claimed, so no second line can claim it too.
    let adoptable = existing.find((r) => r.kind === 'primary') ?? null;
    let hasPrimary = adoptable != null;
    let created = 0;
    let position = 0;

    for (const line of lines) {
        if (boundLines.has(line.lineId)) { position += 1; continue; }

        if (adoptable && adoptable.inspectionServiceId == null
            && adoptable.status === REPORT_STATUS.IN_PROGRESS
            && await primaryIsUntouched(db, tenantId, inspectionId, adoptable.id)) {
            await db.update(reports).set({
                inspectionServiceId: line.lineId,
                title: line.title,
                sortOrder: position,
                // A template chosen when the order was booked is an explicit
                // decision and outranks the service default; only an unset one
                // is filled in from the catalogue.
                ...(adoptable.templateId ? {} : { templateId: line.templateId ?? null }),
            }).where(and(eq(reports.id, adoptable.id), eq(reports.tenantId, tenantId)));
            adoptable = null;
            position += 1;
            continue;
        }

        await db.insert(reports).values({
            id: crypto.randomUUID(),
            tenantId,
            inspectionId,
            kind: hasPrimary ? 'ancillary' : 'primary',
            inspectionServiceId: line.lineId,
            templateId: line.templateId ?? null,
            title: line.title,
            status: REPORT_STATUS.IN_PROGRESS,
            createdAt: now,
            sortOrder: position,
        });
        hasPrimary = true;
        adoptable = null;
        created += 1;
        position += 1;
    }

    // First run only. The column answers "when did this order's deliverables
    // come into existence", which is the sweep's latch — not "when did anyone
    // last reconcile", which would move every time and latch nothing.
    if (!inspection.reportsGeneratedAt) {
        await db.update(inspections).set({ reportsGeneratedAt: now })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
    }

    return { created, warnings: reportCountWarnings(existing.length + created) };
}

/**
 * The hook the schedule calls: the work on this order is starting, so its
 * deliverables should exist.
 *
 * A separate name from the mechanism on purpose — the WHEN is the decision this
 * feature had to make, and a caller reading `onScheduledStart` is told which
 * moment it is wiring itself to.
 */
export async function onScheduledStart(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    now: Date = new Date(),
): Promise<ReportGenerationResult> {
    return generateReportsForServices(db, tenantId, inspectionId, now);
}

/**
 * The cron half: every order whose scheduled start has arrived and whose lines
 * have not been turned into deliverables yet.
 *
 * `scheduled_start_ms` is the precise booked instant, so this is the literal
 * "point the work is scheduled to begin" — and an order that has no such
 * instant recorded has no such point, so it is not swept. It keeps the primary
 * report it was born with until something else names a moment for it.
 *
 * Batched, and safe to run again: the per-inspection latch means a row swept
 * twice is a no-op the second time.
 */
export async function sweepScheduledReportGeneration(
    db: DrizzleD1Database,
    nowMs: number,
    limit = 100,
): Promise<number> {
    const due = await db.select({ id: inspections.id, tenantId: inspections.tenantId })
        .from(inspections)
        .where(and(
            isNull(inspections.reportsGeneratedAt),
            lte(inspections.scheduledStartMs, new Date(nowMs)),
            ne(inspections.status, INSPECTION_STATUS.CANCELLED),
        ))
        .limit(limit)
        .all();

    const now = new Date(nowMs);
    let swept = 0;
    for (const row of due) {
        await generateReportsForServices(db, row.tenantId, row.id, now);
        swept += 1;
    }
    return swept;
}
