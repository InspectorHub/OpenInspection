/**
 * The consent ledger's subject, and the one row that must never be written.
 *
 * A staff member is a `users` row with no contact, so before the subject pair
 * existed their STOP had nowhere to land — the ISV strategy promised
 * "separate track + STOP" and the schema could not keep the second half.
 *
 * What did NOT change is the half that matters to a carrier: only consumers
 * ever produce a `granted` row. "Show us your opt-in proof" must keep pointing
 * at consumers alone, which is only true if agents and staff never enter the
 * ledger as grants.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

// eslint-disable-next-line import/order
import { grantSms, readSmsConsent, revokeChannel, type ConsentRecorder, type SmsConsentBlock } from '../../../server/lib/notifications/channel-consent';

const TENANT = 't-consent';
let db: BetterSQLite3Database<typeof schema>;
let sqlite: { close: () => void };

/** Records what would have been written, so the assertions are about intent. */
function recorder() {
    const rows: Array<Record<string, unknown>> = [];
    const rec: ConsentRecorder = {
        async record(tenantId, subjectId, action, capturedVia, meta) {
            rows.push({ tenantId, subjectId, action, capturedVia, ...meta });
        },
    };
    return { rec, rows };
}

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db as BetterSQLite3Database<typeof schema>;
    sqlite = fx.sqlite;
    await setupSchema(fx.sqlite);
});
afterEach(() => sqlite.close());

/**
 * `mode` is threaded from the audience rather than hard-coded because
 * `loadSmsConsentBlock` derives it exactly this way
 * (server/lib/notifications/channel-consent.ts). Nothing under test reads the
 * field — it is an OUTPUT of the loader, not an input to grant/revoke — but a
 * fixture that contradicts its producer is a trap for the next reader.
 */
const block = (
    subjects: Array<{ kind: 'contact' | 'user'; id: string }>,
    audience: 'client' | 'agent' | 'staff',
): SmsConsentBlock => ({
    phone: null, state: 'none', at: null, capturedVia: null,
    mode: audience === 'client' ? 'express' : 'implied',
    subjects, disclosure: null,
});

describe('who may enter the consent ledger', () => {
    it('records a STAFF stop against a users subject', async () => {
        const { rec, rows } = recorder();
        await revokeChannel(rec, TENANT, 'sms', block([{ kind: 'user', id: 'u1' }], 'staff'), 'staff');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ action: 'revoked', subjectKind: 'user', recipientType: 'staff' });
    });

    it('records an AGENT stop as an agent, not as a client', async () => {
        // The basis column exists to say which relationship made the person
        // reachable. Stamping everyone 'client' would make the evidence wrong
        // in the one direction a carrier audit cares about.
        const { rec, rows } = recorder();
        await revokeChannel(rec, TENANT, 'sms', block([{ kind: 'contact', id: 'c1' }], 'agent'), 'agent');
        expect(rows[0]).toMatchObject({ recipientType: 'agent' });
    });

    it('lets STAFF resume, recorded under their own basis', async () => {
        // Refusing this outright built a one-way door: a staff member who
        // stopped could never start again. The separation belongs in the
        // `recipient_type` column, not in the absence of the row.
        const { rec, rows } = recorder();
        await grantSms(rec, TENANT, block([{ kind: 'user', id: 'u1' }], 'staff'), 'staff', {});
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ action: 'granted', recipientType: 'staff', subjectKind: 'user' });
    });

    it('lets an AGENT resume, recorded as an agent', async () => {
        const { rec, rows } = recorder();
        await grantSms(rec, TENANT, block([{ kind: 'contact', id: 'c1' }], 'agent'), 'agent', {});
        expect(rows[0]).toMatchObject({ action: 'granted', recipientType: 'agent' });
    });

    it('NEVER labels a non-consumer resume as client consent', async () => {
        // THE invariant the ISV filing rests on. A query counting consumer
        // opt-in evidence filters `recipient_type = 'client'`, so a staff or
        // agent row stamped 'client' is the one mistake that would corrupt it.
        const { rec, rows } = recorder();
        await grantSms(rec, TENANT, block([{ kind: 'user', id: 'u1' }], 'staff'), 'staff', {});
        await grantSms(rec, TENANT, block([{ kind: 'contact', id: 'c1' }], 'agent'), 'agent', {});
        expect(rows.some((r) => r.recipientType === 'client')).toBe(false);
    });

    it('DOES record a grant for a client, with the evidence fields', async () => {
        const { rec, rows } = recorder();
        await grantSms(rec, TENANT, block([{ kind: 'contact', id: 'c1' }], 'client'), 'client', {
            ip: '203.0.113.7', userAgent: 'Mozilla/5.0',
        });
        expect(rows[0]).toMatchObject({
            action: 'granted', capturedVia: 'settings_page',
            recipientType: 'client', ip: '203.0.113.7', userAgent: 'Mozilla/5.0',
        });
    });

    it('writes nothing at all for the email channel', async () => {
        // Email has no consent artifact — only deliverability suppression,
        // which is a different fact. Its "off" is the preference cascade alone.
        const { rec, rows } = recorder();
        await revokeChannel(rec, TENANT, 'email', block([{ kind: 'contact', id: 'c1' }], 'client'), 'client');
        expect(rows).toEqual([]);
    });
});

describe('reading the block', () => {
    it('finds a staff revocation stored against a users subject', async () => {
        await db.insert(schema.smsConsentLog).values({
            id: 'sc1', tenantId: TENANT, contactId: null,
            subjectKind: 'user', subjectId: 'u1', recipientType: 'staff',
            action: 'revoked', disclosureVersion: 1, capturedVia: 'optin_link', createdAt: new Date(),
        } as never);

        const b = await readSmsConsent(db, TENANT, 'staff', [{ kind: 'user', id: 'u1' }], null);
        expect(b?.state).toBe('revoked');
    });

    it('reads "nothing on file" as IMPLIED for staff and agents, but NONE for a client', async () => {
        // Same absence, opposite meaning: a consumer is unreachable until they
        // say so; everyone else is reachable until they say stop.
        expect((await readSmsConsent(db, TENANT, 'staff', [{ kind: 'user', id: 'u2' }], null))?.state).toBe('implied');
        expect((await readSmsConsent(db, TENANT, 'agent', [{ kind: 'contact', id: 'c2' }], null))?.state).toBe('implied');
        expect((await readSmsConsent(db, TENANT, 'client', [{ kind: 'contact', id: 'c3' }], null))?.state).toBe('none');
    });

    it('renders nothing when there is no subject at all', async () => {
        expect(await readSmsConsent(db, TENANT, 'client', [], null)).toBeNull();
    });
});
