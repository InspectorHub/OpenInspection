// Automation email: {{inspector_name}} and {{event_inspector_name}} must render
// the display name of the right person, inside the log's own tenant only.
//
// Both tokens used to be initialised to '' in the email path and never set, so a
// seeded "Your inspector: {{inspector_name}}" rendered "Your inspector: ".
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import { lazyD1 } from '../helpers/d1-binding';
import { AutomationService } from '../../../server/services/automation.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import type { EmailService } from '../../../server/services/email.service';

const testD1 = lazyD1();
const T = '00000000-0000-0000-0000-0000000000a8';
const OTHER = '00000000-0000-0000-0000-0000000000a9';
const INSP = '00000000-0000-0000-0000-0000000000b1';
const roleProfileId = (key: string) => `crp_${T}_${key}`;
let db: BetterSQLite3Database<typeof schema>;

async function addUser(id: string, tenantId: string, name: string | null) {
    await db.insert(schema.users).values({
        id, tenantId, email: `${id}@example.test`, passwordHash: 'h', role: 'inspector', name, createdAt: new Date(),
    } as never);
}

async function addInspection(overrides: Record<string, unknown> = {}) {
    await db.insert(schema.inspections).values({
        id: INSP, tenantId: T, propertyAddress: '1 Main St', date: '2026-06-01', status: 'scheduled',
        reportStatus: 'draft', paymentStatus: 'unpaid', price: 50000,
        agreementRequired: false, paymentRequired: false, createdAt: new Date(), ...overrides,
    } as never);
    await db.insert(schema.contacts).values({
        id: 'contact-1', tenantId: T, type: 'client', name: 'Jane', email: 'client@example.test', createdAt: new Date(),
    } as never);
    await new PeopleService({ DB: testD1.binding }).addPerson(T, INSP, 'contact-1', roleProfileId('client'));
}

async function link(userId: string, tenantId: string, role: 'lead' | 'helper' = 'lead') {
    await db.insert(schema.inspectionInspectors).values({
        inspectionId: INSP, userId, tenantId, role, createdAt: new Date(),
    } as never);
}

/** Flush one pending log for the named seeded rule; return the captured email. */
async function flushSeed(ruleName: string, opts: { body?: string; eventId?: string } = {}) {
    const svc = new AutomationService(testD1.binding);
    await svc.ensureSeeds(T);
    const rule = (await db.select().from(schema.automations).where(eq(schema.automations.tenantId, T)))
        .find((a) => a.name === ruleName)!;
    if (opts.body) {
        await db.update(schema.messageTemplates).set({ body: opts.body })
            .where(eq(schema.messageTemplates.id, rule.emailTemplateId!));
    }
    await db.insert(schema.automationLogs).values({
        id: 'log-1', tenantId: T, automationId: rule.id, inspectionId: INSP,
        recipient: 'client@example.test', channel: 'email', sendAt: new Date(0), status: 'pending',
        ...(opts.eventId ? { eventId: opts.eventId } : {}),
    } as never);
    let captured: { subject: string; html: string } | null = null;
    const emailFor = async () => ({
        sendEmail: async (_to: string[], subject: string, html: string) => { captured = { subject, html }; return { delivered: true }; },
    } as unknown as EmailService);
    await svc.flush(emailFor, 'Acme Inspections', 'https://app.example.test');
    const log = await db.select().from(schema.automationLogs).where(eq(schema.automationLogs.id, 'log-1')).get();
    return { captured: captured as { subject: string; html: string } | null, log };
}

async function addEvent(inspectorId: string | null, tenantId = T) {
    await db.insert(schema.eventTypes).values({
        id: 'et-1', tenantId, name: 'Radon test', slug: 'radon', createdAt: new Date(),
    } as never);
    await db.insert(schema.inspectionEvents).values({
        id: 'ev-1', tenantId, inspectionId: INSP, eventTypeId: 'et-1', inspectorId,
        scheduledAt: new Date('2026-06-02T15:00:00Z'), durationMin: 60, createdAt: new Date(),
    } as never);
}

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    testD1.use(db);
    for (const [id, slug] of [[T, 'acme'], [OTHER, 'other']] as const) {
        await db.insert(schema.tenants).values({
            id, slug, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
    }
    await seedRoleProfiles(asD1Db(db), T, new Date(1));
});

