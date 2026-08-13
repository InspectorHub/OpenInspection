/**
 * Spec 1.3 + 1.6 — both TCPA-adjacent surfaces in `api/sms.ts` name the entity
 * the client actually deals with.
 *
 * There is ONE company name now: `tenant_configs.company_name`. This spec used
 * to police a distinction between it and `tenants.name` — the registration name
 * written once at provisioning and never updated — and that column is gone,
 * backfilled into this one before it was dropped.
 *
 * What still matters, and matters MORE for SMS than anywhere else, is that the
 * brand is never empty and never silently becomes the platform's. A carrier
 * HELP reply saying "Inspector Hub" to someone who hired a local inspector is a
 * compliance answer about the wrong company. So the fallback chain is
 * company name -> slug -> platform, and the slug rung is what keeps the
 * platform name genuinely last.
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
            id: TENANT, slug: 'acme',
            status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as typeof tenants.$inferInsert);
        await testDb.insert(tenantConfigs).values({
            tenantId: TENANT, companyName: 'Acme Home Inspections LLC', updatedAt: new Date(),
        } as typeof tenantConfigs.$inferInsert);
    });

    it('the HELP auto-reply brand uses the company name from settings', async () => {
        const brand = await resolveSmsBrand(testDb as never, TENANT);
        expect(brand).toBe('Acme Home Inspections LLC');
    });

    it('falls back to the slug — not to the platform — when no companyName is set', async () => {
        // The rung that matters. Without it this jumps straight to "Inspector
        // Hub", which tells a client they are hearing from the platform rather
        // than from the inspector they hired.
        await testDb.update(tenantConfigs).set({ companyName: null })
            .where(eq(tenantConfigs.tenantId, TENANT));
        const brand = await resolveSmsBrand(testDb as never, TENANT, 'Inspector Hub');
        expect(brand).toBe('acme');
        expect(brand).not.toBe('Inspector Hub');
    });

    it('falls back to the platform name when the tenant is unknown', async () => {
        expect(await resolveSmsBrand(testDb as never, 'no-such-tenant', 'Inspector Hub'))
            .toBe('Inspector Hub');
    });
});
