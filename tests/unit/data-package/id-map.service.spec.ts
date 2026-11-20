/**
 * Import id-map service tests. The service runs against a real in-memory SQLite
 * database with the committed migrations applied, so the unique constraint and
 * tenant scoping are exercised for real — not mocked.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db';
import { asScopedDbSource } from '../helpers/test-db';
import { ImportIdMapService } from '../../../server/services/data-package/id-map.service';
import { importIdMap } from '../../../server/lib/db/schema/data-package';
import { eq } from 'drizzle-orm';

const TENANT = 'tenant-1';
const OTHER = 'tenant-2';
const PKG = 'pkg-1';

describe('ImportIdMapService', () => {
    let svc: ImportIdMapService;
    let db: any;

    beforeEach(() => {
        const setup = createTestDb();
        db = setup.db;
        svc = new ImportIdMapService(asScopedDbSource(setup.db as any), {
            now: () => 1_700_000_000_000,
            genId: (() => { let n = 0; return () => `map-${++n}`; })(),
        });
    });

    it('puts mappings in bulk and reads them back by source id', async () => {
        const written = await svc.putMany(TENANT, PKG, [
            { table: 'inspections', sourceId: 'i-1', newId: 'i-1' },
            { table: 'contacts', sourceId: 'c-1', newId: 'c-new' },
        ]);
        expect(written).toBe(2);
        expect((await svc.get(TENANT, PKG, 'inspections', 'i-1'))?.newId).toBe('i-1');
        const many = await svc.getMany(TENANT, PKG, 'contacts', ['c-1', 'missing']);
        expect(many.get('c-1')).toBe('c-new');
        expect(many.has('missing')).toBe(false);
        expect(await svc.get(TENANT, PKG, 'contacts', 'missing')).toBeNull();
    });

    it('is idempotent: replaying the same key writes nothing and never overwrites', async () => {
        await svc.putMany(TENANT, PKG, [{ table: 'inspections', sourceId: 'i-1', newId: 'i-1' }]);
        const second = await svc.putMany(TENANT, PKG, [{ table: 'inspections', sourceId: 'i-1', newId: 'DIFFERENT' }]);
        expect(second).toBe(0);
        expect((await svc.get(TENANT, PKG, 'inspections', 'i-1'))?.newId).toBe('i-1');
        expect(await db.select().from(importIdMap).where(eq(importIdMap.tenantId, TENANT)).all()).toHaveLength(1);
    });

    it('scopes every read and write by tenant', async () => {
        await svc.putMany(TENANT, PKG, [{ table: 'inspections', sourceId: 'i-1', newId: 'i-1' }]);
        expect(await svc.get(OTHER, PKG, 'inspections', 'i-1')).toBeNull();
        expect((await svc.getMany(OTHER, PKG, 'inspections', ['i-1'])).size).toBe(0);
        expect(await svc.listByPackage(OTHER, PKG)).toEqual([]);
        // Same package id in another tenant is a different mapping universe.
        expect(await svc.putMany(OTHER, PKG, [{ table: 'inspections', sourceId: 'i-1', newId: 'other-new' }])).toBe(1);
        expect((await svc.get(OTHER, PKG, 'inspections', 'i-1'))?.newId).toBe('other-new');
    });

    it('handles batches larger than the D1 bound-parameter cap', async () => {
        const entries = Array.from({ length: 250 }, (_, i) => ({
            table: 'contacts', sourceId: `c-${i}`, newId: `new-${i}`,
        }));
        expect(await svc.putMany(TENANT, PKG, entries)).toBe(250);
        const ids = entries.map((e) => e.sourceId);
        const many = await svc.getMany(TENANT, PKG, 'contacts', ids);
        expect(many.size).toBe(250);
        expect(many.get('c-249')).toBe('new-249');
        expect(await svc.listByPackage(TENANT, PKG)).toHaveLength(250);
    });

    it('lists a package for revert and answers the imported-inspection marker', async () => {
        await svc.putMany(TENANT, PKG, [
            { table: 'inspections', sourceId: 'i-1', newId: 'insp-kept' },
            { table: 'contacts', sourceId: 'c-1', newId: 'c-new' },
        ]);
        const rows = await svc.listByPackage(TENANT, PKG);
        expect(rows).toHaveLength(2);
        expect(await svc.isImportedInspection(TENANT, 'insp-kept')).toBe(true);
        expect(await svc.isImportedInspection(TENANT, 'c-new')).toBe(false); // wrong table
        expect(await svc.isImportedInspection(OTHER, 'insp-kept')).toBe(false); // wrong tenant
        expect(await svc.isImportedInspection(TENANT, 'ordinary-inspection')).toBe(false);
    });
});
