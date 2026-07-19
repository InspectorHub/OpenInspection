// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { EventService } from '../../../server/services/event.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000099';

describe('EventService', () => {
    let svc: EventService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new EventService({} as D1Database);
        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
    });

    describe('bulkSeed', () => {
        it('seeds 5 default event types on first run', async () => {
            const r = await svc.bulkSeed(TENANT);
            expect(r.seeded).toBe(5);
            expect(r.skipped).toBe(0);
            const types = await svc.listEventTypes(TENANT);
            expect(types).toHaveLength(5);
            expect(types.map(t => t.slug).sort()).toEqual(['mold_test', 'radon_dropoff', 'radon_pickup', 'sewer_scope', 'water_test']);
        });

        it('is idempotent — second run skips all 5', async () => {
            await svc.bulkSeed(TENANT);
            const r = await svc.bulkSeed(TENANT);
            expect(r.seeded).toBe(0);
            expect(r.skipped).toBe(5);
        });

        it('respects tenant scoping — seeds only for given tenant', async () => {
            await testDb.insert(schema.tenants).values([
                { id: 'other', name: 'Other', slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            ]);
            await svc.bulkSeed(TENANT);
            const otherTypes = await svc.listEventTypes('other');
            expect(otherTypes).toHaveLength(0);
        });
    });

    describe('computeReminderSendAt', () => {
        it('returns scheduled-24h when event is more than 24h out', () => {
            const scheduled = Date.now() + 7 * 86_400_000;
            const sendAt = svc.computeReminderSendAt(scheduled);
            expect(sendAt).toBe(scheduled - 86_400_000);
        });

        it('returns now+5min when event is in less than 24h', () => {
            const scheduled = Date.now() + 6 * 3600_000;
            const sendAt = svc.computeReminderSendAt(scheduled);
            const expectedMin = Date.now() + 4 * 60_000;
            const expectedMax = Date.now() + 10 * 60_000;
            expect(sendAt).toBeGreaterThanOrEqual(expectedMin);
            expect(sendAt).toBeLessThanOrEqual(expectedMax);
        });

        it('returns now+5min when scheduled time is in the past', () => {
            const scheduled = Date.now() - 60_000;
            const sendAt = svc.computeReminderSendAt(scheduled);
            expect(sendAt).toBeGreaterThan(Date.now());
        });
    });

    /**
     * Task 9b (people-role-profiles) — scheduleReminderLog / scheduleFollowupLog
     * must resolve the recipient via PeopleService.getPrimaryClient (the
     * inspection_people join) instead of the legacy inspection.clientEmail
     * column, which is being dropped (Task 13). The seeded inspection below
     * intentionally carries NULL legacy client columns — only the
     * inspection_people row supplies the primary client — so these specs fail
     * against the old implementation (which reads only inspection.clientEmail
     * and returns early with no log queued).
     */
    describe('scheduleReminderLog / scheduleFollowupLog — primary-client join', () => {
        const CLIENT = 'contact-client-1';
        const INSP = 'insp-event-1';
        const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;
        let eventTypeId: string;

        beforeEach(async () => {
            await seedRoleProfiles(testDb, TENANT, new Date(1));
            await testDb.insert(schema.contacts).values({
                id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane Client',
                email: 'jane@example.com', phone: null, createdAt: new Date(),
            });
            // Legacy client columns intentionally NULL — only inspection_people
            // carries the primary client for this inspection.
            await testDb.insert(schema.inspections).values({
                id: INSP, tenantId: TENANT, propertyAddress: '1 Main St',
                clientName: null, clientEmail: null, clientPhone: null,
                date: '2026-07-01', status: 'confirmed', paymentStatus: 'unpaid', price: 0,
                agreementRequired: false, paymentRequired: false, createdAt: new Date(),
            });
            const people = new PeopleService({ DB: {} as D1Database });
            await people.addPerson(TENANT, INSP, CLIENT, roleProfileId('client'));

            const seeded = await svc.bulkSeed(TENANT);
            expect(seeded.seeded).toBeGreaterThan(0);
            const types = await svc.listEventTypes(TENANT);
            eventTypeId = types[0].id as string;
        });

        it('createEvent queues a reminder log addressed to the primary client', async () => {
            await testDb.insert(schema.automations).values({
                id: 'auto-reminder-1', tenantId: TENANT, name: 'Reminder', trigger: 'event.created',
                recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'), delayMinutes: 0, subjectTemplate: 'x', bodyTemplate: 'x', active: true, createdAt: new Date(),
            });

            await svc.createEvent(TENANT, INSP, {
                eventTypeId, durationMin: 60,
                scheduledAt: new Date(Date.now() + 7 * 86_400_000),
            });

            const logs = await testDb.select().from(schema.automationLogs)
                .where(eq(schema.automationLogs.inspectionId, INSP)).all();
            expect(logs).toHaveLength(1);
            expect(logs[0].recipient).toBe('jane@example.com');
        });

        it('updateEventStatus(completed) queues a followup log addressed to the primary client', async () => {
            await testDb.insert(schema.automations).values({
                id: 'auto-followup-1', tenantId: TENANT, name: 'Followup', trigger: 'event.completed',
                recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'), delayMinutes: 0, subjectTemplate: 'x', bodyTemplate: 'x', active: true, createdAt: new Date(),
            });

            const event = await svc.createEvent(TENANT, INSP, {
                eventTypeId, durationMin: 60,
                scheduledAt: new Date(Date.now() + 7 * 86_400_000),
            });
            await svc.updateEventStatus(TENANT, event.id, 'completed');

            const logs = await testDb.select().from(schema.automationLogs)
                .where(eq(schema.automationLogs.inspectionId, INSP)).all();
            expect(logs).toHaveLength(1);
            expect(logs[0].recipient).toBe('jane@example.com');
        });

        it('no primary client at all — reminder log is skipped (same as legacy no-clientEmail behavior)', async () => {
            await testDb.delete(schema.inspectionPeople).where(eq(schema.inspectionPeople.inspectionId, INSP));
            await testDb.insert(schema.automations).values({
                id: 'auto-reminder-2', tenantId: TENANT, name: 'Reminder', trigger: 'event.created',
                recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'), delayMinutes: 0, subjectTemplate: 'x', bodyTemplate: 'x', active: true, createdAt: new Date(),
            });

            await svc.createEvent(TENANT, INSP, {
                eventTypeId, durationMin: 60,
                scheduledAt: new Date(Date.now() + 7 * 86_400_000),
            });

            const logs = await testDb.select().from(schema.automationLogs).all();
            expect(logs).toHaveLength(0);
        });
    });
});
