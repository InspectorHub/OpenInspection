import { eq, and } from 'drizzle-orm';
import { inspections } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { fireAutomation } from './shared';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import { REPORT_STATUS } from '../../lib/status/report-status';
import { InspectionSubService } from './base';

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

    async cancelInspection(tenantId: string, id: string, reason: string, notes?: string): Promise<void> {
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
     * Submits a completed inspection's report for manager review.
     * Transitions: reportStatus in_progress → submitted.
     */
    async submitReport(inspectionId: string, tenantId: string): Promise<void> {
        const { db, inspection } = await this.fetchForStatusChange(tenantId, inspectionId);
        if (inspection.status !== INSPECTION_STATUS.COMPLETED) {
            throw Errors.BadRequest('Inspection must be completed before submitting the report.');
        }
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
}
