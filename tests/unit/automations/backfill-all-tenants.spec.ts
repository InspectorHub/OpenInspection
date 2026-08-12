import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { backfillAllTenants } from '../../../server/services/message-template-backfill';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// `backfillAutomationTemplates` (and now `backfillAllTenants`) call
// `drizzle(db)` internally rather than accepting a Drizzle instance, so the
// only seam available to a test is `drizzle-orm/d1`'s factory itself — mocked
// here to return the real in-memory better-sqlite3 handle. `vi.doMock`ing the
// service module under test would not work: the function under test and the
// function it delegates to live in the SAME module, so a doMock of that
// module cannot intercept its own internal call. Mocking the shared `drizzle`
// factory instead means `backfillAutomationTemplates` really runs per tenant,
// which is a more faithful test of "visits every tenant" than a stub anyway.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

async function seedTenant(testDb: BetterSQLite3Database<typeof schema>, id: string) {
    await testDb.insert(schema.tenants).values({ id, slug: id, createdAt: new Date() });
}

// name+trigger matches the real 'Report Ready' seed, so backfillAutomationTemplates'
// seed-fallback (message-template-backfill.ts) has content to recover — the dead
// automations.subject_template/body_template/sms_body columns are gone, and a
// matching seed is now the ONLY source of copy for a rule with no template id.
async function seedAuto(testDb: BetterSQLite3Database<typeof schema>, tenantId: string, id: string) {
    await testDb.insert(schema.automations).values({
        id, tenantId, name: 'Report Ready', trigger: 'report.published',
        recipientKind: 'inspector', recipientRoleProfileId: null, delayMinutes: 0,
        channels: '["email"]',
        active: true, isDefault: true, createdAt: new Date(),
    });
}

describe('backfillAllTenants', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    });

    it('visits every tenant, not just the caller\'s', async () => {
        // Two tenants, neither of them a distinguished "caller" — there is no
        // caller tenantId in scope at all, which is the requirement under test.
        await seedTenant(testDb, 't-a');
        await seedTenant(testDb, 't-b');
        await seedAuto(testDb, 't-a', 'a1');
        await seedAuto(testDb, 't-b', 'b1');

        const result = await backfillAllTenants({} as D1Database);

        expect(result).toEqual({ tenants: 2, created: 2 });

        const a = await testDb.select().from(schema.automations).where(eq(schema.automations.id, 'a1')).get();
        const b = await testDb.select().from(schema.automations).where(eq(schema.automations.id, 'b1')).get();
        expect(a!.emailTemplateId).toBeTruthy();
        expect(b!.emailTemplateId).toBeTruthy();
    });

    it('is a no-op over zero tenants', async () => {
        const result = await backfillAllTenants({} as D1Database);
        expect(result).toEqual({ tenants: 0, created: 0 });
    });
});
