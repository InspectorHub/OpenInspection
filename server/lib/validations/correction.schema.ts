import { z } from 'zod';

/**
 * A request to correct a field of a record that has already been delivered.
 *
 * ── Why the list is this short, and why the client's NAME is not on it ──────
 * Publishing a report freezes the `inspections` row into a signed, hash-chained
 * snapshot (`ReportVersionService.snapshotOnPublish`). Anything inside that
 * snapshot is a copy that no later edit can reach, which is exactly why
 * correcting it needs a new version. Anything OUTSIDE it is resolved live on
 * every read and corrects itself the moment the source row changes.
 *
 * The people on an inspection are the second kind: `inspections` carries no
 * client columns at all any more (they were dropped in favour of
 * `inspection_people` → `contacts`), and every reader joins the contact at read
 * time. Correcting a contact's name therefore reaches every surface already,
 * and routing it through an amendment would publish a new version that differs
 * from its predecessor in nothing.
 *
 * So this enum holds the record's own frozen fields. Adding to it is a
 * decision: a field belongs here when, and only when, it is inside the
 * snapshot.
 */
// Not exported: `CorrectableField` below is the type callers need, and the
// literal list is only meaningful together with the schema that validates
// against it. Export it when an endpoint has to render the choices.
const CORRECTABLE_FIELDS = [
    'propertyAddress',
    'addressStreet',
    'addressCity',
    'addressState',
    'addressZip',
] as const;

export type CorrectableField = typeof CORRECTABLE_FIELDS[number];

/** The fields the record refuses to hold empty. */
const REQUIRED_FIELDS: readonly CorrectableField[] = ['propertyAddress'];

export function correctionRequiresValue(field: CorrectableField): boolean {
    return REQUIRED_FIELDS.includes(field);
}

export const CorrectReportSchema = z.object({
    tenantId:     z.string().min(1),
    inspectionId: z.string().min(1),
    field:        z.enum(CORRECTABLE_FIELDS),
    /** The replacement value. Empty clears an optional field; the service
     *  refuses an empty one for a field the record requires. */
    to:           z.string().max(320),
    /**
     * Why the correction was made, in the words that will be published.
     *
     * Stored as the version's amendment reason and shown to whoever reads the
     * report's amendment trail, so it is required — an amendment with no
     * stated reason is a change nobody can account for later.
     */
    reason:       z.string().min(1).max(500),
    /** users.id of whoever carried it out. Recorded on the published version. */
    correctedBy:  z.string().min(1),
    /**
     * Keys the caller proposes to leave uncorrected for now.
     *
     * Present so that asking is REFUSED rather than silently honoured — see
     * `assertNothingDeferred`. There is no value of this field that succeeds
     * except the empty list.
     */
    deferKeys:    z.array(z.string()).optional(),
});

export type CorrectReportInput = z.infer<typeof CorrectReportSchema>;
