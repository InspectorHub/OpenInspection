/**
 * Spec 1.3 + 1.6 — both TCPA-adjacent surfaces in `api/sms.ts` read the
 * COMPANY name, not the registration name.
 *
 * `tenants.name` is written once at provisioning and never updated; every
 * branded document uses `tenant_configs.company_name`. A consent record and a
 * carrier HELP reply must name the entity the client actually deals with.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { tenants, tenantConfigs } from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
// The resolver lives in lib/sms/brand-name.ts, not api/sms.ts: that router file
// sits on its 844-line size-gate cap, so the shared helper was extracted rather
// than inlined. `api/sms.ts` imports it at both TCPA-adjacent surfaces.
import { resolveSmsBrand } from '../../../server/lib/sms/brand-name';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('sms company name source', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);

        await testDb.insert(tenants).values({
            id: TENANT, slug: 'acme', name: 'Acme Registration Name',
            status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as typeof tenants.$inferInsert);
        await testDb.insert(tenantConfigs).values({
            tenantId: TENANT, companyName: 'Acme Home Inspections LLC', updatedAt: new Date(),
        } as typeof tenantConfigs.$inferInsert);
    });

    it('the HELP auto-reply brand uses companyName, not the registration name', async () => {
        const brand = await resolveSmsBrand(testDb as never, TENANT);
        expect(brand).toBe('Acme Home Inspections LLC');
        expect(brand).not.toBe('Acme Registration Name');
    });

    it('falls back to the registration name when no companyName is set', async () => {
        await testDb.update(tenantConfigs).set({ companyName: null })
            .where(eq(tenantConfigs.tenantId, TENANT));
        expect(await resolveSmsBrand(testDb as never, TENANT)).toBe('Acme Registration Name');
    });

    it('falls back to the platform name when the tenant is unknown', async () => {
        expect(await resolveSmsBrand(testDb as never, 'no-such-tenant', 'Inspector Hub'))
            .toBe('Inspector Hub');
    });
});
