import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';

/**
 * IA-26 — tenant-config allowInspectorChoice column + PATCH/GET round-trip.
 *
 * Verifies:
 *   1. tenantConfigs schema has allowInspectorChoice column mapped to allow_inspector_choice.
 *   2. Default value is false (migration default).
 *   3. Updating to true and reading back returns true (PATCH → GET round-trip).
 */
describe('tenant-config allowInspectorChoice — IA-26', () => {
    it('tenantConfigs schema has allowInspectorChoice column mapping allow_inspector_choice', () => {
        const t = tenantConfigs as unknown as Record<string, { name: string }>;
        expect(t.allowInspectorChoice?.name).toBe('allow_inspector_choice');
    });

    it('default for allowInspectorChoice is false, and PATCH → GET round-trip reads back true', async () => {
        const fixture = createTestDb();
        await setupSchema(fixture.sqlite);

        const TENANT = '00000000-0000-0000-0000-000000000a26';
        await fixture.db.insert(schema.tenants).values({
            id: TENANT,
            name: 'IA-26 Test Co',
            slug: 'ia26test',
            status: 'active',
            deploymentMode: 'shared',
            tier: 'free',
            createdAt: new Date(),
        });
        await fixture.db.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            updatedAt: new Date(),
        });

        // Verify default is false
        const [before] = await fixture.db.select({ v: schema.tenantConfigs.allowInspectorChoice })
            .from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, TENANT));
        expect(!!before?.v).toBe(false);

        // Simulate PATCH allowInspectorChoice = true
        await fixture.db.update(schema.tenantConfigs)
            .set({ allowInspectorChoice: true })
            .where(eq(schema.tenantConfigs.tenantId, TENANT));

        // Verify GET reads back true
        const [after] = await fixture.db.select({ v: schema.tenantConfigs.allowInspectorChoice })
            .from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, TENANT));
        expect(!!after?.v).toBe(true);
    });
});
