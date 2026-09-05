/**
 * What this inspection still owes its statutory form, WHILE it can still be
 * answered.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Until now the only thing that could answer "is this form producible" was
 * producing it, and that path requires a PUBLISHED report -- so the first time
 * an inspector learned a required box was empty, the report had already gone to
 * the client. Verified in production on 2026-09-05: a TREC inspection was
 * created, worked and published, and the download then refused with
 * "2 required field(s) have no answer: inspector_name, inspector_license_number"
 * -- two facts that had been missing since before the inspection existed.
 *
 * This asks the same question against the same rule, with no published report
 * and nothing recorded, so the answer can be shown in the editor.
 *
 * ⚠️ THE RULE IS BORROWED, NEVER RESTATED. `missingRequiredFields` is the
 * function the refusal itself calls. A coverage indicator that decided
 * "still missing" its own way would agree on the day it was written and drift
 * afterwards -- and a checklist that reads complete over a form that will be
 * refused is worse than no checklist, because it is believed.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 * It does not judge the revision, the withdrawal, or whether the deployment
 * holds the authority's bytes. Those are answered by `revisionStatusForInspection`
 * and the produce path, they are not per-field, and duplicating them here would
 * create a second opinion about the one thing this subsystem exists to keep
 * single.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type * as schema from '../../lib/db/schema';
import { collectStatutoryValues } from '../../lib/statutory/values';
import { missingRequiredFields } from '../../lib/statutory/value-checks';
import { fieldMapFor } from '../../lib/statutory/forms';
import { versionForInspection } from '../../lib/statutory/form-registry';
import { PUBLISHED_FORM_VERSIONS } from '../../lib/statutory/forms';
import { utcMidnightOf } from '../../lib/statutory/inspection-date';
import { provenanceOfBinding, type FactProvenance } from '../../lib/statutory/fact-provenance';
import { StatutoryOverflowService } from './overflow.service';
import {
    gatherStatutoryInputs,
    type StatutoryInspectionRow,
} from '../../api/inspections/statutory-inputs';
import type { StatutoryFormDeclaration, TemplateSchemaV2 } from '../../types/template-schema';

export interface StatutoryMissingField {
    /** The form's own field name, as the refusal would name it. */
    field: string;
    /**
     * WHEN this could first have been answered. `pre_inspection` means the
     * value comes from the workspace or the inspector's profile and was
     * already missing before this job existed -- which is why the same list
     * gates template installation.
     */
    provenance: FactProvenance;
}

export interface StatutoryCoverage {
    formId: string;
    /** The revision the inspection's own date selects, or null if none does. */
    revision: string | null;
    /** Required by the form of EVERY inspection. */
    requiredTotal: number;
    missing: StatutoryMissingField[];
}

/**
 * Null when this inspection produces no statutory form at all, which is the
 * ordinary case for almost every template and is not a fault.
 *
 * Null is also the answer when the revision the date selects has no published
 * field map: there is then no `requiredFields` list to measure against, and
 * inventing an empty one would report full coverage over a form that cannot be
 * produced at all.
 */
export async function statutoryCoverageFor(
    db: DrizzleD1Database<typeof schema>,
    d1: D1Database,
    tenantId: string,
    // The same row shape the producer takes, so the two cannot disagree about
    // what an inspection is; `inspectionDay` is passed rather than read off the
    // row for the reason that type's own note gives.
    inspection: StatutoryInspectionRow,
    inspectionDay: string,
    /**
     * The snapshot the inspection ran against, resolved by the caller.
     *
     * Passed rather than read off the row because `StatutoryInspectionRow` does
     * not carry it, and that omission is deliberate -- see the note on that
     * type about `date`. Widening the row here to reach one more column would
     * undo a narrowing someone made on purpose.
     */
    snapshot: (TemplateSchemaV2 & { statutoryForm?: StatutoryFormDeclaration }) | null,
): Promise<StatutoryCoverage | null> {
    const declaration = snapshot?.statutoryForm;
    if (!snapshot || !declaration) return null;

    const version = versionForInspection(
        declaration.formId, utcMidnightOf(inspectionDay), PUBLISHED_FORM_VERSIONS,
    );
    if (!version) return null;
    const map = fieldMapFor(declaration.formId, version.version);
    if (!map) return null;

    const { results, facts, signatures } = await gatherStatutoryInputs(
        db, d1, tenantId, inspection, inspectionDay, declaration,
    );
    const instances = await new StatutoryOverflowService(db)
        .instancesFor(tenantId, inspection.id, declaration.formId);
    const values = collectStatutoryValues(
        declaration, snapshot, results ?? {}, facts, instances,
    );

    const missing = missingRequiredFields(
        map, new Map(Object.entries(values)), signatures,
    ).map((field) => ({
        field,
        // Classified from the TEMPLATE'S OWN BINDING, never from the field's
        // name. The refusal names `inspector_license_number` while the fact
        // behind it is `inspector_license`; a name-based guess would put the
        // two in different buckets and gate the wrong one.
        provenance: provenanceOfBinding(declaration.bindings[field]),
    }));

    return {
        formId: declaration.formId,
        revision: version.version,
        requiredTotal: map.requiredFields.length,
        missing,
    };
}
