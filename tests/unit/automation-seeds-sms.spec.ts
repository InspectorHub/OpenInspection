import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../server/services/automation.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
let db: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db; await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
});

describe('Track L seeds', () => {
    it('touchpoint seeds carry compliance-safe sms_body, channels stay email-only, disclosure v1 seeded', async () => {
        const svc = new AutomationService({} as D1Database);
        await svc.ensureSeeds(TENANT);
        const booking = await db.select().from(schema.automations)
            .where(and(eq(schema.automations.tenantId, TENANT), eq(schema.automations.name, 'Booking Confirmation'))).get();
        expect(booking?.smsBody).toContain('{{company_name}}');
        expect(booking?.smsBody).toMatch(/Reply STOP/);
        expect(JSON.parse(booking!.channels)).toEqual(['email']);
        const disc = await db.select().from(schema.smsDisclosureVersions).get();
        expect(disc?.version).toBe(1);
    });
    it('is idempotent (second ensureSeeds adds no duplicate disclosure)', async () => {
        const svc = new AutomationService({} as D1Database);
        await svc.ensureSeeds(TENANT);
        await svc.ensureSeeds(TENANT);
        const discs = await db.select().from(schema.smsDisclosureVersions).all();
        expect(discs.length).toBe(1);
    });
});
