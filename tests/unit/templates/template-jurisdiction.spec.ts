/**
 * Which jurisdiction a template is written to, as the list reports it.
 *
 * The New Inspection picker highlights its first row and Enter takes it, so the
 * order the list arrives in decides which template an inspection gets built
 * from. Until this field existed the list had no way to tell a general-purpose
 * template from a state's statutory form, so it could only fall back on
 * `created_at DESC` — and a workspace that had installed the Texas TREC form
 * most recently led with that form wherever it practised.
 *
 * The authority is `marketplace_libraries.jurisdiction`, the catalogue column
 * whose whole job is to say a pack is not for everybody. A template a workspace
 * authored itself names no catalogue entry and is general by definition.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { TestDb } from '../helpers/test-db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { TemplateService } from '../../../server/services/template.service';

const TENANT = 'tenant-jurisdiction';

describe('listTemplates reports the jurisdiction a template is written to', () => {
    let db: TestDb;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let service: TemplateService;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
        service = new TemplateService({} as unknown as D1Database);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'jurisdiction', createdAt: new Date(),
        });
        await db.insert(schema.marketplaceLibraries).values([
            {
                // A statutory pack. `jurisdiction` is what a statutory form IS.
                id: 'lib-trec', name: 'TREC REI 7-6', kind: 'statutory', semver: '1.0.1',
                schema: { schemaVersion: 2, sections: [] }, authorId: 'system',
                changelog: '', downloadCount: 0, featured: false,
                jurisdiction: 'TX',
                createdAt: new Date(), updatedAt: new Date(),
            },
            {
                // A catalogue pack written to no jurisdiction at all.
                id: 'lib-general', name: 'Standard Residential', kind: 'templates', semver: '1.0.0',
                schema: { schemaVersion: 2, sections: [] }, authorId: 'system',
                changelog: '', downloadCount: 0, featured: true,
                createdAt: new Date(), updatedAt: new Date(),
            },
        ]);
        await db.insert(schema.templates).values([
            { id: 'tpl-trec', tenantId: TENANT, name: 'TREC REI 7-6', schema: { schemaVersion: 2, sections: [] }, createdAt: new Date() },
            { id: 'tpl-general', tenantId: TENANT, name: 'Standard Residential', schema: { schemaVersion: 2, sections: [] }, createdAt: new Date() },
            { id: 'tpl-own', tenantId: TENANT, name: 'My own checklist', schema: { schemaVersion: 2, sections: [] }, createdAt: new Date() },
        ]);
        await db.insert(schema.tenantLibraryImports).values([
            { id: 'imp-trec', tenantId: TENANT, libraryId: 'lib-trec', importedSemver: '1.0.1', localEntityId: 'tpl-trec', rowCount: 0, importedAt: new Date() },
            { id: 'imp-general', tenantId: TENANT, libraryId: 'lib-general', importedSemver: '1.0.0', localEntityId: 'tpl-general', rowCount: 0, importedAt: new Date() },
        ]);
    });
    afterEach(() => { sqlite.close(); });

    it('carries the catalogue entry jurisdiction, and null where the entry names none', async () => {
        const { rows } = await service.listTemplates(TENANT);
        expect(rows.find(r => r.id === 'tpl-trec')?.jurisdiction).toBe('TX');
        // The positive control. A field hardwired to the first catalogue row's
        // value — or to any non-null string — would pass the assertion above and
        // fail both of these, which is the only reason they are here.
        expect(rows.find(r => r.id === 'tpl-general')?.jurisdiction).toBeNull();
        expect(rows.find(r => r.id === 'tpl-own')?.jurisdiction).toBeNull();
    });

    it('still reports a catalogue template as from the catalogue when its entry names no jurisdiction', async () => {
        // The jurisdiction read joins the catalogue; a join that dropped rows
        // would make an installed pack read as a template the workspace wrote.
        const { rows } = await service.listTemplates(TENANT);
        expect(rows.find(r => r.id === 'tpl-general')?.source).toBe('marketplace');
        expect(rows.find(r => r.id === 'tpl-own')?.source).toBe('custom');
    });
});
