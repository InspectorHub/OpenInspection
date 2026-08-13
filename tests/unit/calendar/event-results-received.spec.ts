// @vitest-environment node
/**
 * `results_received` used to be a dead state.
 *
 * It existed in the schema, in the API's Zod enum, and in EventService, which
 * wrote `results_received_at` and told nobody — the automation trigger list had
 * only `event.created` and `event.completed`. So the single moment a radon
 * client has been waiting 48 hours for notified no one, while "we completed the
 * pickup" did.
 *
 * These specs assert the two halves of that fix separately, because a trigger
 * that fires on BOTH transitions would pass a test that only looked at the
 * results one: completing the pickup is not the lab result arriving.
 */
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
import { asD1Db } from '../helpers/test-db';

const TENANT = '00000000-0000-0000-0000-000000000098';
const CLIENT = 'contact-client-rr';
const INSP   = 'insp-event-rr';

describe('EventService — event.results_received', () => {
    // This file times out at the 5s default under full-suite load while passing
    // in isolation, which reads like a flake but is not one. Measured alone:
    // 2769ms for the FIRST test and ~200ms for the other two — the first pays
    // one-time warm-up (better-sqlite3's native addon, the drizzle module
    // graph) that the per-test budget is charged for. The suite runs one fork
    // per spec file on 8 cores, so that warm-up roughly doubles under
    // contention and crosses 5s, and which file loses the race is chance.
    // The budget is the wrong size, not the test.
    vi.setConfig({ testTimeout: 30_000 });

    let svc: EventService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let eventTypeId: string;
    const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

    /**
     * Which TRIGGERS actually fired for an inspection, read back the way the
     * product does it — a queued `automation_logs` row, resolved through the
     * rule that produced it. Asserting on the rows alone would pass for a log
     * queued by the wrong rule entirely.
     */
    async function firedTriggers(inspectionId: string): Promise<string[]> {
        const logs = await testDb.select().from(schema.automationLogs)
            .where(eq(schema.automationLogs.inspectionId, inspectionId)).all();
        const rules = await testDb.select().from(schema.automations).all();
        const triggerById = new Map(rules.map(r => [r.id as string, r.trigger as string]));
        return logs
            .map(l => triggerById.get(l.automationId as string))
            .filter((t): t is string => Boolean(t));
    }

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new EventService({} as D1Database);

        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(testDb), TENANT, new Date(1));
        await testDb.insert(schema.contacts).values({
            id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane Client',
            email: 'jane@example.com', phone: null, createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Main St',
            date: '2026-08-01', status: 'confirmed', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        await new PeopleService({ DB: {} as D1Database })
            .addPerson(TENANT, INSP, CLIENT, roleProfileId('client'));

        await svc.bulkSeed(TENANT);
        eventTypeId = (await svc.listEventTypes(TENANT))[0].id as string;

        // Both rules exist up front, so "did not fire" below is a statement
        // about the trigger and not about a missing rule.
        await testDb.insert(schema.automations).values([
            {
                id: 'auto-results-received', tenantId: TENANT, name: 'Results Received',
                trigger: 'event.results_received', recipientKind: 'role',
                recipientRoleProfileId: roleProfileId('client'), delayMinutes: 0,
                active: true, createdAt: new Date(),
            },
            {
                id: 'auto-followup', tenantId: TENANT, name: 'Followup',
                trigger: 'event.completed', recipientKind: 'role',
                recipientRoleProfileId: roleProfileId('client'), delayMinutes: 0,
                active: true, createdAt: new Date(),
            },
        ]);
    });

    async function createEvent() {
        return svc.createEvent(TENANT, INSP, {
            eventTypeId, durationMin: 60,
            scheduledAt: new Date(Date.now() + 7 * 86_400_000),
        });
    }

    it('fires event.results_received when results are marked received', async () => {
        const event = await createEvent();
        await svc.updateEventStatus(TENANT, event.id, 'results_received');
        expect(await firedTriggers(INSP)).toContain('event.results_received');
    });

    it('does not fire it on completion', async () => {
        // Completing the pickup is not the same as the lab result arriving —
        // the sample only reaches the lab afterwards.
        const event = await createEvent();
        await svc.updateEventStatus(TENANT, event.id, 'completed');
        const fired = await firedTriggers(INSP);
        expect(fired).toContain('event.completed');
        expect(fired).not.toContain('event.results_received');
    });

    it('stamps the visit on the queued log so the copy can name the event type', async () => {
        // {{event_type_name}} is resolved from automation_logs.event_id at
        // delivery (deliver-email.ts). Without the stamp the client is told
        // "your  results are in".
        const event = await createEvent();
        await svc.updateEventStatus(TENANT, event.id, 'results_received');
        const logs = await testDb.select().from(schema.automationLogs)
            .where(eq(schema.automationLogs.automationId, 'auto-results-received')).all();
        expect(logs).toHaveLength(1);
        expect(logs[0].eventId).toBe(event.id);
        expect(logs[0].recipient).toBe('jane@example.com');
    });
});
