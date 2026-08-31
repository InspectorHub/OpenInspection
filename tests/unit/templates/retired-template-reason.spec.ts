/**
 * Why a retired template is no longer on offer, as the picker reports it.
 *
 * A thing that vanishes without a reason is more unsettling than one that
 * leaves with a reason: an inspector's first conclusion is that their
 * permissions changed or the product broke. So the list keeps the row and says
 * which of the two things happened, and the two are genuinely different --
 * "replaced by a newer revision" is nothing to do about, while "uninstalled" is
 * something an administrator can undo.
 *
 * The distinction is DERIVED rather than stored. An update re-points the import
 * marker at the new local template, so the retired one is no longer named by
 * any marker; an uninstall stamps `uninstalled_at` on the marker that still
 * names it. A column recording the reason would be a third place for the same
 * fact and the first one to go stale.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { TestDb } from '../helpers/test-db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { TemplateService } from '../../../server/services/template.service';

const TENANT = 'tenant-retired-reason';

describe('a retired template says why it left', () => {
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
            id: TENANT, slug: 'retired-reason', createdAt: new Date(),
        });
        await db.insert(schema.marketplaceLibraries).values({
            id: 'lib1', name: 'TREC REI', kind: 'statutory', semver: '1.1.0',
            schema: { schemaVersion: 2, sections: [] }, authorId: 'system',
            changelog: '', downloadCount: 0, featured: false,
            createdAt: new Date(), updatedAt: new Date(),
        });
        await db.insert(schema.templates).values([
            {
                id: 'tpl-superseded', tenantId: TENANT, name: 'TREC REI 7-6',
                schema: { schemaVersion: 2, sections: [] },
                createdAt: new Date(), retiredAt: new Date(Date.UTC(2026, 2, 15)),
            },
            {
                id: 'tpl-current', tenantId: TENANT, name: 'TREC REI 7-7',
                schema: { schemaVersion: 2, sections: [] }, createdAt: new Date(),
            },
        ]);
    });
    afterEach(() => { sqlite.close(); });

    it('a template the update replaced reports itself superseded', async () => {
        // The marker now names the NEW local row: that is what an update does.
        await db.insert(schema.tenantLibraryImports).values({
            id: 'imp1', tenantId: TENANT, libraryId: 'lib1', importedSemver: '1.1.0',
            localEntityId: 'tpl-current', rowCount: 0, importedAt: new Date(),
        });

        const { rows } = await service.listTemplates(TENANT);
        const old = rows.find(r => r.id === 'tpl-superseded');
        expect(old?.retiredAt).not.toBeNull();
        expect(old?.retiredReason).toBe('superseded');

        // The positive control: a live template says nothing at all. A field
        // hardwired to 'superseded' would pass the assertion above.
        const live = rows.find(r => r.id === 'tpl-current');
        expect(live?.retiredAt).toBeNull();
        expect(live?.retiredReason).toBeNull();
    });

    it('a template the workspace uninstalled says so instead', async () => {
        // The marker still names this row, and carries the uninstall stamp.
        await db.insert(schema.tenantLibraryImports).values({
            id: 'imp1', tenantId: TENANT, libraryId: 'lib1', importedSemver: '1.0.0',
            localEntityId: 'tpl-superseded', rowCount: 0, importedAt: new Date(), uninstalledAt: new Date(Date.UTC(2026, 2, 15)),
        });

        const { rows } = await service.listTemplates(TENANT);
        const old = rows.find(r => r.id === 'tpl-superseded');
        // Not 'superseded': there is something an administrator can do about
        // this one, and one word for both would tell nobody which.
        expect(old?.retiredReason).toBe('uninstalled');
    });
});
