import { describe, it, expect, beforeEach } from 'vitest';
import { UpdateBrandingSchema } from '../../../server/lib/validations/admin.schema';
import { BrandingService } from '../../../server/services/branding.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();

describe('UpdateBrandingSchema — Round-2 #10 block-report-policy fields', () => {
    it('accepts blockUnpaid + blockUnsignedAgreement booleans', () => {
        const result = UpdateBrandingSchema.parse({
            blockUnpaid: true,
            blockUnsignedAgreement: false,
        });
        expect(result.blockUnpaid).toBe(true);
        expect(result.blockUnsignedAgreement).toBe(false);
    });

    it('rejects non-boolean values for blockUnpaid', () => {
        expect(() => UpdateBrandingSchema.parse({ blockUnpaid: 'yes' as unknown as boolean })).toThrow();
    });

    it('treats both fields as optional', () => {
        const result = UpdateBrandingSchema.parse({});
        expect(result.blockUnpaid).toBeUndefined();
        expect(result.blockUnsignedAgreement).toBeUndefined();
    });
});

describe('BrandingService — Round-2 #10 persistence', () => {
    const TENANT = '00000000-0000-0000-0000-000000000099';
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        testD1.use(testDb);

        await testDb.insert(schema.tenants).values({
            id: TENANT,
            slug: 'acme',
            status: 'active',
            deploymentMode: 'shared',
            tier: 'free',
            createdAt: new Date(),
        });
    });

    it('persists blockUnpaid + blockUnsignedAgreement via updateBranding()', async () => {
        const svc = new BrandingService(testD1.binding);

        await svc.updateBranding(TENANT, {
            blockUnpaid: true,
            blockUnsignedAgreement: true,
        });

        const cfg = await svc.getBranding(TENANT, {
            companyName: 'OpenInspection',
            primaryColor: '#4f46e5',
            supportEmail: 'support@example.com',
        });
        expect((cfg as { blockUnpaid?: boolean }).blockUnpaid).toBe(true);
        expect((cfg as { blockUnsignedAgreement?: boolean }).blockUnsignedAgreement).toBe(true);
    });

    it('toggles both flags back to false on subsequent update', async () => {
        const svc = new BrandingService(testD1.binding);

        await svc.updateBranding(TENANT, {
            blockUnpaid: true,
            blockUnsignedAgreement: true,
        });
        await svc.updateBranding(TENANT, {
            blockUnpaid: false,
            blockUnsignedAgreement: false,
        });

        const cfg = await svc.getBranding(TENANT, {
            companyName: 'OpenInspection',
            primaryColor: '#4f46e5',
            supportEmail: 'support@example.com',
        });
        expect((cfg as { blockUnpaid?: boolean }).blockUnpaid).toBe(false);
        expect((cfg as { blockUnsignedAgreement?: boolean }).blockUnsignedAgreement).toBe(false);
    });
});
