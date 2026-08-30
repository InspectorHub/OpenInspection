/**
 * Everything a statutory render reads that is NOT the template's own answers.
 *
 * -- WHY THIS LEFT THE ROUTE ------------------------------------------------
 * The route decides WHETHER a form may be produced -- the revision applies, the
 * template declares it, the workspace installed it. This decides WHAT goes on
 * it, and the two are read at different moments. The route reached its size
 * ceiling; splitting on that line was better than raising it, because these
 * four reads share one property worth naming in one place: each is the SAME
 * source the report PDF uses, so the two documents cannot disagree about the
 * same inspection.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../../lib/db/schema';
import { PeopleService } from '../../services/people.service';
import { CredentialService } from '../../services/credential.service';
import { itemResultsFor } from '../../lib/statutory/item-results';
import { calendarDayForForm } from '../../lib/statutory/value-parts';
import { decodeSignatureDataUri, type SignatureImage } from '../../lib/statutory/signature-image';
import type { StatutoryFormDeclaration } from '../../types/template-schema';
import type { StatutoryInspectionFacts } from '../../lib/statutory/values';
import type { StatutoryItemResult } from '../../lib/statutory/resolve-source';

/** The inspection columns a form reads. Named rather than passed whole so a
 *  new read is a compile error at the call site rather than a silent blank. */
export interface StatutoryInspectionRow {
    id: string;
    inspectorId: string | null;
    propertyAddress: string | null;
    addressCity: string | null;
    addressState: string | null;
    addressZip: string | null;
    // NOTE: `date` is deliberately absent. The raw column holds either a
    // calendar day or a day plus an instant, and reading it here is what put a
    // full ISO timestamp into `calendarDayForForm`. The already-narrowed day
    // arrives as its own argument instead, so a caller cannot forget to narrow it.
}

export interface StatutoryInputs {
    results: Record<string, StatutoryItemResult>;
    facts: StatutoryInspectionFacts;
    /**
     * What the declaration's `from: 'signature'` bindings resolve to, by our
     * field name. Kept OUT of `facts` deliberately: `collectStatutoryValues`
     * emits no key for a signature (`values.ts`) because that object is declared
     * to carry no personal data of this class, and routing a mark through it
     * would retract that declaration in one step.
     */
    signatures: Map<string, SignatureImage>;
    /** Items answered ONLY under a non-default unit; the caller reports them. */
    skippedNonDefaultUnits: string[];
}

/**
 * The mark behind a `whole_form` signature binding: the inspector on this
 * inspection, as they saved it under Settings > Profile.
 *
 * -- WHY THE SAME COLUMN AUTO-SIGN USES --------------------------------------
 * `users.default_signature_base64` is what `lib/inspection/auto-sign.ts` puts on
 * a published report. One stored mark feeds both surfaces, so a report and the
 * authority's form can never carry two different signatures for one inspector on
 * one inspection.
 *
 * -- WHY ONLY `whole_form` RESOLVES TODAY ------------------------------------
 * `scope` exists because the Citizens four-point form lets a trade-specific
 * licensee sign only their own section, so one form can carry several marks that
 * each answer for a different part. Nothing in this product RECORDS who signed
 * for a section, so any other scope is refused by name rather than quietly
 * answered with the whole-form signer — which would put one person's mark under
 * a declaration somebody else made.
 */
async function resolveSignatures(
    db: DrizzleD1Database<typeof schema>,
    tenantId: string,
    inspectorId: string | null,
    declaration: StatutoryFormDeclaration,
): Promise<Map<string, SignatureImage>> {
    const wanted = Object.entries(declaration.bindings)
        .filter(([, source]) => source.from === 'signature') as Array<[string, { scope: string }]>;
    const signatures = new Map<string, SignatureImage>();
    if (wanted.length === 0) return signatures;

    for (const [ourField, source] of wanted) {
        if (source.scope !== 'whole_form') {
            throw new Error(
                `statutory produce: "${ourField}" is signed for scope "${source.scope}", and this `
                + 'software records no per-section signer. Bind it to scope "whole_form", or leave '
                + 'the box for the inspector to sign by hand.',
            );
        }
    }
    // Read once, after the scopes are agreed: several fields on one form may all
    // stand behind the same signer, and the row is the same row for each.
    if (!inspectorId) {
        throw new Error(
            'statutory produce: this form requires a signature and the inspection has no '
            + 'inspector assigned, so there is nobody whose mark it would be.',
        );
    }
    const row = await db.select({ signature: schema.users.defaultSignatureBase64 })
        .from(schema.users)
        .where(and(eq(schema.users.id, inspectorId), eq(schema.users.tenantId, tenantId)))
        .get();
    for (const [ourField] of wanted) {
        if (!row?.signature) {
            throw new Error(
                `statutory produce: "${ourField}" needs the inspector's signature and none is `
                + 'saved. Add one under Settings > Profile, then produce the form again.',
            );
        }
        signatures.set(ourField, decodeSignatureDataUri(row.signature, ourField));
    }
    return signatures;
}

