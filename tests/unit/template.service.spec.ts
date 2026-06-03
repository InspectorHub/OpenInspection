import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemplateService } from '../../server/services/template.service';
import { CreateTemplateSchema, TemplateSchemaV2Schema } from '../../server/lib/validations/template.schema';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('Spec 5B — TemplateService + v2 schema round-trip', () => {
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
        svc = new TemplateService({} as D1Database);
    });

    const validV2 = {
        schemaVersion: 2 as const,
        sections: [
            {
                id: 's_roof',
                title: 'Roof',
                items: [
                    {
                        id: 'i_roof_cover',
                        label: 'Roof Covering',
                        type: 'rich' as const,
                        ratingOptions: ['Inspected', 'Not Inspected', 'Not Present', 'Repair', 'Safety Hazard'],
                        tabs: {
                            information: [
                                { id: 'ri1', title: 'Material',  comment: 'Asphalt composition shingles.', default: true },
                            ],
                            limitations: [
                                { id: 'rl1', title: 'Ground only', comment: 'Inspected from ground level.', default: true },
                            ],
                            defects: [
                                { id: 'rd1', title: 'Cracking',  category: 'safety' as const, location: '', comment: 'Major cracking observed.', photos: [], default: false },
                                { id: 'rd2', title: 'EOL',       category: 'maintenance' as const, location: '', comment: 'Near end of useful life.', photos: [], default: false },
                            ],
                        },
                    },
                    { id: 'i_overall', label: 'Overall', type: 'text' as const },
                ],
            },
        ],
    };

    it('Zod schema accepts a valid v2 document', () => {
        const result = TemplateSchemaV2Schema.safeParse(validV2);
        expect(result.success).toBe(true);
    });

    it('Zod schema rejects legacy v1 (type:"rating") documents', () => {
        const v1 = {
            sections: [{ id: 's', title: 'S', items: [{ id: 'i', label: 'I', type: 'rating' }] }],
        };
        const result = TemplateSchemaV2Schema.safeParse(v1);
        expect(result.success).toBe(false);
    });

    it('Zod CreateTemplateSchema parses a JSON string and validates v2', () => {
        const result = CreateTemplateSchema.safeParse({ name: 'My Tpl', schema: JSON.stringify(validV2) });
        expect(result.success).toBe(true);
    });

    it('rejects items with type "rich" but no tabs', () => {
        const broken = {
            schemaVersion: 2,
            sections: [{
                id: 's', title: 'S',
                items: [{ id: 'i', label: 'I', type: 'rich', ratingOptions: ['Inspected'] }],
            }],
        };
        const result = TemplateSchemaV2Schema.safeParse(broken);
        expect(result.success).toBe(false);
    });

    it('round-trips a v2 template through TemplateService.create + get', async () => {
        const created = await svc.createTemplate(TENANT, 'Spec 5B Test', validV2);
        expect(created.name).toBe('Spec 5B Test');

        const reloaded = await svc.getTemplate(created.id, TENANT);
        const parsed = typeof reloaded.schema === 'string'
            ? JSON.parse(reloaded.schema)
            : reloaded.schema;

        expect(parsed.schemaVersion).toBe(2);
        expect(parsed.sections[0].items[0].type).toBe('rich');
        expect(parsed.sections[0].items[0].tabs.information.length).toBe(1);
        expect(parsed.sections[0].items[0].tabs.defects.length).toBe(2);
        expect(parsed.sections[0].items[0].tabs.defects[0].category).toBe('safety');
    });

    it('updateTemplate increments version and re-validates schema', async () => {
        const created = await svc.createTemplate(TENANT, 'Spec 5B Update', validV2);
        const updated = await svc.updateTemplate(created.id, TENANT, undefined, validV2);
        expect((updated.version as number)).toBe(2);
    });

    it('createTemplate throws on non-v2 schema', async () => {
        await expect(
            svc.createTemplate(TENANT, 'Bad', { sections: [] } as unknown as Record<string, unknown>)
        ).rejects.toThrow();
    });
});
