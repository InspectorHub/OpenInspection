import { eq, and } from 'drizzle-orm';
import { inspections } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { fireAutomation } from './shared';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import { REPORT_STATUS } from '../../lib/status/report-status';
import { InspectionSubService } from './base';
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

    async cancelInspection(tenantId: string, id: string, reason: CancellationReason, notes?: string): Promise<void> {
        const { db } = await this.fetchForStatusChange(tenantId, id);
        await db.update(inspections).set({
            status:       INSPECTION_STATUS.CANCELLED,
            cancelReason: reason,
            cancelNotes:  notes ?? null,
        }).where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));
        await fireAutomation(this.db, tenantId, id, 'inspection.cancelled');
    }

    async uncancelInspection(tenantId: string, id: string): Promise<void> {
        const { db, inspection } = await this.fetchForStatusChange(tenantId, id);
        if (inspection.status !== INSPECTION_STATUS.CANCELLED) throw Errors.BadRequest('Inspection is not cancelled');
        await db.update(inspections).set({
            status:       INSPECTION_STATUS.SCHEDULED,
            cancelReason: null,
            cancelNotes:  null,
        }).where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));
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
     * Unpublishes a published report, reverting it to in_progress for editing.
     * Transitions: reportStatus published → in_progress.
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