export async function gatherStatutoryInputs(
    db: DrizzleD1Database<typeof schema>,
    d1: D1Database,
    tenantId: string,
    inspection: StatutoryInspectionRow,
    /** The inspection's calendar day, already narrowed by
     *  `calendarDayOfStoredDate`. Passed rather than read off the row: see the
     *  note on `StatutoryInspectionRow`. */
    inspectionDay: string,
    /** The template's declaration — read for its signature bindings only. */
    declaration: StatutoryFormDeclaration,
): Promise<StatutoryInputs> {
    // Re-keyed by item id, because that is what a binding names and NOT what
    // the column stores -- see `lib/statutory/item-results.ts`. Reading the raw
    // object here is how the whole form came out blank with every gate green.
    const storedResults = (await db.select()
        .from(schema.inspectionResults)
        .where(eq(schema.inspectionResults.inspectionId, inspection.id))
        .get())?.data;
    const { results, skippedNonDefaultUnits } = itemResultsFor(
        typeof storedResults === 'string' ? JSON.parse(storedResults) : storedResults,
    );

    // The client comes from the inspection_people primary-client join, NOT from
    // inspections.client_name/_email/_phone -- those were a frozen cache and are
    // gone. A hard cutover with no legacy fallback, matching invoices,
    // agreements and publish elsewhere.
    const primaryClient = await new PeopleService({ DB: d1 }).getPrimaryClient(tenantId, inspection.id);

    // The inspector's name comes from `users` and the licence from the credential
    // rows, exactly as the report PDF's signature block resolves them -- one
    // source, so the two surfaces can never disagree about the same inspector.
    //
    // NOTE ON NULL: CredentialService returns null when there is no credential,
    // and its own callers OMIT the line rather than print an empty one. That is
    // right for a report footer and wrong here. On an authority's form the box is
    // preprinted, so a blank is not "no such item" -- it is an invalid submission.
    // A null therefore reaches collectStatutoryValues and is refused there by the
    // required-field check, which is the intended behaviour.
    const inspectorId = inspection.inspectorId;
    const inspectorRow = inspectorId
        ? await db.select({ name: schema.users.name })
            .from(schema.users)
            .where(and(eq(schema.users.id, inspectorId), eq(schema.users.tenantId, tenantId)))
            .get()
        : undefined;
    const licenceNumber = inspectorId
        ? await new CredentialService(d1).primaryLicenseNumber(tenantId, inspectorId)
        : null;

    // The company identity is the workspace config, read the same way the
    // publish path reads its branding.
    const config = await db.select({
        companyName: schema.tenantConfigs.companyName,
        companyPhone: schema.tenantConfigs.companyPhone,
    })
        .from(schema.tenantConfigs)
        .where(eq(schema.tenantConfigs.tenantId, tenantId))
        .get();

    const facts: StatutoryInspectionFacts = {
        client_name: primaryClient?.name ?? null,
        client_email: primaryClient?.email ?? null,
        client_phone: primaryClient?.phone ?? null,
        property_address: inspection.propertyAddress ?? null,
        property_city: inspection.addressCity ?? null,
        property_state: inspection.addressState ?? null,
        property_zip: inspection.addressZip ?? null,
        // Formatted for the FORM, not for this workspace -- see
        // `calendarDayForForm`. Rendered raw it printed "2026-08-20" in a Texas
        // TREC Date of Inspection box.
        //
        // ⚠️ This is the whole-field format. A map that DRAWS this fact as
        // separate blanks would hand `partOfValue` an already-formatted string
        // and be refused, by name, at render time. No published map does today
        // (every parted field on the 1802 is a permit date, which comes from an
        // item); the day one does, the format belongs on that map beside its
        // coordinates rather than here.
        inspection_date: calendarDayForForm(inspectionDay, 'inspection_date'),
        inspector_name: inspectorRow?.name ?? null,
        inspector_license: licenceNumber,
        company_name: config?.companyName ?? null,
        company_phone: config?.companyPhone ?? null,
    };
    // Last, because it is the only read here that can REFUSE, and a refusal
    // naming a missing signature is more useful once everything else resolved.
    const signatures = await resolveSignatures(db, tenantId, inspection.inspectorId, declaration);
    return { results, facts, signatures, skippedNonDefaultUnits };
}
