/**
 * Neutral platform disclosure shown ALONGSIDE an inspection agreement.
 *
 * Rewritten on counsel's advice, received 2026-08-02. An earlier design embedded
 * InterNACHI's governing-language clause into the agreement body. Counsel: "do
 * not embed the InterNACHI clause as platform contractual language — if
 * implemented, position it as a neutral platform disclosure."
 *
 * A governing-language provision allocates risk between the tenant and their
 * client. We are not a party to that contract, we author none of its text, and
 * we control none of its terms. Inserting one would have made it the only
 * contractual language we wrote, in the one document where we deliberately
 * write none.
 *
 * So: this states a fact and decides nothing. No "governs", no "prevails", no
 * responsibility for a translation's accuracy. A tenant who wants a
 * governing-language clause puts it in THEIR agreement text — that is theirs to
 * write, and nothing here should look like we already wrote it for them.
 *
 * ## Why the wrapper matters
 *
 * The copy is a `<section role="note">`, and that is load-bearing rather than
 * decorative. `agreements.content` is TENANT data whose write-time sanitizer
 * (`server/services/agreement/sanitizer.ts`) allows only the Quill toolbar's
 * tags — no `<section>`, no `role`. So the disclosure cannot pass through the
 * agreement pipeline and come out intact: composed into the body it arrives as
 * an anonymous paragraph among the terms, which is exactly the reading counsel
 * ruled out. The shape is what makes the wrong thing visibly wrong, and
 * `tests/unit/agreements/language-disclosure.spec.ts` asserts both halves —
 * that the agreement sanitizer destroys it, and that nothing on the
 * agreement-body path imports this module.
 *
 * A renderer therefore must NOT reuse `<SanitizedHtml>`: its allow-list is the
 * tenant-content one and would silently eat the wrapper. Use
 * `DISCLOSURE_SANITIZER_PROFILE` below, which round-trips this copy unchanged.
 *
 * ## Why a versioned constant and not a message key
 *
 * This is platform legal copy: changing it is a deliberate act with a version
 * bump, not a string edited inside a component or retranslated by a catalogue
 * pass. The agreement itself stays English and is never translated here — the
 * disclosure is how an English-only agreement is handled honestly, not a step
 * toward translating one.
 *
 * ## What is NOT settled — read before extending this (counsel, 2026-08-02)
 *
 * **California Civil Code §1632 is unresolved.** Counsel gave a preliminary
 * position only: applicability turns on whether the agreement falls in an
 * enumerated contract category AND whether the transaction was primarily
 * negotiated in a covered language. Three facts were requested and supplied
 * (`docs/legal/2026-08-02-counsel-response-and-followup.md`):
 *
 *  1. **Negotiation language: we hold no record of it**, and that absence is the
 *     honest answer rather than a gap to paper over. Nothing captures it, and
 *     the negotiation itself is typically a phone call outside the software.
 *     `contacts.locale` is a stated READING preference and must not be offered
 *     as evidence of the language a deal was struck in.
 *  2. **Platform role: not a party.** We carry the agreement and attest to the
 *     signing. We do not negotiate, advise, or take a fee from the transaction.
 *  3. **Template/control: none.** Every tenant authors their own agreement body
 *     and versions it; we review no terms. Which is why the clause would have
 *     been the ONLY contractual text we wrote in that document.
 *
 * The disclosure below did NOT wait on that answer, and deliberately: it asserts
 * nothing contractual, so it is useful under either §1632 answer and harmful
 * under neither.
 *
 * **What DOES wait on it: translated agreements.** If §1632 reaches this
 * contract type the build is a different one — translated versions, a
 * language-of-negotiation record, a per-state rule — and none of it may be
 * started on an assumption about the answer. If you arrived here intending to
 * translate the agreement body, that is the work this note is about, and the
 * §1632 answer is its gate. Translating the disclosure is not a route around it.
 *
 * **One question is deliberately unasked.** If a tenant later offers a courtesy
 * Spanish REPORT, does that report's own limitations notice suffice, or does the
 * agreement need a companion sentence? It goes to counsel when the
 * courtesy-translation work is scheduled and not before — the answer depends on
 * what that notice ends up saying, so asking early buys an answer to the wrong
 * question. Whoever schedules that work owns asking it.
 */

/** Version of the disclosure copy. Bump on ANY wording change, `label` included. */
const DISCLOSURE_VERSION = 1;

export const AGREEMENT_LANGUAGE_DISCLOSURE = Object.freeze({
    version: DISCLOSURE_VERSION,
    /**
     * Plain-text heading every renderer puts directly above `html`. It is part of
     * the disclosure, not chrome a component chose: the whole instruction from
     * counsel is about POSITION, and this sentence is what makes the position
     * legible to a reader who is not going to reason about borders and type
     * sizes. Kept here rather than in each renderer so the signing screen and the
     * archived copy cannot drift apart, and out of the message catalogue for the
     * same reason `html` is — versioned platform copy, not a translatable string.
     */
    label: 'Not part of this agreement',
    html: [
        '<section class="agreement-language-disclosure" role="note">',
        '<p>This agreement is provided in English. If you would prefer to review ',
        'it in another language, you may wish to have it translated before signing.</p>',
        '</section>',
    ].join(''),
});

/**
 * The allow-list a renderer must sanitize the disclosure with — plain block
 * elements plus the wrapper, and nothing that can carry a payload or a link.
 * Deliberately narrower than a general-purpose profile: this markup is ours and
 * fixed, so the profile is sized to exactly the copy above.
 */
export const DISCLOSURE_SANITIZER_PROFILE = Object.freeze({
    ALLOWED_TAGS: Object.freeze(['section', 'p', 'strong', 'em', 'br']),
    ALLOWED_ATTR: Object.freeze(['class', 'role']),
});

/**
 * May an EVIDENCE surface — the archived copy, the public verifier — print the
 * copy above against this set of signatures?
 *
 * Only when every signature recorded the version that is in this file right
 * now. `versions` is one entry per SIGNED signer, taken from
 * `agreement_signers.language_disclosure_version`.
 *
 * The rule is narrow on purpose. Superseded copy is not archived anywhere: a
 * bump replaces the string, and there is no table of old ones. So for a
 * signature that recorded version N < current, the honest options are "print
 * nothing" and "print a sentence this person never saw", and the second is a
 * claim the record cannot support — precisely the claim a dispute would be
 * about. NULL (no version recorded — a pre-feature signature, or a surface the
 * platform did not draw) fails the same way and for the same reason.
 *
 * A signing SURFACE must not consult this: it shows the current copy to a
 * person standing in front of it, which is always truthful, and it is what puts
 * the version on the record in the first place.
 */
export function signaturesRecordCurrentDisclosure(
    versions: ReadonlyArray<number | null | undefined>,
): boolean {
    // No signatures = nothing to vouch for. An empty set trivially satisfying
    // "every" would print the copy onto a document nobody signed.
    if (versions.length === 0) return false;
    return versions.every((v) => v === DISCLOSURE_VERSION);
}
