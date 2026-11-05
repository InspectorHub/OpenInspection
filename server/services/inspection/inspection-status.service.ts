import { eq, and, desc } from 'drizzle-orm';
import { inspections, reports, reportVersions } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { fireAutomation } from './shared';
import { INSPECTION_STATUS, type InspectionStatus } from '../../lib/status/inspection-status';
import { statusBeforeCancel } from '../../lib/inspection/cancel-restore';
import { REPORT_STATUS } from '../../lib/status/report-status';
import { InspectionSubService } from './base';
import { ensurePrimaryReportAndResults } from '../../lib/inspection/primary-report';
import type { CancellationReason } from '../../lib/cancellation-reason';

/**
 * Inspection + report status-machine transitions: confirm / cancel / uncancel
 * and the report review workflow (submit / return / unpublish) plus the
 * payment-received gate flip. Extracted verbatim from InspectionService.
 */
export class InspectionStatusService extends InspectionSubService {
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
        if (inspection.status === INSPECTION_STATUS.CANCELLED) throw Errors.BadRequest('Cannot confirm a cancelled inspection');
        await db.update(inspections).set({
            status:      INSPECTION_STATUS.CONFIRMED,
            confirmedAt: new Date(),
        }).where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));
        await fireAutomation(this.db, tenantId, id, 'inspection.confirmed');
    }

    /** Cancels, and returns the status the inspection had, which the caller records so a restore can bring it back. */
    async cancelInspection(tenantId: string, id: string, reason: CancellationReason, notes?: string): Promise<InspectionStatus> {
        const { db, inspection } = await this.fetchForStatusChange(tenantId, id);
        // A second cancel would record "cancelled" as the status to restore to, and its fee and refund would be applied again.
        if (inspection.status === INSPECTION_STATUS.CANCELLED) throw Errors.BadRequest('Inspection is already cancelled');
        await db.update(inspections).set({
            status:       INSPECTION_STATUS.CANCELLED,
            cancelReason: reason,
            cancelNotes:  notes ?? null,
        }).where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));
        await fireAutomation(this.db, tenantId, id, 'inspection.cancelled');
        return inspection.status;
    }

    /**
     * The only writer that takes an inspection OUT of `cancelled` (#81).
     *
     * Clears `cancel_reason` / `cancel_notes` with the move: they describe a
     * cancellation that no longer stands, and a live inspection carrying
     * "no_show" is a lie that outlives the mistake.
     *
     * The inspection returns to the status it had before it was cancelled (see
     * `statusBeforeCancel`), so a cancelled completed job does not come back as a
     * scheduled one. The report status is not touched, and neither are the agreement
     * and signing records.
     *
     * The MONEY does not come back. A kept fee and an issued refund are ledger
     * facts, reversed by an invoice adjustment, not by re-scheduling the job.
     * No automation fires either — there is no `inspection.uncancelled` trigger
     * to fire, and re-sending the client a "your inspection is booked" notice
     * off a correction is not what any of the existing rules mean.
     */
    async uncancelInspection(tenantId: string, id: string): Promise<InspectionStatus> {
        const { db, inspection } = await this.fetchForStatusChange(tenantId, id);
        if (inspection.status !== INSPECTION_STATUS.CANCELLED) throw Errors.BadRequest('Inspection is not cancelled');
        const restored = await statusBeforeCancel(db, tenantId, inspection);
        await db.update(inspections).set({
            status:       restored,
            cancelReason: null,
            cancelNotes:  null,
        }).where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));
        return restored;
    }

    /**
     * Submits an inspection's report for manager review.
     * Transitions: reportStatus in_progress → submitted.
     */
    async submitReport(inspectionId: string, tenantId: string): Promise<void> {
        const { db, inspection } = await this.fetchForStatusChange(tenantId, inspectionId);
        // Sending a report up for review is a report axis move; it carries no
        // claim about whether the on-site work is wrapped up. Keeping the two
        // axes coupled here would also make the two submit paths disagree.
        const reportStatus = inspection.reportStatus as string;
        if (reportStatus !== REPORT_STATUS.IN_PROGRESS) {
            throw Errors.BadRequest(`Cannot submit a report in status ${reportStatus}.`);
        }
        await db.update(inspections)
            .set({ reportStatus: REPORT_STATUS.SUBMITTED })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
    }

    /**
     * Returns a submitted report to the inspector for revision.
     * Transitions: reportStatus submitted → in_progress.
     */
    async returnReport(inspectionId: string, tenantId: string): Promise<void> {
        const { db, inspection } = await this.fetchForStatusChange(tenantId, inspectionId);
        const reportStatus = inspection.reportStatus as string;
        if (reportStatus !== REPORT_STATUS.SUBMITTED) {
            throw Errors.BadRequest('Only submitted reports can be returned.');
        }
        await db.update(inspections)
            .set({ reportStatus: REPORT_STATUS.IN_PROGRESS })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
    }

    /**
     * "Edit and republish": a published report becomes editable again WITHOUT being withdrawn.
     *
     * The report goes back to `in_progress` and keeps `published_at`, which is exactly the "editing" state of
     * `lib/inspection/report-lock`: content writes are accepted again, and clients keep reading the latest
     * published version until the next publish creates the following one. The order's `report_status` stays
     * `published` (a report is out), no link expires, nothing is sent. Returns the report's id.
     */
    async reopenReport(inspectionId: string, tenantId: string, reportId?: string): Promise<string> {
        const { db, inspection } = await this.fetchForStatusChange(tenantId, inspectionId);
        const find = () => db.select({ id: reports.id, status: reports.status, publishedAt: reports.publishedAt }).from(reports)
            .where(and(eq(reports.tenantId, tenantId), eq(reports.inspectionId, inspectionId),
                reportId ? eq(reports.id, reportId) : eq(reports.kind, 'primary'))).get();
        let row = await find();
        // A published order that never got its primary report row (data that predates the reports table): the order status is the
        // only record, so create the row already in the "editing again" state instead of leaving the inspector locked out.
        if (!row && !reportId && inspection.reportStatus === REPORT_STATUS.PUBLISHED) {
            const created = await ensurePrimaryReportAndResults(db, tenantId, inspectionId, inspection.templateId ?? null, new Date());
            if (created) {
                await db.update(reports).set({ status: REPORT_STATUS.IN_PROGRESS, publishedAt: new Date() })
                    .where(and(eq(reports.id, created), eq(reports.tenantId, tenantId)));
                row = await find();
            }
        }
        if (!row) throw Errors.NotFound('Report not found');
        // Already being edited again: the same answer, so a double tap or a retried request is harmless.
        if (row.status !== REPORT_STATUS.PUBLISHED && row.publishedAt) return row.id;
        if (row.status !== REPORT_STATUS.PUBLISHED) throw Errors.BadRequest('Only a published report can be edited again.');
        // "Editing again" is a published report with a `published_at`; the two states differ only by that stamp. A report published
        // before the stamp was kept has none (it would read as a plain draft: no banner, and the republish would skip the notice
        // choice), so it is taken from the version clients are reading, or from now when no version is on record.
        const latest = row.publishedAt ? null : await db.select({ publishedAt: reportVersions.publishedAt }).from(reportVersions)
            .where(and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.reportId, row.id)))
            .orderBy(desc(reportVersions.versionNumber)).limit(1).get();
        await db.update(reports).set({ status: REPORT_STATUS.IN_PROGRESS, publishedAt: row.publishedAt ?? latest?.publishedAt ?? new Date() })
            .where(and(eq(reports.id, row.id), eq(reports.tenantId, tenantId)));
        return row.id;
    }

    /**
     * RETRACTS a published report: withdrawn from clients, back to a draft. The caller also expires the links.
     * Transitions: reportStatus published → in_progress, and every report of the inspection to a draft
     * (`in_progress`, `published_at` cleared), which is what tells "withdrawn" from "editing again".
     */
    async unpublishReport(inspectionId: string, tenantId: string): Promise<void> {
        const { db, inspection } = await this.fetchForStatusChange(tenantId, inspectionId);
        const reportStatus = inspection.reportStatus as string;
        if (reportStatus !== REPORT_STATUS.PUBLISHED) {
            throw Errors.BadRequest('Only published reports can be unpublished.');
        }
        await db.update(inspections)
            .set({ reportStatus: REPORT_STATUS.IN_PROGRESS })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
        await db.update(reports).set({ status: REPORT_STATUS.IN_PROGRESS, publishedAt: null })
            .where(and(eq(reports.inspectionId, inspectionId), eq(reports.tenantId, tenantId)));
    }

    /**
     * Stripe webhook — flips the inspection's payment gate to paid so the
     * report unlocks (getReportGate reads inspections.paymentStatus). Idempotent
     * and tenant-scoped; a no-op when the inspection doesn't exist (the invoice
     * may be standalone, not linked to an inspection).
     */
    async markPaymentReceived(tenantId: string, inspectionId: string): Promise<void> {
        const db = this.getDrizzle();
        await db.update(inspections)
            .set({ paymentStatus: 'paid' })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
    }

    /**
     * Release the report gate for one inspection.
     *
     * The gate is order-wide: an unsigned agreement or an outstanding payment
     * blocks every report on the inspection. This is the deliberate way out when
     * a finished report is being held back by paperwork attached to something
     * else on the same job.
     *
     * `reason` is required and stored. An override with no stated reason is
     * indistinguishable later from a mistake, and this one is visible to a
     * client — it hands over a report that the tenant's own rules said to hold.
     *
     * Idempotent: unlocking an already-unlocked inspection keeps the ORIGINAL
     * timestamp, person and reason, so the record shows who actually made the
     * call rather than whoever pressed it last.
     */
    async unlockReportGate(
        tenantId: string, inspectionId: string, userId: string, reason: string,
    ): Promise<{ alreadyUnlocked: boolean }> {
        const db = this.getDrizzle();
        const existing = await db.select({ unlockedAt: inspections.unlockedAt })
            .from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!existing) throw Errors.NotFound('Inspection not found');
        if (existing.unlockedAt) return { alreadyUnlocked: true };

        await db.update(inspections)
            .set({ unlockedAt: new Date(), unlockedBy: userId, unlockReason: reason })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
        return { alreadyUnlocked: false };
    }

    /**
     * Put the gate back. The reason for the original unlock is cleared with it —
     * it described a decision that no longer stands.
     */
    async relockReportGate(tenantId: string, inspectionId: string): Promise<void> {
        const db = this.getDrizzle();
        await db.update(inspections)
            .set({ unlockedAt: null, unlockedBy: null, unlockReason: null })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
    }
}
