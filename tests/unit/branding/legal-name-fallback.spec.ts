/**
 * Spec 1.5 + 2 — `tenant_configs.legal_name`, resolved in exactly one place.
 *
 * The column is NULLABLE and meant to stay that way: a sole proprietor trading
 * under their own registered name has ONE name and must not type it twice.
 * NULL means "same as companyName", and the fallback lives ONLY in
 * `BrandingService.getBrand` so no call site can forget it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { tenantConfigs, tenants } from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { BrandingService } from '../../../server/services/branding.service';
import { persistWizardLegalName } from '../../../server/lib/sms/persist-legal-name';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('getBrand legalName', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let branding: BrandingService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        // Same construction as tests/unit/branding/tenant-config-write-allowlist.spec.ts.
        branding = new BrandingService(
            {} as D1Database,
            undefined,
            { put: vi.fn().mockResolvedValue(undefined) } as unknown as R2Bucket,
        );
        await testDb.insert(tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    async function seedConfig(values: { companyName: string | null; legalName: string | null }) {
        await testDb.insert(tenantConfigs).values({
            tenantId: TENANT, ...values, updatedAt: new Date(),
        } as typeof tenantConfigs.$inferInsert);
    }

    it('returns the legal name when set', async () => {
        await seedConfig({ companyName: 'Acme Home Inspections', legalName: 'Acme Holdings LLC' });
        expect((await branding.getBrand(TENANT)).legalName).toBe('Acme Holdings LLC');
    });

    it('falls back to companyName when legalName is null', async () => {
        await seedConfig({ companyName: 'Acme Home Inspections', legalName: null });
        expect((await branding.getBrand(TENANT)).legalName).toBe('Acme Home Inspections');
    });

    // Not padding: a settings form submits '   ' for a field the user cleared,
    // and a fallback keyed only on null would put whitespace on an agreement.
    it('falls back to companyName when legalName is whitespace', async () => {
        await seedConfig({ companyName: 'Acme Home Inspections', legalName: '   ' });
        expect((await branding.getBrand(TENANT)).legalName).toBe('Acme Home Inspections');
    });

    it('is an empty string when the tenant has no config row at all', async () => {
        expect((await branding.getBrand('no-such-tenant')).legalName).toBe('');
    });

    // Work item 5 — the SMS compliance wizard stops asking for a name it already
    // has, AND a correction made there does not have to be made twice.
    it('a value stored by the SMS wizard is what Settings shows next', async () => {
        await seedConfig({ companyName: 'Acme Home Inspections', legalName: null });
        await persistWizardLegalName({} as D1Database, TENANT, 'Acme Holdings LLC');
        expect((await branding.getBrand(TENANT)).legalName).toBe('Acme Holdings LLC');
    });

    it('the wizard never writes blank over a stored legal name', async () => {
        await seedConfig({ companyName: 'Acme Home Inspections', legalName: 'Acme Holdings LLC' });
        await persistWizardLegalName({} as D1Database, TENANT, '   ');
        expect((await branding.getBrand(TENANT)).legalName).toBe('Acme Holdings LLC');
    });
});
