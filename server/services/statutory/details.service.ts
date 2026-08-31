/**
 * The inspection-level answers only an authority's form has ever asked for.
 *
 * -- WHAT LIVES HERE AND WHY IT IS NOT SOMEWHERE ELSE ------------------------
 * Three homes were already available and none of them fits:
 *
 *   - `inspections`. 76 columns against D1's hard limit of 100, with the column
 *     ratchet starting at 85. Eight more would leave one column of headroom on
 *     the table every feature touches, to serve a document most deployments
 *     never produce.
 *   - `statutory_form_entries.values`. Declared to carry NO personal data, and
 *     `binding-policy.ts` enforces the declaration. Six of these eight fields
 *     are a named person's contact details.
 *   - `inspection_results`. Those are answers to the TEMPLATE's items, keyed by
 *     item id. None of these is an item on any template, because none of them
 *     is a thing the inspector observed at the property.
 *
 * -- 🔴 THE OWNER IS NEVER DEFAULTED FROM THE CLIENT -------------------------
 * A buyer commissions the inspection and the seller owns the house. That is the
 * ordinary case, not the edge one, and every gate would stay green while the
 * wrong person's name printed on a state form -- `binding-policy.ts` judges the
 * ROUTE a value takes and has no opinion about who the value names. So nothing
 * here reads `inspection_people`, and a blank owner stays blank.
 *
 * -- EMPTY CLEARS, IT DOES NOT STORE ----------------------------------------
 * A field submitted empty is stored as NULL rather than as `''`. On a statutory
 * form those two are the same picture -- an empty box -- but they are different
 * facts here, and the one that means "nobody has filled this in" is the one the
 * column should hold. Trimming is deliberate for the same reason: a name that
 * is one space is not an answer.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../../lib/db/schema';

/**
 * What one inspection has recorded, in the shape the panel reads and writes.
 *
 * Named keys rather than the row: the row also carries ids and a timestamp,
 * which the panel has no business round-tripping.
 */
export interface StatutoryDetails {
    inspectorSignatureDate: string | null;
    employeePrintedName: string | null;
    ownerName: string | null;
    ownerEmail: string | null;
    ownerMailingAddress: string | null;
    ownerHomePhone: string | null;
    ownerWorkPhone: string | null;
    ownerCellPhone: string | null;
}

/** Nothing recorded yet, which is the state every inspection starts in. */
const NO_STATUTORY_DETAILS: StatutoryDetails = {
    inspectorSignatureDate: null,
    employeePrintedName: null,
    ownerName: null,
    ownerEmail: null,
    ownerMailingAddress: null,
    ownerHomePhone: null,
    ownerWorkPhone: null,
    ownerCellPhone: null,
};

/** The keys, once, so the reader and the writer cannot disagree about them. */
const FIELDS = Object.keys(NO_STATUTORY_DETAILS) as Array<keyof StatutoryDetails>;

function cleaned(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

export class StatutoryDetailsService {
    constructor(private db: DrizzleD1Database<typeof schema>) {}

    /** Absent is a real state and answers with every field null. */
    async get(tenantId: string, inspectionId: string): Promise<StatutoryDetails> {
        const row = await this.db.select()
            .from(schema.statutoryInspectionDetails)
            .where(and(
                eq(schema.statutoryInspectionDetails.tenantId, tenantId),
                eq(schema.statutoryInspectionDetails.inspectionId, inspectionId),
            ))
            .get();
        if (!row) return { ...NO_STATUTORY_DETAILS };
        const out = { ...NO_STATUTORY_DETAILS };
        for (const field of FIELDS) out[field] = row[field] ?? null;
        return out;
    }

    /**
     * Write a partial answer, leaving untouched what the caller did not send.
     *
     * A PATCH of one field must not blank the other seven, which is what a
     * whole-row write of the panel's current state would do the moment two
     * people have the inspection open. So the stored row is read first and the
     * submitted keys are laid over it — the ABSENT key is what says "leave it",
     * and an explicitly empty one is what says "clear it".
     */
    async save(
        tenantId: string,
        inspectionId: string,
        patch: Partial<Record<keyof StatutoryDetails, string | null | undefined>>,
        now: number,
    ): Promise<StatutoryDetails> {
        const current = await this.get(tenantId, inspectionId);
        const next = { ...current };
        for (const field of FIELDS) {
            if (!Object.hasOwn(patch, field)) continue;
            next[field] = cleaned(patch[field]);
        }
        await this.db.insert(schema.statutoryInspectionDetails)
            .values({
                id: crypto.randomUUID(),
                tenantId,
                inspectionId,
                ...next,
                updatedAt: new Date(now),
            })
            .onConflictDoUpdate({
                target: [
                    schema.statutoryInspectionDetails.tenantId,
                    schema.statutoryInspectionDetails.inspectionId,
                ],
                set: { ...next, updatedAt: new Date(now) },
            });
        return next;
    }
}
