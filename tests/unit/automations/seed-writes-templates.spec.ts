import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

const TENANT = '00000000-0000-0000-0000-000000000001';
let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
    svc = new AutomationService({} as D1Database);
});

describe('ensureSeeds writes templates directly (no copy-then-backfill)', () => {
    it('a freshly seeded rule points at a template instead of carrying the copy', async () => {
        await svc.ensureSeeds(TENANT);
        const rule = await db.select().from(schema.automations)
            .where(and(eq(schema.automations.tenantId, TENANT), eq(schema.automations.name, 'Booking Confirmation'))).get();
        expect(rule!.emailTemplateId).toBeTruthy();
        const tpl = await db.select().from(schema.messageTemplates)
            .where(eq(schema.messageTemplates.id, rule!.emailTemplateId!)).get();
        expect(tpl!.subject).toContain('{{property_address}}');
        expect(tpl!.variables).toContain('property_address');   // extractVars still ran
    });
});
