/**
 * Can ANYBODY in this workspace produce this form? Asked at install time.
 *
 * ── THE STANDARD THIS APPLIES, AND WHOSE IT IS ──────────────────────────────
 * `statutory-import.ts` already refuses an install when the authority's PDF is
 * absent, and states the reason in one phrase: an unchecked install is exactly
 * the "installed but unusable" state. This asks the same question about the
 * other half of the inputs -- the ones that live on a profile rather than in R2
 * -- and applies the same standard, deliberately, rather than inventing a
 * stricter one.
 *
 * So the bar is NOBODY, not EVERYBODY. A workspace where one inspector has a
 * licence number and three have not is a workspace that can produce this form;
 * blocking it would be a gate on work somebody can already do. A workspace
 * where nobody has one has installed a template that cannot render for any
 * inspection anyone creates -- and the person who finds out is an inspector,
 * mid-job, after publishing a report to a client. That was measured against
 * production on 2026-09-05.
 *
 * ── WHY NOT EVERY MISSING FACT ──────────────────────────────────────────────
 * Only PRE-INSPECTION facts are asked about (`fact-provenance.ts`). A form also
 * requires the owner's name and a signing date, and neither exists before an
 * inspection does; refusing an install over them would refuse every install.
 */
import { and, eq, isNull, ne, inArray } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { users, inspectorCredentials } from '../../lib/db/schema';
import { isPreInspectionFact, provenanceOfBinding } from '../../lib/statutory/fact-provenance';
import type { FieldMap } from '../../lib/statutory/field-map';
import type { StatutoryFormDeclaration } from '../../types/template-schema';

/** One form field nobody in this workspace can currently supply. */
export interface UnsuppliableField {
    /** The form's own field name, as a refusal would name it. */
    field: string;
    /** The fact behind it -- what a settings screen actually edits. */
    fact: string;
}

/**
 * Which of the form's required fields NO active member can supply today.
 *
 * Agents are excluded for the reason `readiness.ts` gives: they are not people
 * who sign inspections, so counting them would make a workspace look staffed
 * for a form none of them can produce.
 */
export async function unsuppliableRequiredFields(
    // Loose schema generic on purpose: this reads `users` and
    // `inspector_credentials` through imported table objects rather than
    // `db.query`, so the generic buys nothing here -- and requiring the
    // typed one would force a cast at every marketplace call site, which is
    // a worse trade than a generic nobody uses.
    db: DrizzleD1Database<Record<string, unknown>>,
    tenantId: string,
    map: FieldMap,
    declaration: StatutoryFormDeclaration,
): Promise<UnsuppliableField[]> {
    // Which required fields are profile-level at all. Read through the template's
    // BINDINGS, never the field name -- TREC's `inspector_license_number` binds
    // to the fact `inspector_license`, and a name-based guess asks about a fact
    // that does not exist.
    const wanted: UnsuppliableField[] = [];
    for (const field of map.requiredFields) {
        const source = declaration.bindings[field];
        if (provenanceOfBinding(source) !== 'pre_inspection') continue;
        // A literal is authored into the declaration and always supplied.
        if (source?.from !== 'inspection') continue;
        const fact = (source as { field?: string }).field;
        if (fact !== undefined && isPreInspectionFact(fact)) {
            wanted.push({ field, fact });
        }
    }
    if (wanted.length === 0) return [];

    const members = await db
        .select({
            id: users.id,
            name: users.name,
            licenseType: users.statutoryLicenseType,
            qualification: users.statutoryQualification,
        })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), isNull(users.deletedAt), ne(users.role, 'agent')));
    if (members.length === 0) {
        // No members at all is a different fault and not this one's to report.
        return [];
    }

    // One query for every member's licence numbers rather than one per member.
    const credentials = members.length > 0
        ? await db
            .select({ userId: inspectorCredentials.userId, memberNumber: inspectorCredentials.memberNumber })
            .from(inspectorCredentials)
            .where(and(
                eq(inspectorCredentials.tenantId, tenantId),
                eq(inspectorCredentials.active, true),
                inArray(inspectorCredentials.userId, members.map((m) => m.id)),
            ))
        : [];
    const withLicence = new Set(
        credentials.filter((c) => (c.memberNumber ?? '').trim() !== '').map((c) => c.userId),
    );

    const filled = (v: string | null | undefined): boolean => (v ?? '').trim() !== '';
    const anyMemberHas = (fact: string): boolean => members.some((mem) => {
        switch (fact) {
            case 'inspector_name': return filled(mem.name);
            case 'inspector_license': return withLicence.has(mem.id);
            case 'inspector_license_type': return filled(mem.licenseType);
            case 'inspector_qualification': return filled(mem.qualification);
            // `company_name` / `company_phone` are workspace config, not a
            // member's. They are not asked about here: this function answers
            // "can any PERSON supply it", and answering a workspace question
            // with a per-member scan would be right by accident.
            default: return true;
        }
    });

    return wanted.filter((w) => !anyMemberHas(w.fact));
}

/**
 * The refusal, written for the person who meets it -- an owner installing a
 * template, who is also the person who can fix it.
 *
 * It names the SCREEN, not the column. A message that says
 * `users.statutory_license_type` tells the reader where our code keeps the
 * value rather than where they go to change it.
 */
export function unsuppliableRefusal(
    formId: string,
    revision: string,
    gaps: readonly UnsuppliableField[],
): string {
    const names = gaps.map((g) => g.field).join(', ');
    return `Revision ${revision} of ${formId} requires ${names}, and nobody in this workspace `
        + 'has supplied that yet. Those come from an inspector\'s own profile — their name, and '
        + 'the state licence under Settings → Profile — so they are the same on every inspection '
        + 'and can be set once, now. Installing first would produce a template that renders for '
        + 'nobody, and the first person to find out would be an inspector who had already '
        + 'published a report to a client. Nothing was installed.';
}
