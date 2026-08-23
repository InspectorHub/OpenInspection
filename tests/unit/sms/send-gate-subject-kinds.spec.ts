/**
 * The send gate has to ask about the same person the ledger recorded.
 *
 * Two halves of one mistake, both of which come from assuming a recipient is a
 * `contacts` row:
 *
 *  1. REVOCATION. With no `contactId` in hand the gate falls back to matching
 *     the NUMBER, and that fallback read `contacts` only. A staff member's STOP
 *     is recorded against a `users` subject, so the fallback could not find it
 *     and the send went out. A recorded STOP that no gate reads is the same
 *     defect one layer down.
 *
 *  2. PREFERENCE. The subject handed to the preference lookup was labelled
 *     `kind: 'contact'` unconditionally, while for a staff or inspector
 *     recipient that id is a USER id (`server/services/automation/recipients.ts`
 *     builds it that way) and the staff screen stores those rows as
 *     `subject_kind = 'user'`. Written as one kind, read as the other: no row
 *     can ever match.
 *
 * The second case is a WRITE PATH AND A READ PATH THAT DISAGREE, not a live
 * silence — see the class-registry case at the bottom for exactly what is
 * holding the consequence off, and why that test is derived from the registry
 * rather than pinned to a class id.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { smsSendGate } from '../../../server/lib/sms/send-gate';
import { NOTIFICATION_CLASSES } from '../../../server/lib/notifications/classes';

const TENANT = 't-subjects';
const PHONE = '+15558887777';

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
});
afterEach(() => sqlite.close());

async function seedUser(id: string, phone: string | null, tenantId: string | null = TENANT) {
    await db.insert(schema.users).values({
        id, tenantId, email: `${id}@example.test`, passwordHash: 'x',
        name: id, phone, role: 'inspector', createdAt: new Date(),
    } as never);
}
async function seedContact(id: string, phone: string | null) {
    await db.insert(schema.contacts).values({
        id, tenantId: TENANT, type: 'client', name: id, phone, createdAt: new Date(),
    } as never);
}
/** A staff STOP: a `users` subject, whose `contact_id` is null. */
async function seedStaffStop(id: string, userId: string) {
    await db.insert(schema.smsConsentLog).values({
        id, tenantId: TENANT, contactId: null,
        subjectKind: 'user', subjectId: userId, recipientType: 'staff',
        action: 'revoked', disclosureVersion: 1, capturedVia: 'admin', createdAt: new Date(),
    } as never);
}

const gate = (over: Partial<Parameters<typeof smsSendGate>[0]> = {}) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    smsSendGate({ db: db as any, tenantId: TENANT, to: PHONE, purpose: 'notification', bodyTemplate: '', ...over });

