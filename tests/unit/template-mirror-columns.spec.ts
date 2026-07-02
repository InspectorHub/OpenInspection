/**
 * PCA / multi-unit UI — templates.property_type / commercial_subtype are
 * server-derived from schema.propertyType / commercialSubtype on every save,
 * so the row columns and the schema JSON can never disagree.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { TemplateService, deriveTemplateMirrorColumns } from '../../server/services/template.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';

function buildSchema(top: Record<string, unknown> = {}) {
    return {
        schemaVersion: 2 as const,
        sections: [{ id: 's1', title: 'S', items: [{ id: 'i1', label: 'Item', type: 'text' as const }] }],
        ...top,
    };
}

describe('deriveTemplateMirrorColumns (pure)', () => {
    it('returns propertyType + subtype for a commercial template', () => {
        expect(deriveTemplateMirrorColumns(buildSchema({ propertyType: 'commercial', commercialSubtype: 'office' })))
            .toEqual({ propertyType: 'commercial', commercialSubtype: 'office' });
    });
    it('nulls subtype when propertyType is not commercial', () => {
        expect(deriveTemplateMirrorColumns(buildSchema({ propertyType: 'single-family', commercialSubtype: 'office' })))
            .toEqual({ propertyType: 'single-family', commercialSubtype: null });
    });
    it('nulls both when unspecified', () => {
        expect(deriveTemplateMirrorColumns(buildSchema()))
            .toEqual({ propertyType: null, commercialSubtype: null });
    });
});

describe('TemplateService mirror-column persistence', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: TemplateService;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'T', slug: 't', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svc = new TemplateService({} as any);
    });

    it('createTemplate writes property_type + commercial_subtype for a commercial template', async () => {
        const created = await svc.createTemplate(TENANT, 'Commercial', buildSchema({ propertyType: 'commercial', commercialSubtype: 'office' }));
        const row = await testDb.select().from(schema.templates).where(eq(schema.templates.id, created.id)).get();
        expect(row?.propertyType).toBe('commercial');
        expect(row?.commercialSubtype).toBe('office');
    });

    it('createTemplate leaves columns null for an unspecified template', async () => {
        const created = await svc.createTemplate(TENANT, 'Plain', buildSchema());
        const row = await testDb.select().from(schema.templates).where(eq(schema.templates.id, created.id)).get();
        expect(row?.propertyType ?? null).toBeNull();
        expect(row?.commercialSubtype ?? null).toBeNull();
    });

    it('updateTemplate re-derives columns when the schema drops the commercial fields', async () => {
        const created = await svc.createTemplate(TENANT, 'Commercial', buildSchema({ propertyType: 'commercial', commercialSubtype: 'office' }));
        await svc.updateTemplate(created.id, TENANT, undefined, buildSchema());
        const row = await testDb.select().from(schema.templates).where(eq(schema.templates.id, created.id)).get();
        expect(row?.propertyType ?? null).toBeNull();
        expect(row?.commercialSubtype ?? null).toBeNull();
    });
});
