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

/** Field-name shapes that name a person rather than a property. */
const PERSON_SHAPED = /(^|_)(name|email|phone|address|dob|birth|ssn)(_|$)/i;

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
