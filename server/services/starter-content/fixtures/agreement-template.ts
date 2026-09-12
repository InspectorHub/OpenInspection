/**
 * One generic pre-inspection agreement template seeded into every new trial
 * tenant. The body opens with a bolded warning paragraph that calls out the
 * legal-advice caveat + jurisdiction-specific requirements — tenants are
 * expected to replace the template with their own attorney-reviewed copy
 * before using it on a real customer engagement.
 *
 * ── THE BODY IS HTML, AND THAT IS NOT A PREFERENCE ──────────────────────────
 *
 * F46: this fixture used to be MARKDOWN (`## `, `### `, `**bold**`, `- ` list
 * items) and the customer-facing signing page showed it verbatim: every new
 * trial tenant's default agreement reached a signer as one run-on paragraph
 * reading `** ⚠ Review before sending…** … ## Pre-Inspection Agreement … -
 * Roof, exterior, structure`. Headings were not headings, bold was not bold,
 * and lists were not lists, on the one document in this product a client is
 * asked to be bound by.
 *
 * The pipeline was not the thing that was wrong. There is no Markdown renderer
 * anywhere in this repository, and the whole agreement path is HTML end to end:
 * the author writes in `AgreementRichText` (a toolbar of exactly bold / italic /
 * underline / h2 / h3 / ul / ol), `normalizeAgreementHtml()` converges that onto
 * a ten-tag subset, `sanitizeAgreementHtml()` is the write-time boundary,
 * `<SanitizedHtml>` + DOMPurify render it, and `ih-agreement-prose` in
 * app/styles/tailwind.css styles `h2`/`h3`/`ul` because those are the tags that
 * are supposed to arrive. Adding a Markdown renderer would mean a SECOND
 * document format reaching a signer, each with its own escaping rules, to serve
 * one seeded fixture. The seed was simply written in the wrong format.
 *
 * ── CONSTRAINTS ON EDITING THIS BODY ────────────────────────────────────────
 *
 *  - Only these tags: `p`, `h2`, `h3`, `ul`, `ol`, `li`, `strong`, `em`, `u`,
 *    `br`. No attributes at all — not even `class`.
 *  - NEVER `<a>`, `<img>` or `<svg>`: all three are stripped on the way to a
 *    signer (two sanitizers, independently), so a link in here is a clause that
 *    silently loses its reference.
 *  - No whitespace between block tags. The body is asserted to be a fixed point
 *    of BOTH `sanitizeAgreementHtml()` and the editor's `normalizeAgreementHtml()`
 *    — i.e. seeding it, opening it in the editor and saving it unchanged must not
 *    alter a byte. `tests/unit/agreements/starter-agreement-markup.spec.ts` is
 *    what holds that, including a direct check that no Markdown syntax is back.
 */

const DISCLAIMER_PARAGRAPH =
    '<p><strong>⚠️ Review before sending to real customers.</strong> This template is provided as a ' +
    'starting point only and is <strong>not legal advice</strong>. Pre-inspection agreement requirements ' +
    'vary by state, province, and country (e.g. mandated disclosures, license numbers, ' +
    'scope-of-work limits, liability caps, statutory cancellation rights). Replace this ' +
    'paragraph and customize the full document for your jurisdiction. Consult a licensed ' +
    'attorney in your area before using this template on a real customer engagement.</p>';

/**
 * Joined with NO separator: the blocks are adjacent in the stored document, and
 * the array is only here so the source stays readable. Whitespace between block
 * tags would be dropped by the editor's normaliser on the author's first save,
 * which would make the stored document differ from this fixture for no reason.
 */
const AGREEMENT_BODY = [
    DISCLAIMER_PARAGRAPH,

    '<h2>Pre-Inspection Agreement</h2>',
    '<p>This agreement is between [INSPECTOR_NAME] ("Inspector") and [CUSTOMER_NAME] ("Client") for a home inspection of the property at [PROPERTY_ADDRESS] on [INSPECTION_DATE].</p>',

    '<h3>1. Scope of Inspection</h3>',
    '<p>The Inspector will perform a visual, non-invasive inspection of the readily accessible installed systems and components of the property, including:</p>',
    '<ul>',
    '<li>Roof, exterior, structure</li>',
    '<li>Plumbing</li>',
    '<li>Electrical</li>',
    '<li>HVAC</li>',
    '<li>Interior</li>',
    '<li>Basement / crawlspace (as accessible)</li>',
    '</ul>',

    '<h3>2. What is NOT Covered</h3>',
    '<p>This inspection is <strong>not</strong> a code compliance review, warranty, insurance policy, or guarantee of any kind. The following are explicitly excluded:</p>',
    '<ul>',
    '<li>Cosmetic conditions</li>',
    '<li>Future or latent defects</li>',
    '<li>Pest infestations (recommend separate pest inspection)</li>',
    '<li>Mold testing (recommend separate mold inspection)</li>',
    '<li>Environmental hazards (asbestos, lead, radon)</li>',
    '<li>Buried, concealed, or otherwise inaccessible items</li>',
    '</ul>',

    '<h3>3. Payment</h3>',
    '<p>Inspection fee: $[AMOUNT]. Payable on the day of inspection unless otherwise agreed.</p>',

    '<h3>4. Limitation of Liability</h3>',
    '<p>[INSERT JURISDICTION-APPROPRIATE LIMITATION OF LIABILITY CLAUSE HERE. Most jurisdictions cap inspector liability at the inspection fee. Consult an attorney.]</p>',

    '<h3>5. Client Acknowledgment</h3>',
    "<p>The Client acknowledges that the Inspector is not an insurer, guarantor, or warrantor of the conditions of the property and that this inspection is for the Client's benefit only.</p>",

    '<p>Signed: [CLIENT_SIGNATURE_BLOCK]<br>Date: [SIGN_DATE]</p>',
].join('');

export interface StarterAgreementFixture {
    name:    string;
    content: string;
}

export const AGREEMENT_TEMPLATE: StarterAgreementFixture = {
    name:    'Generic Pre-Inspection Agreement (review & customize before sending)',
    content: AGREEMENT_BODY,
};
