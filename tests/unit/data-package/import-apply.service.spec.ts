/**
 * Import apply-engine tests (core invariants).
 *
 * The apply engine writes one batch of one table: it is idempotent by source id,
 * tenant-scoped from the job, rewrites every package id through the id-map,
 * refuses a row whose parent was never imported (never creating an orphan),
 * honours keep-ids vs rewrite, and never calls a writer/automation/mail path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db';
import { asScopedDbSource } from '../helpers/test-db';
import { DataPackageApplyService } from '../../../server/services/data-package/import-apply.service';
import { contacts, inspectionResults, inspections } from '../../../server/lib/db/schema';
import { tenants } from '../../../server/lib/db/schema';
import { importIdMap } from '../../../server/lib/db/schema/data-package';

const TENANT = 'tenant-target';
const PKG = 'pkg-1';

describe('DataPackageApplyService', () => {
    let db: any;
    let genCounter: () => string;

    const makeSvc = (keepIds: boolean, extra: Record<string, unknown> = {}) => new DataPackageApplyService(
        asScopedDbSource(db),
        {
            now: () => 1_700_000_000_000,
            genId: genCounter,
            keepIds,
            ...extra,
        } as any,
    );

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        let n = 0;
        genCounter = () => `new-${++n}`;
        await db.insert(tenants).values({ id: TENANT, slug: 'target', createdAt: new Date(1_700_000_000_000) });
    });

    const contactRow = (id: string, name: string) => ({
        id, tenant_id: 'FORGED-SOURCE-TENANT', name, email: `${name.toLowerCase()}@x.test`, type: 'client',
        created_at: 1_700_000_000_000,
    });

    it('inserts rows with the job tenant, ignoring a forged tenant_id in the package', async () => {
        const r = await makeSvc(true).applyBatch(TENANT, PKG, 'contacts', [contactRow('c-1', 'Alice')]);
        expect(r.created.contacts).toBe(1);
        const rows = await db.select().from(contacts).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.id).toBe('c-1');
        expect(rows[0]!.tenantId).toBe(TENANT); // forged value overwritten
    });

    it('is idempotent: applying the same package twice creates nothing new', async () => {
        const svc = makeSvc(true);
        await svc.applyBatch(TENANT, PKG, 'contacts', [contactRow('c-1', 'Alice')]);
        const second = await svc.applyBatch(TENANT, PKG, 'contacts', [contactRow('c-1', 'Alice')]);
        expect(second.created.contacts ?? 0).toBe(0);
        expect(second.skipped.contacts).toBe(1);
        expect(await db.select().from(contacts).all()).toHaveLength(1);
    });

    it('uses a fresh id in rewrite mode and keeps the id in keep-ids mode', async () => {
        await makeSvc(false).applyBatch(TENANT, PKG, 'contacts', [contactRow('src-id', 'Bob')]);
        const rows = await db.select().from(contacts).all();
        expect(rows[0]!.id).toBe('new-1');
        const map = await db.select().from(importIdMap).where(eq(importIdMap.tenantId, TENANT)).all();
        expect(map[0]!.sourceId).toBe('src-id');
        expect(map[0]!.newId).toBe('new-1');
    });

    it('reports a child whose parent is missing instead of creating an orphan', async () => {
        // inspection_results references inspections; no inspection was imported.
        const r = await makeSvc(true).applyBatch(TENANT, PKG, 'inspection_results', [{
            id: 'res-1', tenant_id: TENANT, inspection_id: 'never-imported',
            data: '{}', last_synced_at: 1_700_000_000_000,
        }]);
        expect(r.created.inspection_results ?? 0).toBe(0);
        expect(r.rejected.some((x) => x.code.startsWith('missing_parent'))).toBe(true);
        const children = await db.select().from(inspectionResults).all();
        expect(children).toHaveLength(0);
    });

    it('keeps a blob column byte-for-byte in keep-ids mode', async () => {
        // Seed the parent inspection directly (this test is about blob bytes,
        // not about the inspection's many notNull columns) + its id-map entry.
        await db.insert(inspections).values({
            id: 'insp-1', tenantId: TENANT, propertyAddress: 'x', status: 'scheduled',
            date: '2026-01-01', createdAt: new Date(1_700_000_000_000),
        } as never);
        await db.insert(importIdMap).values({
            id: 'map-insp', tenantId: TENANT, packageId: PKG, tableName: 'inspections',
            sourceId: 'insp-1', newId: 'insp-1', createdAt: new Date(1_700_000_000_000),
        } as never);
        const bytes = [1, 2, 3, 255, 0, 128];
        const res = await makeSvc(true).applyBatch(TENANT, PKG, 'inspection_results', [{
            id: 'res-1', tenant_id: TENANT, inspection_id: 'insp-1',
            data: '{}', last_synced_at: 1_700_000_000_000,
            ydoc_state: { type: 'Buffer', data: bytes },
        }]);
        expect(res.rejected).toEqual([]); // surface any insert/parent failure
        const stored = await db.select().from(inspectionResults).all();
        expect(stored).toHaveLength(1);
        expect(Array.from(new Uint8Array(stored[0]!.ydocState!))).toEqual(bytes);
    });

    it('is tenant-isolated: the same source id in two tenants maps to different rows', async () => {
        await db.insert(tenants).values({ id: 'other', slug: 'other', createdAt: new Date(1_700_000_000_000) });
        // SaaS (multi-tenant) uses rewrite mode; keep-ids is only for a single-tenant target.
        await makeSvc(false).applyBatch(TENANT, PKG, 'contacts', [contactRow('c-1', 'A')]);
        const r = await makeSvc(false).applyBatch('other', PKG, 'contacts', [contactRow('c-1', 'B')]);
        expect(r.created.contacts).toBe(1);
        const otherRows = await db.select().from(contacts).where(eq(contacts.tenantId, 'other'));
        expect(otherRows).toHaveLength(1);
        expect(otherRows[0]!.id).not.toBe('c-1'); // rewritten, no collision
        const all = await db.select().from(contacts).all();
        expect(new Set(all.map((c: { id: string }) => c.id)).size).toBe(2); // distinct ids
    });
});
