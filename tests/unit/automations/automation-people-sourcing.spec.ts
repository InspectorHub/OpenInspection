/**
 * Task 11a (people-role-profiles) — the automation engine's LIVE reads of
 * inspections.clientEmail/clientPhone/clientContactId/referredByAgentId/
 * sellingAgentId/clientName convert to source from inspection_people (via
 * contact_role_profiles), mirroring the pattern already shipped for
 * InspectionCoreService (Task 9c) / DataService export / api/metrics.ts.
 *
 * Every inspection fixture below leaves the LEGACY client/agent columns NULL
 * and seeds ONLY inspection_people, so these specs fail against the
 * pre-Task-11a implementation (which reads the legacy columns and would
 * resolve null/no address) and pass once resolution moves to the join.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { SmsConsentService } from '../../../server/services/sms-consent.service';
import type { EmailService } from '../../../server/services/email.service';

const TENANT = '00000000-0000-0000-0000-00000000a11a';
const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme-a11a', status: 'active', phone: '+15550009999',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    await seedRoleProfiles(db, TENANT, new Date(1));
    svc = new AutomationService({} as D1Database);
    vi.spyOn(svc, 'ensureSeeds').mockResolvedValue();
});

async function seedInspection(id: string, over: Partial<typeof schema.inspections.$inferInsert> = {}) {
    await db.insert(schema.inspections).values({
        id, tenantId: TENANT, propertyAddress: '1 Main',
        // Legacy people columns intentionally omitted/NULL — inspection_people
        // is the only source (Task 9c fixture pattern).
        date: '2026-07-01', status: 'completed', reportStatus: 'published',
        paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false,
        createdAt: new Date(), ...over,
    } as never);
}

async function addContact(id: string, fields: { name: string; email?: string | null; phone?: string | null; type?: 'client' | 'agent' }) {
    await db.insert(schema.contacts).values({
        id, tenantId: TENANT, type: fields.type ?? 'client', name: fields.name,
        email: fields.email ?? null, phone: fields.phone ?? null, createdAt: new Date(),
    } as never);
}

const people = () => new PeopleService({ DB: {} as D1Database });

async function inspRowOf(id: string) {
    const row = await db.select().from(schema.inspections).where(eq(schema.inspections.id, id)).get();
    if (!row) throw new Error('inspection not seeded');
    return row;
}

describe('AutomationService.resolveAddress — sources people from inspection_people (Task 11a)', () => {
    it('email/client resolves the primary client contact email (no legacy clientEmail)', async () => {
        const insp = 'insp-email-client';
        await seedInspection(insp);
        await addContact('c-client-1', { name: 'Jane Client', email: 'jane@example.com', phone: '+15551110000' });
        await people().addPerson(TENANT, insp, 'c-client-1', roleProfileId('client'));
        const dbi = svc['getDrizzle']();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const addr = await (svc as any).resolveAddress('role', roleProfileId('client'), 'email', await inspRowOf(insp), dbi);
        expect(addr).toBe('jane@example.com');
    });

    it('email/client returns null when no primary client person exists (no legacy-column fallback)', async () => {
        const insp = 'insp-email-none';
        await seedInspection(insp);
        const dbi = svc['getDrizzle']();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const addr = await (svc as any).resolveAddress('role', roleProfileId('client'), 'email', await inspRowOf(insp), dbi);
        expect(addr).toBeNull();
    });

    it('sms/client resolves the primary client contact phone, normalized E.164', async () => {
        const insp = 'insp-sms-client';
        await seedInspection(insp);
        await addContact('c-client-2', { name: 'Joe Client', email: 'joe@example.com', phone: '(555) 222-3333' });
        await people().addPerson(TENANT, insp, 'c-client-2', roleProfileId('client'));
        const dbi = svc['getDrizzle']();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const addr = await (svc as any).resolveAddress('role', roleProfileId('client'), 'sms', await inspRowOf(insp), dbi);
        expect(addr).toBe('+15552223333');
    });

    it('sms/selling_agent (role key listing_agent) resolves the listing_agent role contact phone', async () => {
        const insp = 'insp-sms-selling';
        await seedInspection(insp);
        await addContact('c-listing-1', { name: 'Listing Agent', phone: '(555) 444-5555', type: 'agent' });
        await people().addPerson(TENANT, insp, 'c-listing-1', roleProfileId('listing_agent'));
        const dbi = svc['getDrizzle']();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const addr = await (svc as any).resolveAddress('role', roleProfileId('listing_agent'), 'sms', await inspRowOf(insp), dbi);
        expect(addr).toBe('+15554445555');
    });

    it('sms/buying_agent (role key buyer_agent) resolves the buyer_agent role contact phone', async () => {
        const insp = 'insp-sms-buying';
        await seedInspection(insp);
        await addContact('c-buyer-1', { name: "Buyer's Agent", phone: '(555) 666-7777', type: 'agent' });
        await people().addPerson(TENANT, insp, 'c-buyer-1', roleProfileId('buyer_agent'));
        const dbi = svc['getDrizzle']();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const addr = await (svc as any).resolveAddress('role', roleProfileId('buyer_agent'), 'sms', await inspRowOf(insp), dbi);
        expect(addr).toBe('+15556667777');
    });

    it('sms/selling_agent returns null when no listing_agent person exists', async () => {
        const insp = 'insp-sms-selling-none';
        await seedInspection(insp);
        const dbi = svc['getDrizzle']();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const addr = await (svc as any).resolveAddress('role', roleProfileId('listing_agent'), 'sms', await inspRowOf(insp), dbi);
        expect(addr).toBeNull();
    });

    // Spec 2 Task 0 — new discriminator kinds not covered by the pre-existing
    // enum suite: 'all' never resolves an address (email or sms), and an
    // unknown/missing recipientRoleProfileId resolves to null rather than throwing.
    it("recipientKind:'all' resolves null for both channels", async () => {
        const insp = 'insp-all-kind';
        await seedInspection(insp);
        await addContact('c-client-all', { name: 'Jane Client', email: 'jane@example.com', phone: '+15551110000' });
        await people().addPerson(TENANT, insp, 'c-client-all', roleProfileId('client'));
        const dbi = svc['getDrizzle']();
        const row = await inspRowOf(insp);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(await (svc as any).resolveAddress('all', null, 'email', row, dbi)).toBeNull();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(await (svc as any).resolveAddress('all', null, 'sms', row, dbi)).toBeNull();
    });

    it("recipientKind:'role' with an unknown recipientRoleProfileId resolves null (never throws)", async () => {
        const insp = 'insp-unknown-profile';
        await seedInspection(insp);
        const dbi = svc['getDrizzle']();
        const row = await inspRowOf(insp);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(await (svc as any).resolveAddress('role', 'crp-does-not-exist', 'email', row, dbi)).toBeNull();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(await (svc as any).resolveAddress('role', 'crp-does-not-exist', 'sms', row, dbi)).toBeNull();
    });

    // NOTE: the 'inspector' sms recipient branch is explicitly OUT OF SCOPE for
    // Task 11a (brief: "inspector → UNCHANGED (users lookup)") and is not
    // covered here — its pre-existing `.get().catch()` read only behaves as a
    // Promise against the real async D1 driver, not the synchronous
    // better-sqlite3 driver this suite uses, which is an unrelated,
    // pre-existing test-environment quirk of that untouched code path.
});

describe('AutomationService.flush — SMS consent + client_name resolve via inspection_people (Task 11a)', () => {
    beforeEach(async () => {
        await new SmsConsentService({} as D1Database).publishDisclosure('disclosure');
    });

    async function seedRule(opts: { recipientRoleKey: string; channel: 'email' | 'sms'; body: string; smsBody?: string }) {
        const ruleId = crypto.randomUUID();
        await db.insert(schema.automations).values({
            id: ruleId, tenantId: TENANT, name: 'R', trigger: 'report.published',
            recipientKind: 'role', recipientRoleProfileId: roleProfileId(opts.recipientRoleKey), delayMinutes: 0,
            subjectTemplate: 'Subj', bodyTemplate: opts.body, smsBody: opts.smsBody ?? null,
            channels: JSON.stringify([opts.channel]), active: true, isDefault: false, createdAt: new Date(),
        } as never);
        const { backfillAutomationTemplates } = await import('../../../server/services/message-template-backfill');
        await backfillAutomationTemplates({} as D1Database, TENANT);
        return ruleId;
    }

    const stubEmailFor = (sent: Array<{ subject: string; html: string }>) => async (_tid: string) => ({
        sendEmail: async (_to: string[], subject: string, html: string) => {
            sent.push({ subject, html });
            return { delivered: true };
        },
    } as unknown as EmailService);

    it('SMS consent gate checks the contactId derived from inspection_people (client role), not legacy clientContactId', async () => {
        const insp = 'insp-consent';
        await seedInspection(insp);
        await addContact('c-consent-1', { name: 'Consent Client', phone: '+15550001111' });
        await people().addPerson(TENANT, insp, 'c-consent-1', roleProfileId('client'));
        const ruleId = await seedRule({ recipientRoleKey: 'client', channel: 'sms', body: 'unused', smsBody: 'Hi {{client_name}}' });
        await new SmsConsentService({} as D1Database).record(TENANT, 'c-consent-1', 'granted', 'admin', {});
        await db.insert(schema.automationLogs).values({
            id: crypto.randomUUID(), tenantId: TENANT, automationId: ruleId, inspectionId: insp,
            recipient: '+15550001111', channel: 'sms', sendAt: new Date(Date.now() - 1000), status: 'pending',
        } as never);
        const fakeSendMessage = vi.fn().mockResolvedValue({ ok: true });
        const fakeProvider = { sendMessage: fakeSendMessage, validateInboundSignature: vi.fn().mockResolvedValue(false) };
        const smsRuntime = { resolveProvider: vi.fn().mockResolvedValue({ provider: fakeProvider, from: '+1999' }) };
        await svc.flush(stubEmailFor([]), 'Acme', 'https://acme.example.com', smsRuntime);
        const log = await db.select().from(schema.automationLogs)
            .where(eq(schema.automationLogs.inspectionId, insp)).get();
        expect(log?.status).toBe('sent');
        expect(fakeSendMessage).toHaveBeenCalledTimes(1);
        const call = fakeSendMessage.mock.calls[0][0] as { body: string };
        expect(call.body).toContain('Consent Client'); // client_name resolved via inspection_people too
    });

    it('email path interpolates client_name from the inspection_people primary client, not legacy clientName', async () => {
        const insp = 'insp-clientname';
        await seedInspection(insp);
        await addContact('c-name-1', { name: 'Resolved Name', email: 'resolved@example.com' });
        await people().addPerson(TENANT, insp, 'c-name-1', roleProfileId('client'));
        const ruleId = await seedRule({ recipientRoleKey: 'client', channel: 'email', body: 'Hi {{client_name}}' });
        await db.insert(schema.automationLogs).values({
            id: crypto.randomUUID(), tenantId: TENANT, automationId: ruleId, inspectionId: insp,
            recipient: 'resolved@example.com', channel: 'email', sendAt: new Date(Date.now() - 1000), status: 'pending',
        } as never);
        const sent: Array<{ subject: string; html: string }> = [];
        await svc.flush(stubEmailFor(sent), 'Acme', 'https://acme.example.com');
        expect(sent).toEqual([{ subject: 'Subj', html: 'Hi Resolved Name' }]);
    });
});
