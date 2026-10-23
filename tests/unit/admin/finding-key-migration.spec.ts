/**
 * The legacy finding-key migration over results rows
 * (`POST /api/admin/migrate-finding-keys`, logic in
 * `server/lib/inspection/finding-key-migration.ts`).
 *
 * A real in-memory database stands in for D1; the Durable Object is a recording
 * stub, because what is under test is who is asked to do the work and what is
 * left alone, not the object itself (tests/workers/collab-legacy-key-rename.spec.ts
 * runs the real one, including through the admin route).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections, inspectionResults } from '../../../server/lib/db/schema';
import {
    migrateFindingKeys,
    renameThroughDurableObject,
    rewriteLegacyKeys,
    type RenameInDocument,
} from '../../../server/lib/inspection/finding-key-migration';
import { createTestDb, setupSchema } from '../db';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const SNAPSHOT = { sections: [{ id: 's1', items: [{ id: 'roof' }, { id: 'attic' }] }] };
const SIGNATURE = { signatureBase64: 'sig', signedAt: 1 };
const NO_RENAMES = { renamed: 0, skippedMeta: 0, skippedUnknown: 0, skippedAmbiguous: 0, conflicts: 0 };

describe('finding-key migration', () => {
    let fix: ReturnType<typeof createTestDb>;
    let db: DrizzleD1Database;

    beforeEach(async () => {
        fix = createTestDb();
        await setupSchema(fix.sqlite);
        fix.sqlite.pragma('foreign_keys = OFF');
        db = fix.db as unknown as DrizzleD1Database;
    });

    async function seed(opts: {
        inspectionId: string;
        data: Record<string, unknown>;
        tenantId?: string;
        reportId?: string | null;
        withState?: boolean;
        /** A second results row (a sibling report) for the same inspection. */
        sibling?: Record<string, unknown>;
    }): Promise<string> {
        const tenantId = opts.tenantId ?? TENANT;
        await fix.db.insert(inspections).values({
            id: opts.inspectionId, tenantId, propertyAddress: '1 Main St', date: '2026-01-01',
            createdAt: new Date(), templateSnapshot: SNAPSHOT,
        } as typeof inspections.$inferInsert);
        const rowId = `row-${opts.inspectionId}`;
        await fix.db.insert(inspectionResults).values({
            id: rowId, tenantId, inspectionId: opts.inspectionId,
            reportId: opts.reportId === undefined ? `rpt-${opts.inspectionId}` : opts.reportId,
            data: opts.data, lastSyncedAt: new Date(),
            ...(opts.withState ? { ydocState: new Uint8Array([1, 2, 3]) } : {}),
        } as typeof inspectionResults.$inferInsert);
        if (opts.sibling) {
            await fix.db.insert(inspectionResults).values({
                id: `${rowId}-sibling`, tenantId, inspectionId: opts.inspectionId, reportId: `rpt-${opts.inspectionId}-2`,
                data: opts.sibling, lastSyncedAt: new Date(),
            } as typeof inspectionResults.$inferInsert);
        }
        return rowId;
    }

    async function dataOf(rowId: string): Promise<Record<string, unknown>> {
        const row = await fix.db.select().from(inspectionResults).where(eq(inspectionResults.id, rowId)).get();
        return row?.data as Record<string, unknown>;
    }

    const collabOff = () => fix.sqlite.prepare('INSERT INTO tenant_configs (tenant_id, is_collab_editing_enabled, updated_at) VALUES (?, 0, 1)').run(TENANT);
    const neverCalled: RenameInDocument = () => Promise.reject(new Error('this row must not wake a document'));
    const answers = (counts: Partial<typeof NO_RENAMES> = {}): RenameInDocument => () => Promise.resolve({ ...NO_RENAMES, ...counts });
    const sumOfRows = (o: Awaited<ReturnType<typeof migrateFindingKeys>>) => o.migrated + o.delegated + o.failed + o.skipped;

    it('rewrites a row in D1 and leaves the meta key alone when there is no document to ask', async () => {
        const rowId = await seed({ inspectionId: 'i1', data: { roof: { rating: 'D' }, _inspector_signature: SIGNATURE } });

        const out = await migrateFindingKeys(db, TENANT, null);

        expect(out).toMatchObject({ processed: 1, migrated: 1, skipped: 0, delegated: 0, failed: 0, failedIds: [] });
        expect(await dataOf(rowId)).toEqual({
            '_default:s1:roof': { rating: 'D' },
            _inspector_signature: SIGNATURE,
        });
    });

    it('never rewrites a meta key, whatever it is called', () => {
        const out = rewriteLegacyKeys({ _inspector_signature: SIGNATURE, _anything: 1, roof: { rating: 'D' } }, new Map([['roof', 's1']]));
        expect(Object.keys(out.data).sort()).toEqual(['_anything', '_default:s1:roof', '_inspector_signature']);
        expect(rewriteLegacyKeys({ _inspector_signature: SIGNATURE }, new Map()).changed).toBe(false);
    });

    it('lets the legacy entry replace an empty composite seed, but never one that holds content', () => {
        const map = new Map([['roof', 's1']]);
        const seeded = rewriteLegacyKeys({ roof: { rating: 'D' }, '_default:s1:roof': {} }, map);
        expect(seeded.data).toEqual({ '_default:s1:roof': { rating: 'D' } });
        expect(seeded.changed).toBe(true);

        const filled = rewriteLegacyKeys({ roof: { rating: 'D' }, '_default:s1:roof': { rating: 'S' } }, map);
        expect(filled.data).toEqual({ roof: { rating: 'D' }, '_default:s1:roof': { rating: 'S' } });
        expect(filled.changed).toBe(false);
    });

    it('files a legacy key that names no template item under _unknown, as it always did', async () => {
        const rowId = await seed({ inspectionId: 'i1', data: { gone: { rating: 'D' } } });
        await migrateFindingKeys(db, TENANT, null);
        expect(Object.keys(await dataOf(rowId))).toEqual(['_default:_unknown:gone']);
    });

    describe('a row with collab state', () => {
        it('is handed to its document and D1 is not written', async () => {
            const original = { roof: { rating: 'D' }, _inspector_signature: SIGNATURE };
            const rowId = await seed({ inspectionId: 'i1', data: original, withState: true });
            const asked: Array<[string, string]> = [];

            const out = await migrateFindingKeys(db, TENANT, async (reportId, inspectionId) => {
                asked.push([reportId, inspectionId]);
                return { ...NO_RENAMES, renamed: 1 };
            });

            expect(out).toEqual({ processed: 1, migrated: 0, skipped: 0, delegated: 1, failed: 0, failedIds: [], renamedInDocuments: 1, conflicts: 0 });
            expect(asked).toEqual([['rpt-i1', 'i1']]);
            expect(await dataOf(rowId)).toEqual(original);
        });

        it('is handed to its document even when the blob is already composite, because the blob cannot say what the document holds', async () => {
            // What an older, D1-only migration leaves behind: composite blob, bare keys still in the document.
            const rowId = await seed({ inspectionId: 'i1', data: { '_default:s1:roof': { rating: 'D' } }, withState: true });
            const asked: string[] = [];

            const out = await migrateFindingKeys(db, TENANT, async (reportId) => { asked.push(reportId); return { ...NO_RENAMES, renamed: 1 }; });

            expect(asked).toEqual(['rpt-i1']);
            expect(out).toMatchObject({ delegated: 1, skipped: 0, renamedInDocuments: 1 });
            expect(await dataOf(rowId)).toEqual({ '_default:s1:roof': { rating: 'D' } });
        });

        it('is handed to its document even when the blob is empty', async () => {
            await seed({ inspectionId: 'i1', data: {}, withState: true });
            expect(await migrateFindingKeys(db, TENANT, answers())).toMatchObject({ delegated: 1, skipped: 0 });
        });

        it('is addressed by the inspection primary report when the row carries no report id', async () => {
            await seed({ inspectionId: 'i1', data: { roof: { rating: 'D' } }, withState: true, reportId: null });
            fix.sqlite.prepare(
                "INSERT INTO reports (id, tenant_id, inspection_id, kind, title, created_at) VALUES ('rpt-primary', ?, 'i1', 'primary', 'Report', 1)",
            ).run(TENANT);
            const asked: string[] = [];
            await migrateFindingKeys(db, TENANT, async (reportId) => { asked.push(reportId); return NO_RENAMES; });
            expect(asked).toEqual(['rpt-primary']);
        });

        it('is reported as failed, and not rewritten, when no document can be asked', async () => {
            const rowId = await seed({ inspectionId: 'i1', data: { roof: { rating: 'D' } }, withState: true });
            const out = await migrateFindingKeys(db, TENANT, null);
            expect(out).toMatchObject({ delegated: 0, failed: 1, failedIds: ['i1'] });
            expect(Object.keys(await dataOf(rowId))).toEqual(['roof']);
        });

        it('reports a document failure and carries on with the rest of the batch', async () => {
            await seed({ inspectionId: 'i1', data: { roof: { rating: 'D' } }, withState: true });
            const plain = await seed({ inspectionId: 'i2', data: { attic: { rating: 'S' } } });

            const out = await migrateFindingKeys(db, TENANT, (reportId) => reportId === 'rpt-i1' ? Promise.reject(new Error('object unavailable')) : Promise.resolve(NO_RENAMES));

            // i2 is also handed to its document (collaboration is on by default), which answers.
            expect(out).toMatchObject({ processed: 2, delegated: 1, failed: 1, failedIds: ['i1'] });
            expect(Object.keys(await dataOf(plain))).toEqual(['attic']);
        });

        it('sums what the documents report into the response', async () => {
            await seed({ inspectionId: 'i1', data: { roof: {} }, withState: true });
            await seed({ inspectionId: 'i2', data: { attic: {} }, withState: true });
            const out = await migrateFindingKeys(db, TENANT, answers({ renamed: 2, conflicts: 3 }));
            expect(out).toMatchObject({ delegated: 2, renamedInDocuments: 4, conflicts: 6 });
        });
    });

    describe('a row without collab state', () => {
        it('is handed to its document when collaboration is on, so the object imports and renames in one place', async () => {
            const original = { roof: { rating: 'D' } };
            const rowId = await seed({ inspectionId: 'i1', data: original });
            const asked: string[] = [];

            const out = await migrateFindingKeys(db, TENANT, async (reportId) => { asked.push(reportId); return { ...NO_RENAMES, renamed: 1 }; });

            expect(asked).toEqual(['rpt-i1']);
            expect(out).toMatchObject({ delegated: 1, migrated: 0, renamedInDocuments: 1 });
            expect(await dataOf(rowId)).toEqual(original);
        });

        it('is rewritten in D1 when the tenant switched collaboration off', async () => {
            collabOff();
            const rowId = await seed({ inspectionId: 'i1', data: { roof: { rating: 'D' } } });
            const out = await migrateFindingKeys(db, TENANT, neverCalled);
            expect(out).toMatchObject({ migrated: 1, delegated: 0 });
            expect(Object.keys(await dataOf(rowId))).toEqual(['_default:s1:roof']);
        });

        it('is rewritten in D1 when the inspection has several results rows, which the object cannot tell apart', async () => {
            const rowId = await seed({ inspectionId: 'i1', data: { roof: { rating: 'D' } }, sibling: { attic: { rating: 'S' } } });
            const out = await migrateFindingKeys(db, TENANT, neverCalled);
            expect(out).toMatchObject({ processed: 2, migrated: 2, delegated: 0 });
            expect(Object.keys(await dataOf(rowId))).toEqual(['_default:s1:roof']);
        });

        it('is rewritten in D1 when the blob names no template item, because there is nothing to rename in a document', async () => {
            const rowId = await seed({ inspectionId: 'i1', data: { gone: { rating: 'D' } } });
            const out = await migrateFindingKeys(db, TENANT, neverCalled);
            expect(out).toMatchObject({ migrated: 1, delegated: 0 });
            expect(Object.keys(await dataOf(rowId))).toEqual(['_default:_unknown:gone']);
        });
    });

    it('counts every row exactly once: processed is migrated + delegated + failed + skipped', async () => {
        collabOff();
        await seed({ inspectionId: 'i1', data: { roof: { rating: 'D' } } });
        await seed({ inspectionId: 'i2', data: { '_default:s1:roof': { rating: 'D' } } });
        await seed({ inspectionId: 'i3', data: {} });
        await seed({ inspectionId: 'i4', data: { roof: {} }, withState: true });
        await seed({ inspectionId: 'i5', data: { roof: {} }, withState: true });
        await fix.db.insert(inspections).values({
            id: 'i6', tenantId: TENANT, propertyAddress: 'x', date: '2026-01-01', createdAt: new Date(),
        } as typeof inspections.$inferInsert);

        const out = await migrateFindingKeys(db, TENANT, (reportId) => reportId === 'rpt-i5' ? Promise.reject(new Error('down')) : Promise.resolve(NO_RENAMES));

        expect(out).toMatchObject({ processed: 5, migrated: 1, delegated: 1, failed: 1, skipped: 2, failedIds: ['i5'] });
        expect(sumOfRows(out)).toBe(out.processed);
    });

    it('walks every inspection exactly once across pages', async () => {
        collabOff();
        for (let n = 0; n < 120; n++) await seed({ inspectionId: `insp-${String(n).padStart(3, '0')}`, data: { roof: { rating: 'D' } } });
        const out = await migrateFindingKeys(db, TENANT, null);
        expect(out).toMatchObject({ processed: 120, migrated: 120 });
    });

    it('is idempotent: a second run changes and delegates nothing', async () => {
        collabOff();
        const plain = await seed({ inspectionId: 'i1', data: { roof: { rating: 'D' } } });
        const stateful = await seed({ inspectionId: 'i2', data: { attic: { rating: 'S' } }, withState: true });
        // Stands in for the object: renaming in the document and persisting leaves the blob composite.
        const document: RenameInDocument = async () => {
            await fix.db.update(inspectionResults).set({ data: { '_default:s1:attic': { rating: 'S' } } }).where(eq(inspectionResults.id, stateful));
            return { ...NO_RENAMES, renamed: 1 };
        };

        const first = await migrateFindingKeys(db, TENANT, document);
        expect(first).toMatchObject({ migrated: 1, delegated: 1 });
        const afterFirst = [await dataOf(plain), await dataOf(stateful)];

        // The stateful row is asked again (the blob cannot say it is done), and a document that has nothing left answers zero.
        const second = await migrateFindingKeys(db, TENANT, answers());
        expect(second).toEqual({ processed: 2, migrated: 0, skipped: 1, delegated: 1, failed: 0, failedIds: [], renamedInDocuments: 0, conflicts: 0 });
        expect([await dataOf(plain), await dataOf(stateful)]).toEqual(afterFirst);
    });

    it('only touches the verified tenant', async () => {
        collabOff();
        const mine = await seed({ inspectionId: 'i1', data: { roof: { rating: 'D' } } });
        const theirs = await seed({ inspectionId: 'i2', tenantId: OTHER_TENANT, data: { roof: { rating: 'D' } } });

        const out = await migrateFindingKeys(db, TENANT, neverCalled);

        expect(out.migrated).toBe(1);
        expect(Object.keys(await dataOf(mine))).toEqual(['_default:s1:roof']);
        expect(Object.keys(await dataOf(theirs))).toEqual(['roof']);
    });
});

