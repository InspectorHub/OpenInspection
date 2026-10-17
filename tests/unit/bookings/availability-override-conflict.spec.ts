/**
 * Adding a blocking override for a date that already has one, or for an inspector who is not in the company,
 * is a refusal about the request (409 / 400), not a database failure (500).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { AvailabilityService } from '../../../server/services/availability.service';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T1 = '00000000-0000-0000-0000-0000000000a1';
const T2 = '00000000-0000-0000-0000-0000000000a2';
const MINE = 'u-mine';
const THEIRS = 'u-theirs';

describe('AvailabilityService.addOverride refusals', () => {
    let service: AvailabilityService;
    let db: ReturnType<typeof createTestDb>['db'];

    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite);
        vi.mocked(mockDrizzle).mockReturnValue(db as never);
        const now = new Date();
        await db.insert(schema.tenants).values([T1, T2].map((id, i) => ({ id, slug: `t${i}`, status: 'active' as const, deploymentMode: 'shared' as const, tier: 'free' as const, createdAt: now })));
        await db.insert(schema.users).values([
            { id: MINE, tenantId: T1, email: 'mine@x.test', passwordHash: 'h', role: 'inspector', createdAt: now },
            { id: THEIRS, tenantId: T2, email: 'theirs@x.test', passwordHash: 'h', role: 'inspector', createdAt: now },
        ] as never);
        service = new AvailabilityService({} as D1Database);
    });

    const block = (inspectorId: string, date = '2026-12-24') => service.addOverride(T1, { inspectorId, date, isAvailable: false });

    it('a second blocking override on the same date answers 409', async () => {
        await block(MINE);
        await expect(block(MINE)).rejects.toMatchObject({ status: 409 });
    });

    it('control: another date, and an extra available window on the same date, still go through', async () => {
        await block(MINE);
        await expect(block(MINE, '2026-12-25')).resolves.toBeTruthy();
        await expect(service.addOverride(T1, { inspectorId: MINE, date: '2026-12-24', isAvailable: true, startTime: '09:00', endTime: '11:00' })).resolves.toBeTruthy();
    });

    it('an inspector who does not exist, or belongs to another company, answers the same 400', async () => {
        const missing = await block('u-nobody').catch((e: unknown) => e);
        const foreign = await block(THEIRS).catch((e: unknown) => e);
        expect(missing).toMatchObject({ status: 400 });
        expect(foreign).toMatchObject({ status: 400 });
        expect((foreign as Error).message).toBe((missing as Error).message);
    });
});
