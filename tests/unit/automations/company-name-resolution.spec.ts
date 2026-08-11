import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { tenantConfigs, tenants } from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { resolveAutomationCompanyName } from '../../../server/services/automation/company-name';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('resolveAutomationCompanyName', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        // `tenant_configs.tenant_id` carries a real FK to `tenants`, so a config
        // row with no tenant fails the INSERT rather than the assertion.
        await testDb.insert(tenants).values({
            id: TENANT, slug: 'acme', name: 'Acme Registration Name',
            status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as typeof tenants.$inferInsert);
    });

    it('returns the tenant company name when set', async () => {
        await testDb.insert(tenantConfigs).values({
            tenantId: TENANT, companyName: 'Acme Home Inspections LLC', updatedAt: new Date(),
        } as typeof tenantConfigs.$inferInsert);
        expect(await resolveAutomationCompanyName(testDb as never, TENANT))
            .toBe('Acme Home Inspections LLC');
    });

    // A blank sign-off is honest; a platform sign-off is a lie. An email ending
    // "— OpenInspection" tells the client they are corresponding with the
    // platform. '' renders "— " and reads as a template gap, which produces a
    // bug report rather than a false statement about who wrote the email.
    it('returns an empty string rather than the platform name when unset', async () => {
        await testDb.insert(tenantConfigs).values({
            tenantId: TENANT, companyName: null, updatedAt: new Date(),
        } as typeof tenantConfigs.$inferInsert);
        expect(await resolveAutomationCompanyName(testDb as never, TENANT)).toBe('');
    });

    it('returns an empty string when the tenant has no config row at all', async () => {
        expect(await resolveAutomationCompanyName(testDb as never, 'no-such-tenant')).toBe('');
    });
});
