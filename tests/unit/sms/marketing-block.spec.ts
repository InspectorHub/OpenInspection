/**
 * Marketing content may not ride a transactional SMS consent.
 *
 * The consent we hold was captured under a disclosure describing appointment
 * and report updates. A review request is promotional, and promotional content
 * changes which consent the message needs — so it is refused at the gate rather
 * than trusted to whoever writes the template. That is the reason
 * this lives in the gate and not in a template validator: do not leave the
 * compliance decision to the content author.
 *
 * TWO checks, because neither alone is sufficient:
 *   - the CLASS check catches anything carrying a known class id;
 *   - the CONTENT check catches tenant-authored bodies, which are unclassified
 *     by construction and would otherwise walk straight through the class check.
 *
 * The interesting failure mode is not the block, it is the GAP: a gate argument
 * no caller passes is a gate that is not running. That is why `bodyTemplate` is
 * a REQUIRED member of `SmsGateArgs` — an omitting call site is a build error,
 * not a silent skip — and why the last describe block pins that with a
 * `@ts-expect-error` the tests program checks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { smsSendGate } from '../../../server/lib/sms/send-gate';
import { MARKETING_VARS, marketingVarsIn } from '../../../server/lib/sms/marketing-content';

const TENANT = 't-marketing';
const PHONE = '+15557770000';
const CONTACT = 'c-consented';

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
    // A consumer who DID grant consent. Every case below therefore reaches the
    // marketing checks: a block here can only be the new check, never a
    // leftover consent refusal.
    await db.insert(schema.contacts).values({
        id: CONTACT, tenantId: TENANT, type: 'client', name: CONTACT,
        phone: PHONE, createdAt: new Date(),
    } as never);
    await db.insert(schema.smsConsentLog).values({
        id: 'sc-1', tenantId: TENANT, contactId: CONTACT,
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
        bodyTemplate: '',
        ...over,
    });

describe('marketingVarsIn — the check is on the VARIABLE, not on prose', () => {
    it('names the marketing variables a template references', () => {
        expect(marketingVarsIn('Thanks! Review us: {{review_url}}')).toEqual(['review_url']);
    });

    it('ignores ordinary prose that merely uses the word review', () => {
        expect(marketingVarsIn('Please review the attached report before Friday.')).toEqual([]);
    });

    it('ignores non-marketing variables', () => {
        expect(marketingVarsIn('{{company_name}} at {{property_address}}')).toEqual([]);
    });

    it('lists a plausible number of marketing variables — an empty denylist blocks nothing', () => {
        // Positive control. Every assertion above is satisfied by a denylist
        // that is empty, so the denylist's own size has to be asserted or the
        // whole content check can be deleted without reddening a single case.
        expect(MARKETING_VARS.size).toBeGreaterThanOrEqual(1);
        expect(MARKETING_VARS.has('review_url')).toBe(true);
    });
});

describe('marketing content is refused on the SMS channel', () => {
    it('refuses a body referencing a marketing variable, with no class at all', async () => {
        const out = await gate({ bodyTemplate: 'Thanks! Review us: {{review_url}}' });
        expect(out.allowed).toBe(false);
        expect((out as { reason: string }).reason).toMatch(/marketing/i);
    });

    it('refuses a marketing-category class even when the body looks innocent', async () => {
        const out = await gate({ classId: 'review-request', bodyTemplate: 'Hello.' });
        expect(out.allowed).toBe(false);
        expect((out as { reason: string }).reason).toMatch(/marketing/i);
    });

    it('refuses a class id it cannot resolve — an unknown class is not a transactional one', async () => {
        // `categoryOf` returns undefined for an id outside the registry, and on
        // this path undefined must mean BLOCK. A caller that cannot identify
        // what it is sending must not be able to send it on a consent that was
        // never given for it, and a default would be an invention.
        const out = await gate({ classId: 'no-such-class', bodyTemplate: 'Hello.' });
        expect(out.allowed).toBe(false);
        expect((out as { reason: string }).reason).toMatch(/unknown notification class/i);
    });

    it('allows an ordinary transactional body', async () => {
        const out = await gate({
            classId: 'booking-confirmation',
            bodyTemplate: '{{company_name}}: your inspection at {{property_address}} is set. Reply STOP to opt out',
        });
        expect(out.allowed).toBe(true);
    });

    it('does not fire on a body that merely mentions the word review in prose', async () => {
        const out = await gate({ bodyTemplate: 'Please review the attached report before Friday.' });
        expect(out.allowed).toBe(true);
    });

    it('blocks a marketing body on a TEST send too', async () => {
        // `purpose: 'test'` is exempt from express consent and from nothing
        // else. The gate cannot verify that a "test" number belongs to the
        // operator, so a template test-send is not a hole to push a review
        // link through.
        const out = await gate({ purpose: 'test', bodyTemplate: 'Review us: {{review_url}}' });
        expect(out.allowed).toBe(false);
        expect((out as { reason: string }).reason).toMatch(/marketing/i);
    });
});

describe('the marketing checks run BEFORE the preference lookup', () => {
    it('a muted recipient is refused for the marketing reason, not the mute reason', async () => {
        // Order is load-bearing. A message that may not be sent at all must not
        // have its refusal decided by whether the recipient happened to mute
        // the class — that would let a muted-but-consented recipient answer a
        // question consent should have answered, and the Outbox reason maps
        // would report the wrong fact about why we withheld it.
        await db.insert(schema.notificationPreferences).values({
            id: 'np-1', tenantId: TENANT, subjectKind: 'contact', subjectId: CONTACT,
            classId: 'review-request', channel: 'sms', enabled: false,
            createdAt: new Date(), updatedAt: new Date(),
        } as never);
        const out = await gate({ classId: 'review-request', bodyTemplate: 'Hello.' });
        expect(out.allowed).toBe(false);
        expect((out as { reason: string }).reason).toMatch(/marketing/i);
        expect((out as { reason: string }).reason).not.toMatch(/switched this off/i);
    });

    it('the preference check still works for a non-marketing class — the control', async () => {
        await db.insert(schema.notificationPreferences).values({
            id: 'np-2', tenantId: TENANT, subjectKind: 'contact', subjectId: CONTACT,
            classId: 'booking-confirmation', channel: 'sms', enabled: false,
            createdAt: new Date(), updatedAt: new Date(),
        } as never);
        const out = await gate({ classId: 'booking-confirmation', bodyTemplate: 'Hello.' });
        expect(out.allowed).toBe(false);
        expect((out as { reason: string }).reason).toMatch(/switched this off/i);
    });
});

describe('the argument cannot be forgotten', () => {
    it('omitting bodyTemplate is a compile error, not a silent skip', () => {
        // The bypass this whole task guards against is a call site that simply
        // does not pass the body. `bodyTemplate` is therefore REQUIRED on
        // `SmsGateArgs`, and this assertion is checked by tsconfig.tests.json:
        // if the property is ever loosened to optional, the `@ts-expect-error`
        // becomes unused and THIS LINE turns red — which is the point.
        // The cast is hoisted because a missing-property error is reported at
        // the ARGUMENT, not at the property that is absent — so the directive
        // has to sit above the call line, and a `@ts-expect-error` written
        // inside the object literal suppresses nothing and then reports itself
        // as unused. Verified with tsc rather than assumed.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyDb = db as any;
        // @ts-expect-error bodyTemplate is required; omitting it must not compile
        const call = () => smsSendGate({ db: anyDb, tenantId: TENANT, to: PHONE, purpose: 'test' });
        expect(typeof call).toBe('function');
    });

    it('and if one gets past the type anyway, absence is a refusal', async () => {
        // The type is the primary defence, but it does not reach an `as any`
        // handle or a caller in plain JS. Absence must never mean "skip the
        // check" — a gate argument nobody passes would otherwise be a gate that
        // is not running, which is the entire failure mode this task exists for.
        const args = {
            db, tenantId: TENANT, to: PHONE, purpose: 'test' as const,
        };
        const out = await smsSendGate(args as unknown as Parameters<typeof smsSendGate>[0]);
        expect(out.allowed).toBe(false);
        expect((out as { reason: string }).reason).toMatch(/no message body/i);
    });
});