describe('{{inspector_name}} in automation email', () => {
    it('renders the lead inspector on the seeded Booking Confirmation', async () => {
        await addUser('u-lead', T, 'Dana Whitfield');
        await addInspection();
        await link('u-lead', T);
        const { captured, log } = await flushSeed('Booking Confirmation');
        expect(log?.status).toBe('sent');
        expect(captured!.html).toContain('<p>Your inspector: Dana Whitfield</p>');
    });

    it('prefers the lead over a helper', async () => {
        await addUser('u-help', T, 'Helper Person');
        await addUser('u-lead', T, 'Dana Whitfield');
        await addInspection();
        await link('u-help', T, 'helper');
        await link('u-lead', T, 'lead');
        const { captured } = await flushSeed('Booking Confirmation');
        expect(captured!.html).toContain('Your inspector: Dana Whitfield');
        expect(captured!.html).not.toContain('Helper Person');
    });

    it('falls back to the legacy inspector column when there is no link row', async () => {
        await addUser('u-old', T, 'Legacy Lee');
        await addInspection({ inspectorId: 'u-old' });
        const { captured } = await flushSeed('Booking Confirmation');
        expect(captured!.html).toContain('Your inspector: Legacy Lee');
    });

    it('renders blank, and still sends, when nobody is assigned', async () => {
        await addInspection();
        const { captured, log } = await flushSeed('Booking Confirmation');
        expect(log?.status).toBe('sent');
        expect(captured!.html).toContain('<p>Your inspector: </p>');
    });

    it('renders blank when the assigned user has no display name', async () => {
        await addUser('u-noname', T, null);
        await addInspection();
        await link('u-noname', T);
        const { captured } = await flushSeed('Booking Confirmation');
        expect(captured!.html).toContain('<p>Your inspector: </p>');
        expect(captured!.html).not.toContain('u-noname@example.test');
    });

    it('never shows another tenant inspector (link row or legacy column)', async () => {
        await addUser('u-foreign', OTHER, 'Foreign Frank');
        await addInspection({ inspectorId: 'u-foreign' });
        await link('u-foreign', OTHER);
        const { captured } = await flushSeed('Booking Confirmation');
        expect(captured!.html).not.toContain('Foreign Frank');
        expect(captured!.html).toContain('<p>Your inspector: </p>');
    });

    it('does not expose the inspector email', async () => {
        await addUser('u-lead', T, 'Dana Whitfield');
        await addInspection();
        await link('u-lead', T);
        const { captured } = await flushSeed('Booking Confirmation');
        expect(captured!.html).not.toContain('u-lead@example.test');
    });
});

describe('{{event_inspector_name}} in automation email', () => {
    const body = '<p>{{event_type_name}} by {{event_inspector_name}}</p>';

    it('renders the inspector of the triggering event, not the lead', async () => {
        await addUser('u-lead', T, 'Dana Whitfield');
        await addUser('u-ev', T, 'Eli Okafor');
        await addInspection();
        await link('u-lead', T);
        await addEvent('u-ev');
        const { captured } = await flushSeed('Booking Confirmation', { body, eventId: 'ev-1' });
        expect(captured!.html).toBe('<p>Radon test by Eli Okafor</p>');
    });

    it('renders blank when the event has no inspector', async () => {
        await addInspection();
        await addEvent(null);
        const { captured } = await flushSeed('Booking Confirmation', { body, eventId: 'ev-1' });
        expect(captured!.html).toBe('<p>Radon test by </p>');
    });

    it('renders blank when the event inspector belongs to another tenant', async () => {
        await addUser('u-foreign', OTHER, 'Foreign Frank');
        await addInspection();
        await addEvent('u-foreign');
        const { captured } = await flushSeed('Booking Confirmation', { body, eventId: 'ev-1' });
        expect(captured!.html).toBe('<p>Radon test by </p>');
    });

    it('renders blank when the log has no event', async () => {
        await addUser('u-lead', T, 'Dana Whitfield');
        await addInspection();
        await link('u-lead', T);
        const { captured } = await flushSeed('Booking Confirmation', { body });
        expect(captured!.html).toBe('<p> by </p>');
    });
});
