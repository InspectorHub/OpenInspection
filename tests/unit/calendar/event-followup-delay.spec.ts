// @vitest-environment node
/**
 * The follow-up delay is a property of the EVENT TYPE, not of the codebase.
 *
 * 72 hours was hard-coded in EventService. That is a radon answer — sampling is
 * a 48-hour standard and the lab takes its own time — and it is wrong for a
 * sewer scope, whose results exist the moment the camera comes out.
 *
 * Two properties matter and they pull in opposite directions, so both are
 * asserted: an untouched tenant must see exactly the old 72 hours on deploy,
 * and a tenant who configures ZERO must get zero. `||` instead of `??` passes
 * the first and silently fails the second, which is the whole trap.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { EventService } from '../../../server/services/event.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { asD1Db } from '../helpers/test-db';

const TENANT = '00000000-0000-0000-0000-000000000097';
const hours = (n: number) => n * 3600_000;
const COMPLETED_AT = Date.UTC(2026, 7, 3, 14, 0, 0);

describe('EventService.followUpSendAt — per-event-type delay', () => {
    let svc: EventService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let sewerEventTypeId: string;

    const setFollowUpHours = (id: string, followUpDelayHours: number) =>
        testDb.update(schema.eventTypes).set({ followUpDelayHours })
            .where(and(eq(schema.eventTypes.id, id), eq(schema.eventTypes.tenantId, TENANT)));

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new EventService({} as D1Database);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await svc.bulkSeed(TENANT);
        const types = await svc.listEventTypes(TENANT);
        sewerEventTypeId = types.find(t => t.slug === 'sewer_scope')!.id as string;
    });

    it('defaults to the existing 72 hours when unset', async () => {
        // Nothing moves for anyone on deploy. This is the whole safety property:
        // the seeded types carry no explicit value, so they land on the column
        // default, which is the constant that used to be in the code.
        const at = await svc.followUpSendAt(TENANT, sewerEventTypeId, COMPLETED_AT);
        expect(at - COMPLETED_AT).toBe(hours(72));
    });

    it('uses the event type value when configured', async () => {
        await setFollowUpHours(sewerEventTypeId, 6);
        const at = await svc.followUpSendAt(TENANT, sewerEventTypeId, COMPLETED_AT);
        expect(at - COMPLETED_AT).toBe(hours(6));
    });

    it('treats zero as a real value, not as unset', async () => {
        // A sewer scope's results exist when the camera comes out. Read with
        // `||`, this returns 72 hours and the setting cannot express its most
        // useful value at all.
        await setFollowUpHours(sewerEventTypeId, 0);
        expect(await svc.followUpSendAt(TENANT, sewerEventTypeId, COMPLETED_AT)).toBe(COMPLETED_AT);
    });

    it('falls back to 72 hours when the event type cannot be resolved', async () => {
        expect(await svc.followUpSendAt(TENANT, 'no-such-type', COMPLETED_AT) - COMPLETED_AT).toBe(hours(72));
        expect(await svc.followUpSendAt(TENANT, null, COMPLETED_AT) - COMPLETED_AT).toBe(hours(72));
    });

    it('never reads another tenant\'s setting', async () => {
        await testDb.insert(schema.tenants).values({
            id: 'other', name: 'Other', slug: 'other', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await setFollowUpHours(sewerEventTypeId, 0);
        // Same row id, different tenant asking: the scoped read finds nothing
        // and falls back rather than honouring a neighbour's configuration.
        expect(await svc.followUpSendAt('other', sewerEventTypeId, COMPLETED_AT) - COMPLETED_AT)
            .toBe(hours(72));
    });

    it('queues the follow-up log at the configured delay', async () => {
        // The value has to reach the row the cron reads, not just the helper.
        await testDb.insert(schema.contacts).values({
            id: 'contact-followup', tenantId: TENANT, type: 'client', name: 'Jane Client',
            email: 'jane@example.com', phone: null, createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-followup', tenantId: TENANT, propertyAddress: '1 Main St',
            date: '2026-08-01', status: 'confirmed', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        const { seedRoleProfiles } = await import('../../../server/services/seed/seed-role-profiles');
        await seedRoleProfiles(asD1Db(testDb), TENANT, new Date(1));
        const { PeopleService } = await import('../../../server/services/people.service');
        await new PeopleService({ DB: {} as D1Database })
            .addPerson(TENANT, 'insp-followup', 'contact-followup', `crp_${TENANT}_client`);
        await testDb.insert(schema.automations).values({
            id: 'auto-followup-delay', tenantId: TENANT, name: 'Followup', trigger: 'event.completed',
            recipientKind: 'role', recipientRoleProfileId: `crp_${TENANT}_client`, delayMinutes: 0,
            subjectTemplate: 'x', bodyTemplate: 'x', active: true, createdAt: new Date(),
        });
        await setFollowUpHours(sewerEventTypeId, 0);

        const before = Date.now();
        const event = await svc.createEvent(TENANT, 'insp-followup', {
            eventTypeId: sewerEventTypeId, durationMin: 60,
            scheduledAt: new Date(Date.now() + 7 * 86_400_000),
        });
        await svc.updateEventStatus(TENANT, event.id, 'completed');

        const log = await testDb.select().from(schema.automationLogs)
            .where(eq(schema.automationLogs.automationId, 'auto-followup-delay')).get();
        // Zero delay: "now", not three days from now.
        expect(new Date(log!.sendAt as Date).getTime()).toBeLessThan(before + hours(1));
    });
});
