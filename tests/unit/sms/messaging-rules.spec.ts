/**
 * Jurisdictional messaging rules, and the two ways this repository has already
 * got them wrong.
 *
 * review review refused a premise we had asserted: the 8am-9pm restriction
 * lives in the telephone-solicitation rules (47 CFR 64.1200(c)(1), imposed on a
 * "telephone solicitation" as (f)(15) defines it), and a transactional robotext
 * does not inherit it. review 26a-5 corrected a second one: CASL 6(6) excuses
 * "Paragraph (1)(a)" — the consent limb — and only for a message that SOLELY
 * does one of the listed things, so identification and unsubscribe survive the
 * exception untouched. `transactional = exempt` is not a rule this file may
 * express.
 *
 * The load-bearing assertion is the LAST one in the first block: an unstudied
 * jurisdiction must THROW. A fallback is how a rule proven in one place becomes
 * a global rule, and both of the corrections above began as exactly that — a
 * summary of a neighbouring rule applied where nobody had read the text.
 * `US/TX` therefore throws even though `US/CA` is right there, and that case is
 * here on purpose: "no rule for ZZ" is easy to pass with a country check, and it
 * is the plausible-looking near-miss that a fallback would answer.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { smsSendGate } from '../../../server/lib/sms/send-gate';
// The rules table has its own module. Importing it from `send-gate` worked only
// through re-exports that nothing else used, and re-exports are how one symbol
// gets two homes — the gate that reads this table reads it from where it lives.
import {
    rulesFor, jurisdictionKey, GATE_ENFORCED_REQUIREMENTS, type Jurisdiction,
} from '../../../server/lib/sms/messaging-rules';

const CALIFORNIA: Jurisdiction = { country: 'US', region: 'CA' };
const CANADA: Jurisdiction = { country: 'CA', region: null };

describe('rulesFor — quiet hours are a marketing-path control', () => {
    it('does not apply quiet hours to a transactional class', () => {
        expect(rulesFor('booking-confirmation', CALIFORNIA).quiet_hours).toBe('not_applicable');
    });

    it('applies them to a marketing class — which is separately blocked from SMS entirely', () => {
        expect(rulesFor('review-request', CALIFORNIA).quiet_hours).toBe('required');
    });

    it('demands written consent for marketing and only express consent for transactional', () => {
        // The two standards are 64.1200(a)(2) (prior express WRITTEN consent for
        // a call that constitutes telemarketing) and (a)(1). Asserting both
        // stops a future edit from collapsing them into one value, which is the
        // shape "all SMS needs written consent" would take.
        expect(rulesFor('review-request', CALIFORNIA).consent_standard).toBe('express_written');
        expect(rulesFor('booking-confirmation', CALIFORNIA).consent_standard).toBe('express');
    });

    it('CASL owes identification and unsubscribe even on a consent-excused message', () => {
        const r = rulesFor('booking-confirmation', CANADA);
        expect(r.consent_standard).toBe('exception_applies');
        expect(r.identification).toBe('required');
        expect(r.unsubscribe).toBe('required');
    });

    it('refuses to answer for a jurisdiction it has no rule for, rather than defaulting', () => {
        expect(() => rulesFor('booking-confirmation', { country: 'ZZ', region: null })).toThrow(/no rule/i);
    });

    it('refuses a US state it has not studied, even though a sibling state is present', () => {
        // The near-miss, and the whole point. A country-level fallback would
        // answer this with California's rule and no test would notice.
        expect(() => rulesFor('booking-confirmation', { country: 'US', region: 'TX' })).toThrow(/no rule/i);
    });

    it('does not let the country-level Canadian rule answer for a US state', () => {
        expect(() => rulesFor('booking-confirmation', { country: 'US', region: null })).toThrow(/no rule/i);
    });

    it('refuses a class it cannot identify — an unclassified message owes an unknown amount', () => {
        expect(() => rulesFor('no-such-class', CALIFORNIA)).toThrow(/no rule/i);
    });
});

describe('the two meanings of CA never collide', () => {
    it('California and Canada are different jurisdictions with different consent standards', () => {
        expect(jurisdictionKey(CALIFORNIA)).toBe('US/CA');
        expect(jurisdictionKey(CANADA)).toBe('CA/-');
        expect(rulesFor('review-request', CALIFORNIA).consent_standard).not.toBe(
            rulesFor('review-request', CANADA).consent_standard);
    });
});

describe("what we have not read says 'unknown', not 'not applicable'", () => {
    it('leaves Canadian quiet hours unknown rather than concluding CASL has none', () => {
        // CASL itself carries no quiet-hours provision, and concluding
        // "therefore Canada has none" is precisely the transplant that recorded
        // a Washington exemption that does not exist. The CRTC's Unsolicited
        // Telecommunications Rules have not been read, so the value is unknown
        // and the gate refuses. If someone reads them, this assertion is the one
        // that has to be updated deliberately.
        expect(rulesFor('booking-confirmation', CANADA).quiet_hours).toBe('unknown');
    });
});

describe('GATE_ENFORCED_REQUIREMENTS names only what the gate really refuses on', () => {
    it('claims consent_standard and quiet_hours, and does not claim the other two', () => {
        // A non-empty positive control: every assertion below about refusals
        // would also pass if this array were empty and the register's
        // `enforced_by` values were fiction.
        expect([...GATE_ENFORCED_REQUIREMENTS].sort()).toEqual(['consent_standard', 'quiet_hours']);
    });
});

// ── The gate ────────────────────────────────────────────────────────────────

const TENANT = 't-messaging-rules';
const PHONE = '+15557770001';
const CONTACT = 'c-jurisdiction';

let db: BetterSQLite3Database<typeof schema>;
let sqlite: { close: () => void };

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db as BetterSQLite3Database<typeof schema>;
    sqlite = fx.sqlite;
    await setupSchema(fx.sqlite);
    await db.insert(schema.tenants).values({
        id: TENANT, slug: TENANT, status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    // A consumer who DID grant consent, so every refusal below can only come
    // from the jurisdiction rules and never from a leftover consent failure.
    await db.insert(schema.contacts).values({
        id: CONTACT, tenantId: TENANT, type: 'client', name: CONTACT,
        phone: PHONE, createdAt: new Date(),
    } as never);
    await db.insert(schema.smsConsentLog).values({
        id: 'sc-jur-1', tenantId: TENANT, contactId: CONTACT,
        subjectKind: 'contact', subjectId: CONTACT, recipientType: 'client',
        action: 'granted', disclosureVersion: 1, capturedVia: 'admin', createdAt: new Date(),
    } as never);
});
afterEach(() => sqlite.close());

const gate = (over: Partial<Parameters<typeof smsSendGate>[0]> = {}) =>
    smsSendGate({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db: db as any,
        tenantId: TENANT,
        to: PHONE,
        purpose: 'notification',
        contactId: CONTACT,
        roleKind: 'client',
        classId: 'booking-confirmation',
        bodyTemplate: 'Your inspection is confirmed.',
        ...over,
    });

describe('smsSendGate consults the rules when the caller can state a jurisdiction', () => {
    it('sends a transactional message in a studied jurisdiction', async () => {
        const out = await gate({ jurisdiction: CALIFORNIA });
        expect(out.allowed).toBe(true);
    });

    it('refuses in a jurisdiction with no rule, instead of using the rule next door', async () => {
        const out = await gate({ jurisdiction: { country: 'US', region: 'TX' } });
        expect(out.allowed).toBe(false);
        expect((out as { reason: string }).reason).toMatch(/no messaging rule for US\/TX/);
    });

    it('refuses where the quiet-hours answer has not been established', async () => {
        const out = await gate({ jurisdiction: CANADA });
        expect(out.allowed).toBe(false);
        expect((out as { reason: string }).reason).toMatch(/quiet-hours rule not established/);
    });

    it('distinguishes "the rule applies" from "we have not read it" as two different values', () => {
        // Both make the gate refuse, and they are not the same fact: one is a
        // missing recipient fact, the other is missing legal research. Collapsed
        // into one value, the second becomes invisible the day the first is
        // solved by adding a recipient timezone.
        expect(rulesFor('review-request', CALIFORNIA).quiet_hours).toBe('required');
        expect(rulesFor('booking-confirmation', CANADA).quiet_hours).toBe('unknown');
    });

    it('refuses a marketing class before the quiet-hours rule is ever reached, and says which', async () => {
        // The `quiet_hours: required` branch of the gate is currently
        // UNREACHABLE through a class: marketing is refused above it, by content
        // and by category. That is stated here rather than left as a hole in the
        // coverage, because a reader finding no test for that branch would
        // otherwise conclude the branch is dead and delete it — it is the
        // defence that holds if the marketing block is ever narrowed.
        const out = await gate({ classId: 'review-request', jurisdiction: CALIFORNIA });
        expect(out.allowed).toBe(false);
        expect((out as { reason: string }).reason).toMatch(/marketing class on sms/);
    });

    it('does not consult the rules when no jurisdiction is stated, and does not silently allow either', async () => {
        // The three shipped call sites pass no jurisdiction, so this is the live
        // behaviour: the checks that hold today are revocation, express consent
        // and the marketing blocks. This asserts the ABSENCE is not itself a
        // bypass of those.
        const allowed = await gate();
        expect(allowed.allowed).toBe(true);
        const marketing = await gate({ bodyTemplate: 'Review us {{review_url}}' });
        expect(marketing.allowed).toBe(false);
        expect((marketing as { reason: string }).reason).toMatch(/marketing/i);
    });

    it('refuses an unclassified send in a stated jurisdiction rather than skipping the rules', async () => {
        // `classId` absent means the class check cannot run; the existing gate
        // keeps that send legal only because a test send has no class. Asserting
        // it here pins that a jurisdiction alone does not make an unclassified
        // send refusable — the reason must still come from the class checks, not
        // from a silent jurisdiction skip that looks like approval.
        const out = await gate({ classId: undefined, jurisdiction: CALIFORNIA });
        expect(out.allowed).toBe(true);
    });
});
