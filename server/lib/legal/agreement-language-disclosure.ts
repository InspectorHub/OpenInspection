/**
 * Neutral platform disclosure shown ALONGSIDE an inspection agreement.
 *
 * An earlier design embedded a governing-language clause into the agreement
 * body. That was withdrawn, and the reason is the invariant this module exists
 * to hold.
 *
 * A governing-language provision allocates risk between the inspector and their
 * client. The platform is not a participant in that allocation: it carries the
 * document, it authors none of its text, and it controls none of its terms.
 * Inserting such a clause would make it the only contractual language the
 * platform wrote, in the one document where it deliberately writes none.
 *
 * So: this states a fact and decides nothing. No "governs", no "prevails", no
 * responsibility for a translation's accuracy. An inspector who wants a
 * governing-language clause puts it in THEIR agreement text — that is theirs to
 * write, and nothing here should look like the platform already wrote it for
 * them.
 *
 * ## Why the wrapper matters
 *
 * The copy is a `<section role="note">`, and that is load-bearing rather than
 * decorative. `agreements.content` is TENANT data whose write-time sanitizer
 * (`server/services/agreement/sanitizer.ts`) allows only the Quill toolbar's
 * tags — no `<section>`, no `role`. So the disclosure cannot pass through the
 * agreement pipeline and come out intact: composed into the body it arrives as
 * an anonymous paragraph among the terms, which is exactly the reading this
 * design rules out. The shape is what makes the wrong thing visibly wrong, and
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
 * ## Read before extending this
 *
 * The disclosure states a FACT and makes no contractual assertion. That is what
 * keeps it safe to ship without a jurisdiction-by-jurisdiction analysis behind
 * it, and it is the property to preserve: the moment this block says which text
 * governs, prevails, or controls, it stops being a notice and becomes a term in
 * a contract between two parties the platform is not one of. The tests next to
 * this file enforce that as a word list, on both the sentence and the heading.
 *
 * **Translating the agreement BODY is a different feature, not a bigger version
 * of this one.** It needs translated versions, a record of the language a deal
 * was actually negotiated in, and per-jurisdiction rules — none of which exist
 * here, and none of which should be started from this file. Translating the
 * disclosure is not a route around that. Deployments with a language-specific
 * statutory obligation should get their own legal advice; this module does not
 * encode one, and deliberately so.
 */

/** Version of the disclosure copy. Bump on ANY wording change, `label` included. */
const DISCLOSURE_VERSION = 1;

export const AGREEMENT_LANGUAGE_DISCLOSURE = Object.freeze({
    version: DISCLOSURE_VERSION,
    /**
     * Plain-text heading every renderer puts directly above `html`. It is part of
     * the disclosure, not chrome a component chose: the whole point is POSITION
     * — that this block sits beside the agreement and not inside it — and this
     * sentence is what makes the position
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
