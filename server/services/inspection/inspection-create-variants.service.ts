import { eq, and } from 'drizzle-orm';
import { inspections, inspectionServices } from '../../lib/db/schema';
import { PeopleService } from '../people.service';
import { safeISODate } from '../../lib/date';
import { logger } from '../../lib/logger';
import { syncInspectionAssignments } from '../../lib/db/assignment-links';
import { getInspectionRoster } from '../../lib/inspection/roster';
import type { ServiceSelection } from '../../lib/inspection/service-snapshot';
import type { Inspection, CreateInspectionData } from './shared';
import type { ScopedDB } from '../../lib/db/scoped';
import type { ImagesBinding } from '../../lib/media/strip-exif';
import type { PlanQuotaGuard } from '../../features/plan-quota/guard';
import type { InspectionCoreService } from './inspection-core.service';
import { InspectionSubService } from './base';

/**
 * THE OTHER WAYS AN INSPECTION COMES INTO EXISTENCE, and the post-create hook
 * they share.
 *
 * `createInspection` on the core service is the primitive. Neither of these is
 * a caller-visible alternative to it — each is a TRANSLATION into it:
 * `createFromWizard` maps the wizard's four-step payload onto the column set
 * and then patches the team fields the primitive does not know about;
 * `cloneInspection` reads an existing row and replays it. Both therefore call
 * back into the core service rather than duplicating the insert, and both
 * consume quota at the same point the primitive does — after the precondition
 * checks, before the row exists.
 *
 * `applyServicePriceOverrides` lives here because it is the same shape of
 * thing: a post-create hook the HANDLER runs once `createInspection` has
 * returned an id, never part of the insert itself.
 */
export class InspectionCreateVariantsService extends InspectionSubService {
    private readonly planQuota: PlanQuotaGuard | undefined;
    private readonly core: InspectionCoreService;

    constructor(
        db: D1Database,
        r2: R2Bucket | undefined,
        sdb: ScopedDB | undefined,
        kv: KVNamespace | undefined,
        images: ImagesBinding | undefined,
        planQuota: PlanQuotaGuard | undefined,
        core: InspectionCoreService,
    ) {
        super(db, r2, sdb, kv, images);
        this.planQuota = planQuota;
        this.core = core;
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
        selections: ServiceSelection[],
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
        input: import('../../lib/validations/wizard.schema').CreateInspectionFromWizardInput,
    ): Promise<{ id: string }> {
        // Build the base CreateInspectionData shape consumed by createInspection.
        // The wizard's schedule.startTime is appended to the ISO date so the
        // existing `date` column carries both — the editor's calendar pane
        // already round-trips this format.
        const dateTime = `${input.schedule.date}T${input.schedule.startTime}:00`;

        const created = await this.core.createInspection(tenantId, {
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
                // teamMode is live (it drives the team UI). Lead + helpers are
                // NOT written back to `inspections` — they live in
                // inspection_inspectors, written from the intent computed below.
                patch.teamMode = input.teamMode;
                teamFieldsPatched = true;
                effectiveLead    = input.teamMode ? (input.leadInspectorId ?? creatorUserId) : null;
                effectiveHelpers = input.teamMode ? (input.helperInspectorIds ?? []) : [];
            }
            if (Object.keys(patch).length > 0) {
                await db.update(inspections)
                    .set(patch)
                    .where(and(eq(inspections.id, created.id), eq(inspections.tenantId, tenantId)));
            }
            // Write who is assigned. Always pass creatorUserId as the inspectorId
            // fallback so that when teamMode=false but a lead was still present in
            // the request (effectiveLead=null, effectiveHelpers=[]),
            // syncInspectionAssignments writes a lead row for the creator rather
            // than leaving the inspection with nobody on it.
            if (teamFieldsPatched) {
                // Non-fatal, but no longer cosmetic: this table is the only
                // record of who is assigned, so a failure here leaves the
                // inspection UNASSIGNED, not merely un-mirrored. Still non-fatal
                // because the inspection row is already committed and throwing
                // would lose it; assignment can be redone, a lost inspection
                // cannot. The error log is the signal.
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
        // getInspection throws NotFound for a bad id — that precondition check
        // must run BEFORE quota is consumed, so cloning a nonexistent
        // inspection never burns a free tenant's lifetime slot.
        const { inspection: source } = await this.core.getInspection(id, tenantId);
        await this.planQuota?.consumeInspection(tenantId);

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

        // Task 13 — clientName/clientEmail/clientPhone on `source` are
        // resolved via PeopleService inside getInspection (not raw DB
        // columns; clientContactId/referredByAgentId/sellingAgentId are gone
        // entirely now that the columns are dropped). Strip them from the
        // insert payload — they'd otherwise be dead keys on an object the
        // schema no longer recognizes. The inspection_people copy below is
        // the only carry-forward of WHO.
        const { clientName: _clientName, clientEmail: _clientEmail, clientPhone: _clientPhone, ...cloneDbValues } =
            clone as typeof clone & { clientName?: unknown; clientEmail?: unknown; clientPhone?: unknown };
        void _clientName; void _clientEmail; void _clientPhone;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.getDrizzle().insert(inspections).values(cloneDbValues as any);

        // Task 7c (people-role-profiles fix) — copy the source inspection's
        // inspection_people rows (client + any agents) onto the clone.
        // Without this, getInspection/listInspections (Task 9c-reads)
        // resolve the client via inspection_people ONLY and would show a
        // null client on every clone. Non-fatal: a people-write failure must
        // never roll back the already-committed clone row.
        try {
            const people = new PeopleService({ DB: this.db });
            const sourcePeople = await people.listPeople(tenantId, id);
            for (const p of sourcePeople) {
                await people.addPerson(tenantId, clone.id, p.contactId, p.roleProfileId);
            }
        } catch (err) {
            logger.error('inspection-people copy from clone create failed', { inspectionId: clone.id }, err instanceof Error ? err : undefined);
        }
        // Give the clone the SOURCE's people, read from the source's roster —
        // not from columns copied onto the clone row, which are no longer
        // written and would leave any recently-assigned clone empty. Non-fatal
        // for the same reason as the create path above.
        try {
            const sourceRoster = await getInspectionRoster(this.getDrizzle(), tenantId, id);
            await syncInspectionAssignments(this.getDrizzle(), tenantId, clone.id, {
                inspectorId:        (clone as { inspectorId?: string | null }).inspectorId ?? null,
                leadInspectorId:    sourceRoster.lead?.id ?? null,
                helperInspectorIds: sourceRoster.helpers.map(h => h.id),
            });
        } catch (e) {
            logger.error('inspection.clone-sync.failed', { inspectionId: clone.id }, e instanceof Error ? e : undefined);
        }

        return {
            ...clone,
            createdAt: safeISODate(clone.createdAt)
        };
    }
}