describe('renameThroughDurableObject', () => {
    const namespace = (respond: () => Response, seen: { name?: string; url?: string; headers?: Record<string, string> } = {}) => ({
        idFromName: (name: string) => { seen.name = name; return { name } as unknown as DurableObjectId; },
        get: () => ({
            fetch: (req: Request) => {
                seen.url = req.url;
                seen.headers = Object.fromEntries(req.headers.entries());
                return Promise.resolve(respond());
            },
        }),
    }) as unknown as DurableObjectNamespace;

    it('is null when the deployment has no binding', () => {
        expect(renameThroughDurableObject(undefined, TENANT)).toBeNull();
    });

    it('addresses the stub by tenant and report, forwards the identity headers and returns the counts', async () => {
        const seen: { name?: string; url?: string; headers?: Record<string, string> } = {};
        const counts = { renamed: 2, skippedMeta: 1, skippedUnknown: 0, skippedAmbiguous: 0, conflicts: 1 };
        const rename = renameThroughDurableObject(namespace(() => Response.json(counts), seen), TENANT);

        expect(await rename?.('rpt-1', 'insp-1')).toEqual(counts);

        expect(seen.name).toBe(`${TENANT}:rpt-1`);
        expect(seen.url).toBe('https://do.local/rename-legacy-keys');
        expect(seen.headers).toMatchObject({ 'x-tenant-id': TENANT, 'x-inspection-id': 'insp-1', 'x-report-id': 'rpt-1' });
    });

    it('throws when the object answers an error, and when it answers something that is not counts', async () => {
        await expect(renameThroughDurableObject(namespace(() => new Response('no', { status: 500 })), TENANT)?.('r', 'i')).rejects.toThrow('500');
        await expect(renameThroughDurableObject(namespace(() => Response.json({ renamed: 'many' })), TENANT)?.('r', 'i')).rejects.toThrow();
    });
});
