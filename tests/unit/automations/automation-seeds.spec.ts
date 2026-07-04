import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    svc = new AutomationService({} as D1Database);
});

describe('Track J seeds (#122)', () => {
    it('seeds the follow-up (active) and review-request (inactive) rules', async () => {
        await svc.ensureSeeds(TENANT);
        const all = await db.select().from(schema.automations).where(eq(schema.automations.tenantId, TENANT));
        const followup = all.find(a => a.name === 'Post-inspection follow-up');
        const review   = all.find(a => a.name === 'Review request');
        expect(followup?.active).toBe(true);
        expect(followup?.delayMinutes).toBe(1440);
        expect(review?.active).toBe(false);                 // fail-closed until review_url set
        expect(review?.delayMinutes).toBe(4320);            // 3 days
        expect(review?.bodyTemplate).toContain('{{review_url}}');
    });

    it('is idempotent — running twice does not duplicate', async () => {
        await svc.ensureSeeds(TENANT);
        await svc.ensureSeeds(TENANT);
        const review = await db.select().from(schema.automations)
            .where(and(eq(schema.automations.tenantId, TENANT), eq(schema.automations.name, 'Review request')));
        expect(review.length).toBe(1);
    });
});