describe('smsSendGate — a number that belongs to a users row', () => {
    it('refuses a send to a staff member who texted STOP, with no contactId to go on', async () => {
        // The realistic shape: nothing addressed this send to a contact,
        // because the recipient is not one.
        await seedUser('u-staff', PHONE);
        await seedStaffStop('sc-1', 'u-staff');

        expect(await gate({ contactId: null, roleKind: 'other' }))
            .toEqual({ allowed: false, reason: 'sms opt-out' });
    });

    it('refuses a TEST send to that number too — STOP does not care what the send is for', async () => {
        await seedUser('u-staff', PHONE);
        await seedStaffStop('sc-1', 'u-staff');

        expect(await gate({ purpose: 'test' }))
            .toEqual({ allowed: false, reason: 'sms opt-out' });
    });

    it('still sends to a staff member who never stopped', async () => {
        await seedUser('u-staff', PHONE);
        expect((await gate({ contactId: null, roleKind: 'other' })).allowed).toBe(true);
    });

    it('does not reach a users row belonging to another tenant', async () => {
        await db.insert(schema.tenants).values({
            id: 'other-t', slug: 'other-t', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
        await db.insert(schema.users).values({
            id: 'u-elsewhere', tenantId: 'other-t', email: 'e@example.test', passwordHash: 'x',
            name: 'e', phone: PHONE, role: 'inspector', createdAt: new Date(),
        } as never);
        await db.insert(schema.smsConsentLog).values({
            id: 'sc-x', tenantId: 'other-t', contactId: null,
            subjectKind: 'user', subjectId: 'u-elsewhere', recipientType: 'staff',
            action: 'revoked', disclosureVersion: 1, capturedVia: 'admin', createdAt: new Date(),
        } as never);

        expect((await gate({ purpose: 'test' })).allowed).toBe(true);
    });

    it('POSITIVE CONTROL — a contact that revoked is still refused by the number match', async () => {
        // The behaviour that already worked, asserted so that widening the
        // match cannot quietly narrow it.
        await seedContact('c-1', PHONE);
        await db.insert(schema.smsConsentLog).values({
            id: 'sc-c', tenantId: TENANT, contactId: 'c-1',
            subjectKind: 'contact', subjectId: 'c-1', recipientType: 'client',
            action: 'revoked', disclosureVersion: 1, capturedVia: 'admin', createdAt: new Date(),
        } as never);

        expect(await gate({ purpose: 'test' }))
            .toEqual({ allowed: false, reason: 'sms opt-out' });
    });
});

describe('smsSendGate — the preference lookup asks the right id space', () => {
    /**
     * Derived from the registry, never pinned to a class id.
     *
     * A test naming today's classes would pass forever: the mismatch is invisible
     * while no class is at once staff-audience, sms-capable and suppressible, and
     * a hard-coded id would simply keep testing whatever that id means later.
     * What is under test is the ID SPACE, which is why any suppressible
     * sms-capable class serves — the preference lookup never consults audience.
     */
    const suppressibleSmsClass = NOTIFICATION_CLASSES
        .find((c) => c.required === false && c.channels.includes('sms'));

    it('the registry still holds a suppressible SMS class to test with', () => {
        // Zero would make every case below vacuously green.
        expect(suppressibleSmsClass, 'no suppressible sms-capable class in NOTIFICATION_CLASSES').toBeDefined();
    });

    it('honours a mute stored against a USER subject, which is how staff rows are written', async () => {
        const classId = suppressibleSmsClass!.id;
        await seedUser('u-staff', PHONE);
        await db.insert(schema.notificationPreferences).values({
            id: 'np-1', tenantId: TENANT, subjectKind: 'user', subjectId: 'u-staff',
            classId, channel: 'sms', enabled: false, createdAt: new Date(), updatedAt: new Date(),
        } as never);

        // `contactId` carries the USER id for a staff or inspector recipient —
        // that is what the recipient resolver puts there.
        expect(await gate({ contactId: 'u-staff', roleKind: 'other', classId }))
            .toEqual({ allowed: false, reason: 'recipient switched this off' });
    });

    it('POSITIVE CONTROL — a mute stored against a CONTACT subject still applies', async () => {
        const classId = suppressibleSmsClass!.id;
        await seedContact('c-1', PHONE);
        await db.insert(schema.notificationPreferences).values({
            id: 'np-2', tenantId: TENANT, subjectKind: 'contact', subjectId: 'c-1',
            classId, channel: 'sms', enabled: false, createdAt: new Date(), updatedAt: new Date(),
        } as never);

        expect(await gate({ contactId: 'c-1', roleKind: 'other', classId }))
            .toEqual({ allowed: false, reason: 'recipient switched this off' });
    });

    it('does not read one id space for the other — a user mute never silences a contact', async () => {
        // The failure this pairs with: matching on the id alone would make two
        // different people with colliding ids share a preference.
        const classId = suppressibleSmsClass!.id;
        await seedContact('shared-id', PHONE);
        await db.insert(schema.notificationPreferences).values({
            id: 'np-3', tenantId: TENANT, subjectKind: 'user', subjectId: 'shared-id',
            classId, channel: 'sms', enabled: false, createdAt: new Date(), updatedAt: new Date(),
        } as never);

        expect((await gate({ contactId: 'shared-id', roleKind: 'other', classId })).allowed).toBe(true);
    });
});
