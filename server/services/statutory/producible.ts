/**
 * Everything that has to be true and everything that has to be gathered before
 * a statutory form can be rendered -- resolved ONCE, for every caller that
 * renders one.
 *
 * ── WHY THIS WAS LIFTED OUT OF THE ROUTE ────────────────────────────────────
 * There is now a second renderer: the editor's preview. The preconditions it
 * shares with the deliverable are the ones that decide WHICH DOCUMENT comes
 * out -- the template's declaration, the revision the inspection's own date
 * selects, and whether that revision was withdrawn -- and getting any of them
 * wrong produces a plausible, wrong official form rather than an error.
 *
 * A preview that judged them a second time would be a second opinion about
 * exactly the thing this subsystem exists to keep single. Worse, it would be
 * the LENIENT copy: a preview is written to be helpful, so the drift would run
 * towards showing something rather than refusing, and an inspector would be
 * shown a form the deliverable will refuse -- or, at a revision boundary, a
 * preview of the wrong revision that looks entirely correct.
 *
 * ── THE ONE PRECONDITION THAT IS NOT HERE ───────────────────────────────────
 * A PUBLISHED report version. That belongs to the deliverable alone and stays
 * in its route, because it is not about which document comes out -- it is about
 * reproducing the one that was handed over. A preview is never filed, never
 * recorded, and never handed to anybody, so there is nothing to reproduce and
 * the requirement has nothing to attach to. That asymmetry is the entire point
 * of the preview existing; see `statutory-preview.ts`.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { revisionStatusForInspection } from '../../lib/statutory/revision-status';
import { withdrawalRefusal, supersededRefusal } from '../../lib/statutory/withdrawal-copy';
import { calendarDayOfStoredDate } from '../../lib/statutory/inspection-date';
import { refusalToUser } from '../../lib/statutory/refusal-to-user';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import * as schema from '../../lib/db/schema';
import { StatutoryOverflowService } from './overflow.service';
import { gatherStatutoryInputs } from '../../api/inspections/statutory-inputs';
import type { StatutoryFormDeclaration, TemplateSchemaV2 } from '../../types/template-schema';
import type { StatutoryInputs } from '../../api/inspections/statutory-inputs';
import type { StatutoryGroupInstances } from '../../lib/statutory/values';

// Not exported: it is this file's own shorthand for the two callers here, and
// `ProducibleStatutoryForm` already carries it out to everyone else.
type StatutorySnapshot = TemplateSchemaV2 & { statutoryForm?: StatutoryFormDeclaration };

export interface ProducibleStatutoryForm {
    inspection: typeof schema.inspections.$inferSelect;
    snapshot: StatutorySnapshot;
    declaration: StatutoryFormDeclaration;
    /** Already narrowed by `calendarDayOfStoredDate` -- never the raw column. */
    inspectionDay: string;
    inputs: StatutoryInputs;
    instances: StatutoryGroupInstances;
}

/**
 * Throws the same refusals the deliverable has always thrown, in the same
 * order, and returns everything a render needs.
 *
 * The order is load-bearing and is not this function's invention: a withdrawal
 * is checked before a revision mismatch because it is the only fault here that
 * has already put wrong documents into somebody's hands, and its remedy depends
 * on WHY it was withdrawn.
 */
export async function resolveProducibleStatutoryForm(
    db: DrizzleD1Database<typeof schema>,
    d1: D1Database,
    tenantId: string,
    inspectionId: string,
): Promise<ProducibleStatutoryForm> {
    const inspection = await db.select()
        .from(schema.inspections)
        .where(and(
            eq(schema.inspections.id, inspectionId),
            eq(schema.inspections.tenantId, tenantId),
        ))
        .get();
    // Same answer for "does not exist" and "belongs to someone else": telling
    // the two apart is itself a disclosure.
    if (!inspection) throw Errors.NotFound('Inspection not found');

    const snapshot = inspection.templateSnapshot as StatutorySnapshot | null;
    const declaration = snapshot?.statutoryForm;
    if (!snapshot || !declaration) {
        throw Errors.NotFound('This inspection produces no statutory form');
    }

    // ONE reading of the column, handed to everything below: `inspections.date`
    // holds a calendar day OR that day plus an instant, and everything past this
    // line takes a bare day.
    const inspectionDay = calendarDayOfStoredDate(inspection.date);
    const revision = revisionStatusForInspection({
        snapshot,
        inspectionDate: inspectionDay,
        now: Date.now(),
    });
    if (revision?.kind === 'withdrawn') {
        throw Errors.Conflict(withdrawalRefusal({
            formId: declaration.formId,
            version: revision.version,
            reason: revision.reason,
            at: revision.withdrawnAt,
            replacementVersion: revision.replacementVersion,
            inspectionDate: inspectionDay,
        }));
    }
    if (revision?.kind === 'cannot_produce') {
        throw Errors.Conflict(supersededRefusal({
            formId: declaration.formId,
            inspectionDate: inspectionDay,
            applicableVersion: revision.applicableVersion,
            templateVersion: revision.templateVersion,
        }));
    }

    const inputs = await refusalToUser(
        () => gatherStatutoryInputs(db, d1, tenantId, inspection, inspectionDay, declaration),
    );
    if (inputs.skippedNonDefaultUnits.length > 0) {
        // Answered only under some other unit. This form describes one dwelling,
        // so substituting a unit's answer would print its findings under the
        // whole building's address.
        logger.warn('statutory: item answered only outside the default unit', {
            inspectionId,
            items: inputs.skippedNonDefaultUnits.slice(0, 10),
            count: inputs.skippedNonDefaultUnits.length,
        });
    }

    const instances = await new StatutoryOverflowService(db)
        .instancesFor(tenantId, inspectionId, declaration.formId);

    return { inspection, snapshot, declaration, inspectionDay, inputs, instances };
}
