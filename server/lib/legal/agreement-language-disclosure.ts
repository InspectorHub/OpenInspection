/**
 * Neutral platform disclosure shown ALONGSIDE an inspection agreement.
 *
 * Rewritten on counsel's advice. An earlier design embedded InterNACHI's
 * governing-language clause into the agreement body. Counsel: "do not embed the
 * InterNACHI clause as platform contractual language — if implemented, position
 * it as a neutral platform disclosure."
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
 */

/** Version of the disclosure copy. Bump on ANY wording change. */
const DISCLOSURE_VERSION = 1;

export const AGREEMENT_LANGUAGE_DISCLOSURE = Object.freeze({
    version: DISCLOSURE_VERSION,
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
