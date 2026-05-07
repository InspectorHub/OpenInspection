import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { MarketplaceService } from '../../src/services/marketplace.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../src/lib/db/schema';
import { marketplaceTemplates } from '../../src/lib/db/schema/marketplace';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('MarketplaceService.importTemplate (Spec 1 fix verification)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: MarketplaceService;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'T', subdomain: 't', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svc = new MarketplaceService({} as any, TENANT);
    });

    it('Spec 5B P3 — rejects v1 marketplace templates with a clear error', async () => {
        // v1 shape: no schemaVersion, items use type:"rating" — must fail validation.
        const v1Schema = JSON.stringify({
            sections: [{ id: 's', title: 'S', items: [{ id: 'i', label: 'I', type: 'rating' }] }],
        });
        const marketplaceId = crypto.randomUUID();
        const now = new Date().toISOString();
        await testDb.insert(marketplaceTemplates).values({
            id:            marketplaceId,
            name:          'Legacy v1 Template',
            category:      'residential',
            semver:        '0.9.0',
            schema:        v1Schema,
            authorId:      'system',
            changelog:     'legacy',
            downloadCount: 0,
            createdAt:     now,
            updatedAt:     now,
        });

        await expect(svc.importTemplate(marketplaceId)).rejects.toThrow(/v2/i);

        // Confirm no row leaked into the tenant's templates table.
        const rows = await testDb.select().from(schema.templates).all();
        expect(rows.length).toBe(0);
    });

    it('imports a marketplace template with its sections intact (post-Spec1 fix)', async () => {
        // Seed marketplace_templates with the CORRECT shape that seed-marketplace.js now produces:
        // {sections: [...]} at the top level (not nested under a second .schema key).
        // Spec 5B — v2 schema shape: schemaVersion: 2 + rich items with tabs.
        const richItem = (id: string, label: string) => ({
            id, label, type: 'rich' as const,
            ratingOptions: ['Inspected', 'Not Inspected', 'Not Present', 'Repair', 'Safety Hazard'],
            tabs: { information: [], limitations: [], defects: [] },
        });
        const correctSchema = JSON.stringify({
            schemaVersion: 2,
            sections: [
                { id: 'sec1', title: 'Section 1', items: [richItem('i1', 'Item 1')] },
                { id: 'sec2', title: 'Section 2', items: [richItem('i2', 'Item 2')] },
            ],
        });
        const marketplaceId = crypto.randomUUID();
        const now = new Date().toISOString();
        await testDb.insert(marketplaceTemplates).values({
            id:            marketplaceId,
            name:          'Standard Residential Inspection',
            category:      'residential',
            semver:        '1.0.0',
            schema:        correctSchema,
            authorId:      'system',
            changelog:     'test',
            downloadCount: 0,
            createdAt:     now,
            updatedAt:     now,
        });

        const localTemplateId = await svc.importTemplate(marketplaceId);

        const localRow = await testDb
            .select()
            .from(schema.templates)
            .where(eq(schema.templates.id, localTemplateId))
            .get();

        expect(localRow).toBeTruthy();
        // schema column may come back as string or parsed object depending on drizzle mode
        const parsed =
            typeof localRow!.schema === 'string'
                ? JSON.parse(localRow!.schema)
                : localRow!.schema;
        expect(parsed.sections).toBeDefined();
        expect(parsed.sections.length).toBeGreaterThan(0);
        expect(parsed.sections[0].items.length).toBeGreaterThan(0);
    });
});
