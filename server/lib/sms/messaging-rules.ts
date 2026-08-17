/**
 * Jurisdictional messaging rules — what a message owes, and where that comes from.
 *
 * Split out of `send-gate.ts` when that file crossed the 400-line gate, and the
 * seam is the right one: everything here answers "what does the law require in
 * this place", and everything left in the gate answers "may THIS message go to
 * THIS person right now". The first changes when a statute is read; the second
 * changes when the product does.
 *
 * ── There is no wildcard, and that is the whole design ──────────────────────
 * `rulesFor` refuses a jurisdiction it has no rule for. A country-level fallback
 * would be the failure this table exists to prevent: it would let the rule
 * studied for one place answer for a place nobody has studied, silently, and the
 * answer would look as authoritative as a real one.
 *
 * ── `unknown` is a value, and it fails closed ───────────────────────────────
 * "The provision does not reach this" and "we have not read it" are different
 * facts and must never collapse into one. Recording the second as the first is
 * precisely the error this repository made once with Washington — concluding a
 * state had an exemption because a neighbouring state's summary said so — and
 * once with a TCPA quiet-hours range written wider than the statute.
 *
 * The register in `compliance/messaging-rules.jsonc` carries the citations, the
 * date each was checked, and whether it was read from PRIMARY TEXT or a
 * secondary source; `lint:messaging-rules` compares this table against it in
 * both directions and prints the unverified count every run.
 */
import { categoryOf, type NotificationCategory } from '../notifications/classes';

/**
 * WHERE the recipient is. Two fields, because a country alone cannot answer a
 * state overlay and `region` alone cannot say which country's `CA` it means.
 *
 * `region: null` means "the country-level rule", NOT "any region in that
 * country". There is no wildcard: see `rulesFor`.
 */
export interface Jurisdiction {
    /** ISO 3166-1 alpha-2. `US` and `CA` are the only ones studied. */
    country: string;
    /** ISO 3166-2 subdivision without the country prefix (`CA` = California), or null. */
    region: string | null;
}

/** What a message owes in a jurisdiction. The four questions counsel's ruling asks. */
export interface MessagingRule {
    /**
     * `express` — prior express consent · `express_written` — a signed
     * telemarketing authorization · `exception_applies` — a statutory exception
     * excuses the consent limb (and NOTHING else) · `express_or_implied` — either
     * suffices.
     */
    consent_standard: 'express' | 'express_written' | 'exception_applies' | 'express_or_implied';
    /**
     * `not_applicable` means the provision's own scope does not reach this
     * content — never "we decided it doesn't matter". `unknown` means nobody has
     * read the authority yet, and fails CLOSED.
     */
    quiet_hours: 'required' | 'not_applicable' | 'unknown';
    identification: 'required' | 'not_applicable' | 'unknown';
    unsubscribe: 'required' | 'not_applicable' | 'unknown';
}

/**
 * The enforceable half of `compliance/messaging-rules.jsonc`.
 *
 * ── Why the values are duplicated out of the register ────────────────────────
 * A Worker has no filesystem, so the register cannot be read at runtime. The
 * honest options were to keep the citations in code (where nobody maintaining a
 * legal record would look for them) or to keep the enforceable values here and
 * make the drift a build failure. `lint:messaging-rules` does the second: it
 * parses this literal, compares all four values of every rule against the
 * register, and fails on any rule present in one and not the other. So this is
 * a projection of that file, never a second opinion about the law.
 *
 * ── Why it is written in a shape a script can parse ──────────────────────────
 * The gate extracts this object literal and parses it. It tolerates quoted and
 * unquoted keys and both quote styles, so ordinary formatting is safe — but the
 * leaf values must stay simple string literals. Do not introduce a computed
 * key, a spread or a helper call here; put the reasoning in the register.
 *
 * KEY FORMAT: `${country}/${region ?? '-'}`. `US/CA` is California and `CA/-`
 * is Canada, which is exactly the collision the two-field `Jurisdiction` and
 * this explicit `-` exist to keep visible.
 */
export const MESSAGING_RULES: Record<string, Partial<Record<NotificationCategory, MessagingRule>>> = {
    'US/CA': {
        transactional: {
            consent_standard: 'express',
            quiet_hours: 'not_applicable',
            identification: 'required',
            unsubscribe: 'required',
        },
        operational: {
            consent_standard: 'express',
            quiet_hours: 'not_applicable',
            identification: 'required',
            unsubscribe: 'required',
        },
        marketing: {
            consent_standard: 'express_written',
            quiet_hours: 'required',
            identification: 'required',
            unsubscribe: 'required',
        },
    },
    'CA/-': {
        transactional: {
            consent_standard: 'exception_applies',
            quiet_hours: 'unknown',
            identification: 'required',
            unsubscribe: 'required',
        },
        operational: {
            consent_standard: 'exception_applies',
            quiet_hours: 'unknown',
            identification: 'required',
            unsubscribe: 'required',
        },
        marketing: {
            consent_standard: 'express_or_implied',
            quiet_hours: 'unknown',
            identification: 'required',
            unsubscribe: 'required',
        },
    },
};

/**
 * The requirements THIS function refuses on. Read by `lint:messaging-rules`.
 *
 * A register entry may claim `enforced_by: "send-gate"` only for a name in this
 * array, so a requirement cannot be recorded as enforced here while this
 * function ignores it — which is the failure mode the register would otherwise
 * hide behind a full-looking table. `identification` and `unsubscribe` are
 * deliberately absent: this function inspects neither the composed body nor the
 * inbound path, and claiming them would be the same lie in the other direction.
 */
export const GATE_ENFORCED_REQUIREMENTS: readonly string[] = ['consent_standard', 'quiet_hours'];

/** `${country}/${region ?? '-'}` — the register's key, built in one place. */
export function jurisdictionKey(j: Jurisdiction): string {
    return `${j.country}/${j.region ?? '-'}`;
}

/**
 * What this class owes in this jurisdiction. THROWS rather than defaulting.
 *
 * Three throws, and each is a jurisdiction we have not studied wearing a
 * different disguise: a class outside the registry (we cannot say what the
 * message IS, so we cannot say what it owes), a country/region pair with no
 * entry, and an entry that says nothing about this category.
 *
 * There is NO FALLBACK, deliberately. Falling back from `US/TX` to `US/-`, or
 * from anything to the US rule, is how a rule proven in one jurisdiction
 * becomes a global rule — the single failure this framework exists to prevent,
 * and the one that produced both of the legal errors already corrected in this
 * repository. Adding a state means studying that state.
 */
export function rulesFor(classId: string, jurisdiction: Jurisdiction): MessagingRule {
    const category = categoryOf(classId);
    if (category === undefined) {
        throw new Error(`no rule for an unregistered notification class: ${classId}`);
    }
    const key = jurisdictionKey(jurisdiction);
    const entry = MESSAGING_RULES[key];
    if (!entry) {
        throw new Error(
            `no rule for jurisdiction ${key}: it has not been studied. `
            + 'Add it to compliance/messaging-rules.jsonc with citations; do not reuse another jurisdiction\'s rule.',
        );
    }
    const rule = entry[category];
    if (!rule) {
        throw new Error(`no rule for ${category} messages in ${key}`);
    }
    return rule;
}
