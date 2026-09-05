/**
 * Which statutory facts are known BEFORE an inspection exists, and which are
 * answers to this particular job.
 *
 * ── WHY THIS DISTINCTION IS WORTH A FILE ────────────────────────────────────
 * Every fact in `StatutoryInspectionField` reaches the form the same way, so
 * nothing downstream had any reason to tell them apart. But they fail at wildly
 * different moments and the difference decides where a person can be told.
 *
 * `inspector_name` and the licence come from `users` and the credential rows.
 * They are the same for every inspection this person will ever do, they are
 * knowable the moment a statutory template is installed, and they are fixed on
 * a settings screen -- not in the report. Measured in production on 2026-09-05:
 * an inspection was created, worked, and PUBLISHED TO THE CLIENT, and only the
 * download afterwards said "2 required field(s) have no answer: inspector_name,
 * inspector_license_number". Neither had anything to do with that inspection.
 * Both were absent before it was created, and stayed absent through every
 * screen that could have said so.
 *
 * A per-inspection fact -- the owner's name, the signing date, an answer on the
 * page -- genuinely cannot be known earlier, and warning about one before the
 * work starts would be noise on every job.
 *
 * ── WHY THE SET IS WRITTEN OUT AND NOT DERIVED ──────────────────────────────
 * Provenance is a property of `gatherStatutoryInputs` -- which table each fact
 * is read from -- and that is a fact about code, not about data, so there is
 * nothing to derive it from at runtime. It is written out with the read named
 * beside it so the two can be checked against each other by eye, and the type
 * annotation makes a name that is not a real fact a compile error rather than
 * an entry that silently matches nothing.
 *
 * ⚠️ If a fact moves to a different source, move it here in the same commit.
 * A fact left in this set after it becomes per-inspection produces a gate that
 * blocks work nobody can unblock yet.
 */
import type { StatutoryInspectionField } from '../../types/statutory-declaration';

/**
 * Facts read from the workspace or the inspector's own profile, never from the
 * inspection. Each is annotated with the read in `gatherStatutoryInputs`.
 */
export const PRE_INSPECTION_FACTS: ReadonlySet<StatutoryInspectionField> = new Set([
    'inspector_name',            // users.name
    'inspector_license',         // CredentialService.primaryLicenseNumber
    'inspector_license_type',    // users.statutory_license_type
    'inspector_qualification',   // users.statutory_qualification
    'company_name',              // tenant_configs.company_name
    'company_phone',             // tenant_configs.company_phone
]);

/**
 * Where a form field's value has to come from, for the purpose of deciding WHEN
 * a person can be told it is missing.
 *
 * `unknown` is returned for a binding this module does not classify rather than
 * guessed into either bucket: a fact whose provenance nobody has stated is not
 * evidence that it is per-inspection, and treating it as pre-inspection would
 * put it behind a gate before anyone decided it belonged there.
 */
export type FactProvenance = 'pre_inspection' | 'per_inspection' | 'unknown';

/**
 * Narrowing guard, so a caller holding a plain string can ask the set without
 * asserting its way in. A cast here would let a typo through as a fact name and
 * silently classify a profile field as per-inspection.
 */
export function isPreInspectionFact(value: string): value is StatutoryInspectionField {
    return PRE_INSPECTION_FACTS.has(value as StatutoryInspectionField);
}

export function provenanceOfBinding(
    source: { from: string; field?: string } | undefined,
): FactProvenance {
    if (source === undefined) return 'unknown';
    // A literal is authored into the declaration, so it is never missing and
    // never worth warning about at any moment.
    if (source.from === 'literal') return 'pre_inspection';
    if (source.from !== 'inspection') return 'per_inspection';
    const field = source.field as StatutoryInspectionField | undefined;
    if (field === undefined) return 'unknown';
    return PRE_INSPECTION_FACTS.has(field) ? 'pre_inspection' : 'per_inspection';
}
