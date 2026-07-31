/**
 * `smsSendGate` — the one chain every outbound SMS passes through.
 *
 * There were three copies of this chain, and the reason that mattered is
 * recorded in the module: when STOP-revocation was added it landed in one of
 * them. Nobody skipped a step; the other two were not there to receive it.
 *
 * So the tests that matter here are the ones about WHICH gates a purpose is
 * exempt from — because "exempt from express consent" and "exempt from
 * whatever nobody copied" look identical from the outside until something goes
 * wrong.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { smsSendGate } from '../../../server/lib/sms/send-gate';

const TENANT = 't-gate';
const PHONE = '+15559991234';

let db: BetterSQLite3Database<typeof schema>;
let sqlite: { close: () => void };

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db as BetterSQLite3Database<typeof schema>;
    sqlite = fx.sqlite;
    await setupSchema(fx.sqlite);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: TENANT, status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
});
afterEach(() => sqlite.close());

async function seedContact(id: string, phone: string | null) {
    await db.insert(schema.contacts).values({
        id, tenantId: TENANT, type: 'client', name: id, phone, createdAt: new Date(),
    } as never);
}
async function seedConsent(id: string, contactId: string, action: 'granted' | 'revoked', at = new Date()) {
    await db.insert(schema.smsConsentLog).values({
        id, tenantId: TENANT, contactId, recipientType: 'client',
        action, disclosureVersion: 1, capturedVia: 'admin', createdAt: at,
    } as never);
}
const gate = (over: Partial<Parameters<typeof smsSendGate>[0]> = {}) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    smsSendGate({ db: db as any, tenantId: TENANT, to: PHONE, purpose: 'notification', ...over });

describe('smsSendGate — express consent (consumers only)', () => {
    it('a consumer with no consent record is refused', async () => {
        await seedContact('c1', PHONE);
        const r = await gate({ contactId: 'c1', roleKind: 'client' });
        expect(r).toEqual({ allowed: false, reason: 'no sms consent' });
    });

    it('a consumer with granted consent is allowed', async () => {
        await seedContact('c1', PHONE);
        await seedConsent('s1', 'c1', 'granted');
        expect((await gate({ contactId: 'c1', roleKind: 'client' })).allowed).toBe(true);
    });

    it('an agent with no consent record is allowed — implied basis, not silence', async () => {
        await seedContact('a1', PHONE);
        expect((await gate({ contactId: 'a1', roleKind: 'agent' })).allowed).toBe(true);
    });

    it('a consumer with no identifiable contact fails closed', async () => {
        const r = await gate({ contactId: null, roleKind: 'client' });
        expect(r).toEqual({ allowed: false, reason: 'no sms consent' });
    });
});

describe('smsSendGate — revocation binds everyone', () => {
    it('refuses a consumer who revoked', async () => {
        await seedContact('c1', PHONE);
        await seedConsent('s1', 'c1', 'granted', new Date(1000));
        await seedConsent('s2', 'c1', 'revoked', new Date(2000));
        const r = await gate({ contactId: 'c1', roleKind: 'client' });
        // A distinct reason from "never opted in" — the Outbox reason maps read
        // these, and "opted out" and "never opted in" are different facts.
        expect(r).toEqual({ allowed: false, reason: 'sms opt-out' });
    });

    it('refuses an AGENT who revoked, even though their basis is implied', async () => {
        // The rule that is easy to get wrong: express consent is a consumer
        // rule, revocation is not. Conflating them is what let a revoked agent
        // keep receiving texts.
        await seedContact('a1', PHONE);
        await seedConsent('s1', 'a1', 'revoked');
        expect(await gate({ contactId: 'a1', roleKind: 'agent' }))
            .toEqual({ allowed: false, reason: 'sms opt-out' });
    });

    it('honours a later START', async () => {
        await seedContact('c1', PHONE);
        await seedConsent('s1', 'c1', 'revoked', new Date(1000));
        await seedConsent('s2', 'c1', 'granted', new Date(2000));
        expect((await gate({ contactId: 'c1', roleKind: 'client' })).allowed).toBe(true);
    });
});

describe('smsSendGate — purpose: test', () => {
    it('is exempt from express consent, because there is no contact to hold any', async () => {
        expect((await gate({ purpose: 'test' })).allowed).toBe(true);
    });

    it('is NOT exempt from revocation — a number that texted STOP is refused', async () => {
        await seedContact('c1', PHONE);
        await seedConsent('s1', 'c1', 'revoked');
        expect(await gate({ purpose: 'test' }))
            .toEqual({ allowed: false, reason: 'sms opt-out' });
    });

    it('matches the number the way the inbound webhook does, not by string equality', async () => {
        // The webhook normalizes on read because stored phones may not be. If
        // these two matchers disagreed, a revocation could be recorded against
        // a contact this check would then fail to find — the revocation would
        // exist and do nothing.
        await seedContact('c1', '(555) 999-1234');
        await seedConsent('s1', 'c1', 'revoked');
        expect(await gate({ purpose: 'test', to: '+15559991234' }))
            .toEqual({ allowed: false, reason: 'sms opt-out' });
    });

    it('blocks when ANY contact on that number revoked — deliberate, and not new', async () => {
        // Deviation D5 in the spec. Two people sharing a number (a couple, an
        // office line) means one person's STOP withholds the other's message.
        // That is not introduced here: the inbound STOP webhook already records
        // a revocation against EVERY contact matching the number, so the ledger
        // was always number-shaped. Reading it any other way would honour a
        // revocation for one row and ignore it for its twin.
        //
        // Pinned so a later change that narrows this to "the addressed contact
        // only" fails here rather than quietly resuming texts to a number that
        // asked us to stop.
        await seedContact('c-quiet', PHONE);
        await seedContact('c-loud', PHONE);
        await seedConsent('s-loud', 'c-loud', 'granted');
        await seedConsent('s-quiet', 'c-quiet', 'revoked');

        expect(await gate({ purpose: 'test' }))
            .toEqual({ allowed: false, reason: 'sms opt-out' });
    });

    it('leaves an unrelated contact alone', async () => {
        await seedContact('c1', '+15550001111');
        await seedConsent('s1', 'c1', 'revoked');
        expect((await gate({ purpose: 'test' })).allowed).toBe(true);
    });
});

describe('smsSendGate — managed compliance', () => {
    it('refuses an unapproved managed tenant before anything is sent', async () => {
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, smsMode: 'managed_dedicated', updatedAt: new Date(),
        } as never);
        const r = await gate({ purpose: 'test' });
        expect(r.allowed).toBe(false);
        expect((r as { reason: string }).reason).toBe('managed_not_approved');
    });

    it('reports the tenant sms mode and config back, so the caller needs no second read', async () => {
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, smsMode: 'own', companyPhone: '+15551110000',
            reviewUrl: 'https://g.example/review', updatedAt: new Date(),
        } as never);
        const r = await gate({ purpose: 'test' });
        expect(r).toMatchObject({
            allowed: true, smsMode: 'own',
            companyPhone: '+15551110000', reviewUrl: 'https://g.example/review',
        });
    });
});

describe('smsSendGate — the recipient’s own preference', () => {
    /**
     * The screen renders a Text switch for `booking-confirmation` and
     * `inspection-reminder`. Until this gate consulted preferences, ticking it
     * off stored a row that NOTHING read and the text went out anyway — a
     * screen that accepts a change and then ignores it, which is the exact
     * defect the preference layer exists to remove.
     */
    async function mute(classId: string, contactId = 'c1') {
        await db.insert(schema.notificationPreferences).values({
            id: `np-${classId}-${contactId}`, tenantId: TENANT, subjectKind: 'contact',
            subjectId: contactId, classId, channel: 'sms', enabled: false,
            createdAt: new Date(), updatedAt: new Date(),
        } as never);
    }

    it('withholds a class this recipient switched off', async () => {
        await seedContact('c1', PHONE);
        await seedConsent('sc1', 'c1', 'granted');
        await mute('booking-confirmation');

        const r = await gate({ contactId: 'c1', roleKind: 'client', classId: 'booking-confirmation' });
        expect(r.allowed).toBe(false);
    });

    it('sends a DIFFERENT class the same recipient did not switch off', async () => {
        await seedContact('c1', PHONE);
        await seedConsent('sc1', 'c1', 'granted');
        await mute('booking-confirmation');

        const r = await gate({ contactId: 'c1', roleKind: 'client', classId: 'inspection-reminder' });
        expect(r.allowed).toBe(true);
    });

    it('sends an UNCLASSIFIED message — an admin test send is not mutable', async () => {
        await seedContact('c1', PHONE);
        await seedConsent('sc1', 'c1', 'granted');
        await mute('booking-confirmation');

        const r = await gate({ contactId: 'c1', roleKind: 'client' });
        expect(r.allowed).toBe(true);
    });

    it('a preference NARROWS consent, it never widens it', async () => {
        // §3.3 — consent is the authority on this channel. A recipient who
        // never granted consent stays unreachable no matter what the
        // preference table says, so the order of the two checks is load-bearing.
        await seedContact('c1', PHONE);
        const r = await gate({ contactId: 'c1', roleKind: 'client', classId: 'inspection-reminder' });
        expect(r).toEqual({ allowed: false, reason: 'no sms consent' });
    });
});
