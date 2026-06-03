// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventService } from '../../server/services/event.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
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
});
