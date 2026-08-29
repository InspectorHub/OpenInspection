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
    date: string | null;
}

export interface StatutoryInputs {
    results: Record<string, StatutoryItemResult>;
    facts: StatutoryInspectionFacts;
    /** Items answered ONLY under a non-default unit; the caller reports them. */
    skippedNonDefaultUnits: string[];
}

export async function gatherStatutoryInputs(
    db: DrizzleD1Database<typeof schema>,
    d1: D1Database,
    tenantId: string,
    inspection: StatutoryInspectionRow,
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
        inspection_date: inspection.date ? calendarDayForForm(inspection.date, 'inspection_date') : null,
        inspector_name: inspectorRow?.name ?? null,
        inspector_license: licenceNumber,
        company_name: config?.companyName ?? null,
        company_phone: config?.companyPhone ?? null,
    };
    return { results, facts, skippedNonDefaultUnits };
}
