/**
 * What a statutory form's bindings may not do with personal data.
 *
 * `statutory_form_entries.values` is declared to carry none, and that
 * declaration is worth exactly what enforces it. The first person to bind an
 * owner's name as a literal would put personal data into an unclassified JSON
 * blob with every existing gate green -- the same failure this repository has
 * already seen with translated report content and newsletter subscribers.
 *
 * The rule is about the ROUTE, not the value. A person-shaped field is fine when
 * it arrives through `from: 'inspection'` (resolved at render time from rows that
 * are already classified) or `from: 'signature'` (a reference that never enters
 * the values). Every other route ends with the value stored here, so every other
 * route is refused.
 *
 * -- WHY `property_address` IS MATCHED AND STILL ALLOWED ---------------------
 * The shape test is deliberately blunt, so `property_address` trips it. That is
 * wanted: it passes only because `from: 'inspection'` is a safe route, and the
 * day somebody rebinds it as a literal the refusal is exactly right. Narrowing
 * the pattern to exempt the name would trade a live check for a spelling.
 */
import type { StatutoryFormDeclaration } from '../../types/template-schema';

/**
 * Field-name shapes that name a person rather than a property.
 *
 * -- THE SHAPE THIS IS TRYING TO CATCH ---------------------------------------
 * The first version of this list was the words a person's data is usually
 * called by, and it missed four of the OIR-B1-1802's own field names --
 * `owner_city`, `owner_zip`, `owner_county` and `contact_person`. They are
 * plainly the owner's postal address and the owner's named contact, and none of
 * them contains the word "address" or the word "name". The list was a list of
 * SPELLINGS, and the categories below are what it was reaching for:
 *
 *   WHO      a person, by name or by the role they fill. A person can be named
 *            without the word "name" on the field -- an authority's form asks
 *            for a "Contact person", a "Signer", an "Occupant".
 *   REACH    how to contact them.
 *   WHERE    where they live. AN ADDRESS IS NOT ONE TOKEN. A form that prints
 *            the owner block as separate boxes -- street, city, county, state,
 *            ZIP -- names each part on its own, and a pattern that knows only
 *            the word "address" is blind to every one of them. Leaving any part
 *            out re-opens the hole one line further down.
 *   WHO THEY ARE  identifiers that are about the person themselves.
 *
 * -- ON `state`, `county` AND THE BLUNTNESS THAT IS DELIBERATE ---------------
 * A county or a state can belong to the property rather than to a person, the
 * same way `property_address` can. That does not earn an exemption, for the
 * reason given above about `property_address`: the property's own facts already
 * travel by `from: 'inspection'`, which this policy allows, so a blunt match
 * costs a correctly-bound field nothing and catches a wrongly-bound one. The
 * refusal message names the escape hatch for the genuine false positive.
 *
 * Measured when the four shapes were added: across the four published statutory
 * templates -- 337 bindings, 313 distinct field names named by a map -- the
 * wider pattern newly matches exactly those four names and produces ZERO new
 * refusals, because no existing binding of a person-shaped field uses an unsafe
 * route.
 */
const PERSON_SHAPED = new RegExp(`(^|_)(${[
    // WHO
    'name', 'person', 'contact', 'signer', 'occupant', 'resident', 'applicant', 'insured',
    // REACH
    'email', 'phone', 'fax', 'mobile', 'cell',
    // WHERE -- every component of a postal address, not just the word for all of them
    'address', 'street', 'city', 'county', 'state', 'province', 'country',
    'zip', 'zipcode', 'postcode', 'postal',
    // WHO THEY ARE
    'dob', 'birth', 'birthdate', 'ssn',
].join('|')})(_|$)`, 'i');

/** Routes that resolve outside the stored values. Everything else is refused. */
const SAFE_ROUTES = new Set(['inspection', 'signature']);

export function assertNoPersonalDataOutsideBindings(
    declaration: StatutoryFormDeclaration,
): void {
    for (const [ourField, source] of Object.entries(declaration.bindings)) {
        if (!PERSON_SHAPED.test(ourField)) continue;
        if (SAFE_ROUTES.has(source.from)) continue;
        throw new Error(
            `statutory binding policy: "${ourField}" names a person and is bound via `
            + `"${source.from}", which stores the value in statutory_form_entries. Personal `
            + 'data reaches a form through from: "inspection" (resolved at render time) or '
            + 'from: "signature" (a reference). Rebind it, or rename the field if it does '
            + 'not actually name a person.',
        );
    }
}
