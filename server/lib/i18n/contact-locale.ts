/**
 * Which language a contact should be addressed in.
 *
 * A notification is rendered FOR a recipient, and the recipient's language is
 * not the request's language — in a cron or queue context there is no request
 * at all. So the answer cannot come from the ambient locale; it has to be
 * resolved from what we know about that person. This module is the one place
 * that decision is made, so it can be changed once rather than at every
 * sender.
 *
 * PRECEDENCE, highest first:
 *   1. `contactLocale`     — what the contact told us themselves.
 *   2. `linkedUserLocale`  — the locale on the account a contact is bound to
 *                            (`contacts.agent_user_id`); an explicit choice
 *                            too, just made in a different place.
 *   3. `tenantDefault`     — the company's configured locale.
 *   4. `acceptLanguage`    — the browser hint from the request, when there is
 *                            one. Weakest: it describes a device, not a person.
 *   5. `'en'`              — the base locale.
 *
 * Each level FALLS THROUGH when it is absent OR names a language we have no
 * messages for: a contact who stored `fr-FR` gets the tenant's language, not a
 * page of untranslated keys. Never treat NULL at any level as English — the
 * absence is the thing that makes a stored value evidence of demand.
 */

import { isValidLocale } from '../locale';

/**
 * The locales the compiled message catalogue actually covers.
 *
 * Restated here rather than imported: `server/` may not import
 * `app/paraglide/**` (BFF boundary, enforced by `no-restricted-imports`), and
 * the only sanctioned crossing is the message wrapper. The equality with
 * `project.inlang/settings.json` is asserted by
 * `tests/unit/contacts/contact-locale.spec.ts`, because a resolver that
 * returns a locale with no messages behind it degrades to English silently.
 *
 * This constant is also read by the booking UI (`app/components/booking/
 * LanguageChoice.tsx`) so the options offered and the values accepted are one
 * list. That makes this module part of the browser bundle: keep it PURE — no
 * DB, no bindings, no `app/paraglide` — exactly as `server/lib/people/
 * capabilities.ts` is kept.
 */
export const SUPPORTED_CONTACT_LOCALES = ['en', 'es-419'] as const;

/** A locale the product can actually speak. */
export type ContactLocale = (typeof SUPPORTED_CONTACT_LOCALES)[number];

/** The base locale, used when nothing else resolves. Module-local: exporting it
 *  with no consumer is a knip finding, and the resolver is the only caller. */
const DEFAULT_CONTACT_LOCALE: ContactLocale = 'en';

/**
 * A BCP-47 tag reduced to a locale we have messages for, or `null` when we
 * have none. Matching is by LANGUAGE subtag, so a regional variant lands on
 * its regional catalogue: `es-MX` and `es-CL` both resolve to `es-419`,
 * because the alternative is answering a Spanish speaker in English over a
 * country code.
 *
 * Exported because collection sites need the same reduction the resolver
 * applies: what a booking STORES has to be a locale this module would later
 * hand back, or the stored value silently degrades to English at send time.
 */
export function normalizeLocale(raw: string | null | undefined): ContactLocale | null {
    if (!raw || !isValidLocale(raw)) return null;
    const language = new Intl.Locale(raw).language;
    return SUPPORTED_CONTACT_LOCALES.find(
        (supported) => new Intl.Locale(supported).language === language,
    ) ?? null;
}

/**
 * The best supported locale named by an `Accept-Language` header, or `null`.
 * Entries are ranked by their `q` weight (absent means 1), ties broken by the
 * order sent, and unsupported entries are skipped rather than stopping the
 * scan — `fr-FR,es-MX;q=0.9` means Spanish here, not English.
 */
function fromAcceptLanguage(header: string | null | undefined): ContactLocale | null {
    if (!header) return null;
    return header
        .split(',')
        .map((entry, index) => {
            const [tag, ...params] = entry.trim().split(';');
            const q = params
                .map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p))
                .find((match) => match !== null);
            return { tag: tag.trim(), q: q ? Number(q[1]) : 1, index };
        })
        .filter((entry) => entry.tag !== '' && entry.tag !== '*' && !Number.isNaN(entry.q))
        .sort((a, b) => (b.q - a.q) || (a.index - b.index))
        .reduce<ContactLocale | null>(
            (found, entry) => found ?? normalizeLocale(entry.tag),
            null,
        );
}

/** Everything known about who is being written to. Every field is optional
 *  because every field is genuinely often absent. */
export interface ContactLocaleInput {
    /** `contacts.locale` — the contact's own stated preference. */
    contactLocale?: string | null;
    /** `users.locale` of the account this contact is bound to, if any. */
    linkedUserLocale?: string | null;
    /** The tenant's configured locale. */
    tenantDefault?: string | null;
    /** The request's `Accept-Language` header, when resolving inside one. */
    acceptLanguage?: string | null;
}

/** Resolve the language to address a contact in. See the precedence at the top
 *  of this file; it is documented there once and nowhere else. */
export function resolveContactLocale(input: ContactLocaleInput): ContactLocale {
    return normalizeLocale(input.contactLocale)
        ?? normalizeLocale(input.linkedUserLocale)
        ?? normalizeLocale(input.tenantDefault)
        ?? fromAcceptLanguage(input.acceptLanguage)
        ?? DEFAULT_CONTACT_LOCALE;
}
