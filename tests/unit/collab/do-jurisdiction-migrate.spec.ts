import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResultsProjection } from '../../../packages/field-ui/src/shared/results-doc.types';
import { migrateCollabDocs, listCollabDocRefs, loadResultsBlobs, restoreDerivedBackup, UNREADABLE, type CollabDocRef, type DatabaseBlob } from '../../../server/lib/collab/do-jurisdiction-migrate';
import { collabDocName } from '../../../server/lib/collab/doc-name';
import { docBytes, fakeNamespace, identity, ratedDocBytes, stored, type FakeNamespace } from '../helpers/fake-collab-namespace';
import { projectionOfBytes } from '../../../server/lib/collab/projection-match';
import { logger } from '../../../server/lib/logger';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { lazyD1 } from '../helpers/d1-binding';

const ref = (t: string, r: string | null, i = 'i1', rowId = `row-${t}-${r}`): CollabDocRef => ({ rowId, tenantId: t, inspectionId: i, reportId: r });
/** The database holds nothing beyond what the document has: every source covers it. */
const noBlobs = () => null;
const at = (n: FakeNamespace, name: string) => n.stores.get(name);

describe('migrateCollabDocs', () => {
    const N1 = collabDocName('t1', 'r1');
    const N2 = collabDocName('t1', 'r2');

    it('copies each document to the object of the same name in the pinned namespace', async () => {
        const from = fakeNamespace({ [N1]: stored(docBytes('A')), [N2]: stored(docBytes('B'), identity('t1', 'i1', 'r2')) });
        const to = fakeNamespace({});
        const out = await migrateCollabDocs([ref('t1', 'r1'), ref('t1', 'r2')], from, to, { dryRun: false, databaseBlob: noBlobs });
        expect(out).toMatchObject({ total: 2, copied: 2, alreadyThere: 0, empty: 0, replaced: 0, conflicts: [], skipped: [], failed: [] });
        expect(at(to, N2)?.get('ydoc')).toEqual(at(from, N2)?.get('ydoc'));
    });

    it('names every row it handled, with its row id and what happened to it, so each can be found and acted on', async () => {
        const N3 = collabDocName('t1', 'r3');
        const from = fakeNamespace({ [N1]: stored(docBytes('A')), [N2]: stored(docBytes('B'), identity('t1', 'i1', 'r2')) });
        const to = fakeNamespace({ [N3]: stored(docBytes('different')) }, { failImportFor: N2 });
        const out = await migrateCollabDocs(
            [ref('t1', 'r1'), ref('t1', 'r2'), ref('t1', 'r3'), ref('t1', null, 'i9', 'row-orphan')],
            from, to, { dryRun: false, databaseBlob: noBlobs },
        );
        expect(out.rows).toEqual([
            { rowId: 'row-t1-r1', name: N1, outcome: 'copied' },
            { rowId: 'row-t1-r2', name: N2, outcome: 'failed' },
            { rowId: 'row-t1-r3', name: N3, outcome: 'empty' },
            { rowId: 'row-orphan', name: 't1/inspection i9', outcome: 'skipped' },
        ]);
    });

    it('never touches the source: it only ever answers the export verb', async () => {
        const from = fakeNamespace({ [N1]: stored(docBytes('A')) });
        await migrateCollabDocs([ref('t1', 'r1')], from, fakeNamespace({}), { dryRun: false, databaseBlob: noBlobs });
        expect(from.calls).toEqual([`GET /state-export ${N1}`]);
    });

    it('is repeatable: a target that already holds the SAME document is counted, not overwritten', async () => {
        const bytes = docBytes('SAME');
        const from = fakeNamespace({ [N1]: stored(bytes) });
        const to = fakeNamespace({ [N1]: stored(bytes) });
        const out = await migrateCollabDocs([ref('t1', 'r1')], from, to, { dryRun: false, databaseBlob: noBlobs });
        expect(out).toMatchObject({ copied: 0, alreadyThere: 1, conflicts: [], failed: [] });
    });

    it('reports a target holding a DIFFERENT document as a conflict with both sizes, ids and the refusal reason, and merges nothing', async () => {
        const source = docBytes('AAAA');
        const target = docBytes('NEWER-AND-LONGER');
        const from = fakeNamespace({ [N1]: stored(source) });
        const to = fakeNamespace({ [N1]: stored(target) });
        const out = await migrateCollabDocs([ref('t1', 'r1')], from, to, { dryRun: false, databaseBlob: noBlobs });
        expect(out).toMatchObject({ copied: 0, alreadyThere: 0, replaced: 0, failed: [] });
        expect(out.conflicts).toEqual([{
            rowId: 'row-t1-r1', name: N1, tenantId: 't1', inspectionId: 'i1', reportId: 'r1',
            sourceId: `id(${N1})`, targetId: `id(${N1})`,
            sourceBytes: source.length, targetBytes: target.length, reason: 'target-has-state',
        }]);
        expect(at(to, N1)?.get('ydoc')).toEqual(target);
    });

    it('a legacy object with no stored identity is migrated with the identity the database row supplies', async () => {
        const from = fakeNamespace({ [N1]: stored(docBytes('A'), null) });
        const to = fakeNamespace({});
        const out = await migrateCollabDocs([ref('t1', 'r1', 'insp-9')], from, to, { dryRun: false, databaseBlob: noBlobs });
        expect(out.copied).toBe(1);
        expect(at(to, N1)?.get('identity')).toEqual({ tenantId: 't1', inspectionId: 'insp-9', reportId: 'r1' });
    });

    it('a stored identity without a report id gets the row report id filled in; its own fields are kept', async () => {
        const from = fakeNamespace({ [N1]: stored(docBytes('A'), { tenantId: 't1', inspectionId: 'i1' }) });
        const to = fakeNamespace({});
        await migrateCollabDocs([ref('t1', 'r1')], from, to, { dryRun: false, databaseBlob: noBlobs });
        expect(at(to, N1)?.get('identity')).toEqual({ tenantId: 't1', inspectionId: 'i1', reportId: 'r1' });
    });

    it('never guesses: a stored identity that disagrees with the row (tenant, inspection or report) is skipped, and nothing is written', async () => {
        for (const stale of [identity('other', 'i1', 'r1'), identity('t1', 'other', 'r1'), identity('t1', 'i1', 'r-other')]) {
            const from = fakeNamespace({ [N1]: stored(docBytes('A'), stale) });
            const to = fakeNamespace({});
            const out = await migrateCollabDocs([ref('t1', 'r1')], from, to, { dryRun: false, databaseBlob: noBlobs });
            expect(out).toMatchObject({ copied: 0, failed: [] });
            expect(out.skipped).toEqual([{ rowId: 'row-t1-r1', name: N1, reason: 'identity-mismatch' }]);
            expect(to.calls).toEqual([]);
        }
    });

    it('a row with no report id has no object name: it is skipped with a reason and counted in the total', async () => {
        const from = fakeNamespace({});
        const out = await migrateCollabDocs([ref('t1', null, 'insp-3')], from, fakeNamespace({}), { dryRun: false, databaseBlob: noBlobs });
        expect(out.total).toBe(1);
        expect(out.skipped).toEqual([{ rowId: 'row-t1-null', name: 't1/inspection insp-3', reason: 'no-report-id' }]);
        expect(from.calls).toEqual([]);
    });

    it('skips an object with no stored document without writing to the target', async () => {
        const to = fakeNamespace({});
        const out = await migrateCollabDocs([ref('t1', 'r1')], fakeNamespace({}), to, { dryRun: false, databaseBlob: noBlobs });
        expect(out).toMatchObject({ copied: 0, empty: 1 });
        expect(to.calls).toEqual([]);
    });

    it('dry run only counts: it touches neither namespace, and still reports rows that cannot be migrated', async () => {
        const from = fakeNamespace({ [N1]: stored(docBytes('A')) });
        const to = fakeNamespace({});
        const out = await migrateCollabDocs([ref('t1', 'r1'), ref('t1', null, 'x')], from, to, { dryRun: true, databaseBlob: noBlobs });
        expect(out).toMatchObject({ total: 2, copied: 0, wouldCopy: 1 });
        expect(out.skipped).toHaveLength(1);
        expect(from.calls).toEqual([]);
        expect(to.calls).toEqual([]);
    });

    it('names the failed document and carries on with the rest', async () => {
        const from = fakeNamespace({ [N1]: stored(docBytes('A')), [N2]: stored(docBytes('B'), identity('t1', 'i1', 'r2')) });
        const to = fakeNamespace({}, { failImportFor: N1 });
        const out = await migrateCollabDocs([ref('t1', 'r1'), ref('t1', 'r2')], from, to, { dryRun: false, databaseBlob: noBlobs });
        expect(out.copied).toBe(1);
        expect(out.failed).toEqual([`${N1}: import returned 500`]);
    });

    it('never mixes tenants: the object name carries the tenant', async () => {
        const n = collabDocName('t2', 'r1');
        const from = fakeNamespace({ [collabDocName('t1', 'r1')]: stored(docBytes('T1')), [n]: stored(docBytes('T2'), identity('t2', 'i1', 'r1')) });
        const to = fakeNamespace({});
        await migrateCollabDocs([ref('t2', 'r1')], from, to, { dryRun: false, databaseBlob: noBlobs });
        expect([...to.stores.keys()]).toEqual([n]);
    });

    it('stays within the subrequest budget: at most three object calls per document', async () => {
        const from = fakeNamespace({ [N1]: stored(docBytes('A')) });
        const to = fakeNamespace({ [N1]: stored(docBytes('B')) });
        await migrateCollabDocs([ref('t1', 'r1')], from, to, { dryRun: false, databaseBlob: noBlobs });
        expect(from.calls.length + to.calls.length).toBeLessThanOrEqual(3);
    });
});

describe('migrateCollabDocs with replaceDerived', () => {
    const N1 = collabDocName('t1', 'r1');
    const run = (from: FakeNamespace, to: FakeNamespace, replaceDerived = true) =>
        migrateCollabDocs([ref('t1', 'r1')], from, to, { dryRun: false, replaceDerived, databaseBlob: noBlobs });

    it('replaces a target that only the database ever shaped, and writes an audit line with ids, sizes and both hashes', async () => {
        const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const source = docBytes('FULL-HISTORY');
        const target = docBytes('lossy');
        const from = fakeNamespace({ [N1]: stored(source) });
        const to = fakeNamespace({ [N1]: stored(target, identity(), true) });
        const out = await run(from, to);
        expect(out).toMatchObject({ replaced: 1, copied: 0, conflicts: [], failed: [] });
        expect(at(to, N1)?.get('ydoc')).toEqual(source);
        expect(at(to, N1)?.get('derived-from-d1')).toBe(false);
        const audits = info.mock.calls.filter(([m]) => /replaced/.test(m));
        expect(audits).toHaveLength(1);
        expect(audits[0]?.[1]).toMatchObject({
            name: N1, tenantId: 't1', inspectionId: 'i1', reportId: 'r1',
            sourceBytes: source.length, targetBytes: target.length,
        });
        expect(JSON.stringify(audits[0]?.[1])).toMatch(/[0-9a-f]{64}/);
    });

    it('is idempotent: a second run finds the target equal to the source', async () => {
        vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const from = fakeNamespace({ [N1]: stored(docBytes('FULL')) });
        const to = fakeNamespace({ [N1]: stored(docBytes('lossy'), identity(), true) });
        await run(from, to);
        expect(await run(from, to)).toMatchObject({ replaced: 0, alreadyThere: 1, conflicts: [] });
    });

    it('a target a client has edited stays a conflict, with the reason', async () => {
        const from = fakeNamespace({ [N1]: stored(docBytes('FULL')) });
        const to = fakeNamespace({ [N1]: stored(docBytes('edited'), identity(), false) });
        const out = await run(from, to);
        expect(out).toMatchObject({ replaced: 0 });
        expect(out.conflicts.map((c) => c.reason)).toEqual(['target-edited']);
    });

    it('without the flag the same target is a conflict, not replaced', async () => {
        const from = fakeNamespace({ [N1]: stored(docBytes('FULL')) });
        const to = fakeNamespace({ [N1]: stored(docBytes('lossy'), identity(), true) });
        const out = await run(from, to, false);
        expect(out).toMatchObject({ replaced: 0 });
        expect(out.conflicts.map((c) => c.reason)).toEqual(['target-has-state']);
    });

    it('a dry run never replaces, whatever the flag says', async () => {
        const from = fakeNamespace({ [N1]: stored(docBytes('FULL')) });
        const to = fakeNamespace({ [N1]: stored(docBytes('lossy'), identity(), true) });
        await migrateCollabDocs([ref('t1', 'r1')], from, to, { dryRun: true, replaceDerived: true, databaseBlob: noBlobs });
        expect(to.calls).toEqual([]);
    });
});

describe('migrateCollabDocs: the old document must not take away what the database gained since it was stored', () => {
    const N1 = collabDocName('t1', 'r1');
    const source = ratedDocBytes('defect');
    // What the database holds when something wrote to it directly after the old object last stored its document.
    const gained: ResultsProjection = { 'a:b:c': { ...projectionOfBytes(source)?.['a:b:c'], notes: 'written straight to the database' } };
    const blobs = (blob: ResultsProjection | null) => (rowId: string): DatabaseBlob => (rowId === 'row-t1-r1' ? blob : null);

    it('copies when the database holds nothing the document lacks', async () => {
        const out = await migrateCollabDocs([ref('t1', 'r1')], fakeNamespace({ [N1]: stored(source) }), fakeNamespace({}), { dryRun: false, databaseBlob: blobs(projectionOfBytes(source)) });
        expect(out).toMatchObject({ copied: 1, conflicts: [] });
    });

    it('refuses a plain copy that would lose a direct database write: a conflict with the reason, and nothing is imported', async () => {
        const to = fakeNamespace({});
        const out = await migrateCollabDocs([ref('t1', 'r1')], fakeNamespace({ [N1]: stored(source) }), to, { dryRun: false, databaseBlob: blobs(gained) });
        expect(out).toMatchObject({ copied: 0 });
        expect(out.conflicts.map((c) => c.reason)).toEqual(['source-differs-from-database']);
        expect(to.calls.every((c) => c.startsWith('GET /state-export'))).toBe(true);
    });

    it('refuses to replace a database-built target with a source that lacks a direct database write, and keeps the target', async () => {
        const target = docBytes('built-from-database');
        const to = fakeNamespace({ [N1]: stored(target, identity(), true) });
        const out = await migrateCollabDocs([ref('t1', 'r1')], fakeNamespace({ [N1]: stored(source) }), to, { dryRun: false, replaceDerived: true, databaseBlob: blobs(gained) });
        expect(out).toMatchObject({ replaced: 0 });
        expect(out.conflicts.map((c) => c.reason)).toEqual(['source-differs-from-database']);
        expect(at(to, N1)?.get('ydoc')).toEqual(target);
    });

    it('replaces when the source holds everything the database has', async () => {
        vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const to = fakeNamespace({ [N1]: stored(docBytes('built-from-database'), identity(), true) });
        const out = await migrateCollabDocs([ref('t1', 'r1')], fakeNamespace({ [N1]: stored(source) }), to, { dryRun: false, replaceDerived: true, databaseBlob: blobs(projectionOfBytes(source)) });
        expect(out).toMatchObject({ replaced: 1, conflicts: [] });
    });

    it('refuses a copy whose source holds something the database no longer has: it would bring a deletion back', async () => {
        const to = fakeNamespace({});
        const out = await migrateCollabDocs([ref('t1', 'r1')], fakeNamespace({ [N1]: stored(source) }), to, { dryRun: false, databaseBlob: blobs(null) });
        expect(out).toMatchObject({ copied: 0 });
        expect(out.conflicts.map((c) => c.reason)).toEqual(['source-differs-from-database']);
        expect(to.calls.every((c) => c.startsWith('GET /state-export'))).toBe(true);
    });

    it('treats a cleared note and a note that was never written as the same', async () => {
        const cleared: ResultsProjection = { 'a:b:c': { ...projectionOfBytes(source)?.['a:b:c'], notes: '' } };
        const out = await migrateCollabDocs([ref('t1', 'r1')], fakeNamespace({ [N1]: stored(source) }), fakeNamespace({}), { dryRun: false, databaseBlob: blobs(cleared) });
        expect(out).toMatchObject({ copied: 1, conflicts: [] });
    });

    it('fails closed when the source document cannot be read: a conflict with the reason, nothing imported', async () => {
        const to = fakeNamespace({});
        const out = await migrateCollabDocs([ref('t1', 'r1')], fakeNamespace({ [N1]: stored(new Uint8Array([255, 255, 255, 9, 9])) }), to, { dryRun: false, databaseBlob: blobs(null) });
        expect(out).toMatchObject({ copied: 0, failed: [] });
        expect(out.conflicts.map((c) => c.reason)).toEqual(['source-unreadable']);
        expect(to.calls.every((c) => c.startsWith('GET /state-export'))).toBe(true);
    });

    it('a row whose database blob cannot be read is a conflict with its reason and the batch carries on', async () => {
        const N2 = collabDocName('t1', 'r2');
        const from = fakeNamespace({ [N1]: stored(source), [N2]: stored(docBytes('B'), identity('t1', 'i1', 'r2')) });
        const to = fakeNamespace({});
        const out = await migrateCollabDocs([ref('t1', 'r1'), ref('t1', 'r2')], from, to, { dryRun: false, databaseBlob: (rowId) => (rowId === 'row-t1-r1' ? UNREADABLE : null) });
        expect(out).toMatchObject({ copied: 1 });
        expect(out.conflicts.map((c) => [c.name, c.reason])).toEqual([[N1, 'database-row-unreadable']]);
        expect(from.calls.some((c) => c.includes(N1))).toBe(false);
    });

    it('reports a database-built target that was evicted before its first save as target-unsaved', async () => {
        const to = fakeNamespace({ [N1]: { identity: identity(), 'derived-from-d1': true } });
        const out = await migrateCollabDocs([ref('t1', 'r1')], fakeNamespace({ [N1]: stored(source) }), to, { dryRun: false, replaceDerived: true, databaseBlob: blobs(projectionOfBytes(source)) });
        expect(out.conflicts.map((c) => c.reason)).toEqual(['target-unsaved']);
    });
});

describe('restoreDerivedBackup', () => {
    const N1 = collabDocName('t1', 'r1');
    const source = ratedDocBytes('defect');
    const displaced = docBytes('built-from-database');
    const matching = () => null;

    async function replaced() {
        vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const to = fakeNamespace({ [N1]: stored(displaced, identity(), true) });
        await migrateCollabDocs([ref('t1', 'r1')], fakeNamespace({ [N1]: stored(source) }), to, { dryRun: false, replaceDerived: true, databaseBlob: () => projectionOfBytes(source) });
        return to;
    }

    it('undoes a replacement when the database still matches the backup: the displaced document is back and the backup is spent', async () => {
        const to = await replaced();
        expect(at(to, N1)?.get('ydoc')).not.toEqual(displaced);
        expect(await restoreDerivedBackup({ tenantId: 't1', reportId: 'r1' }, to, matching())).toBe('restored');
        expect(at(to, N1)?.get('ydoc')).toEqual(displaced);
        expect(await restoreDerivedBackup({ tenantId: 't1', reportId: 'r1' }, to, matching())).toBe('no-backup');
    });

    it('refuses when the database has changed since the backup was built, and changes nothing', async () => {
        const to = await replaced();
        const gained = { 'a:b:c': { rating: 'defect', notes: 'written straight to the database' } };
        expect(await restoreDerivedBackup({ tenantId: 't1', reportId: 'r1' }, to, gained)).toBe('backup-differs-from-database');
        expect(at(to, N1)?.get('ydoc')).not.toEqual(displaced);
        expect(at(to, N1)?.get('replaced-derived-backup')).toBeTruthy();
        expect(to.calls.some((c) => c.startsWith('POST /state-restore-backup'))).toBe(false);
    });

    it('refuses when the database row cannot be read', async () => {
        expect(await restoreDerivedBackup({ tenantId: 't1', reportId: 'r1' }, await replaced(), UNREADABLE)).toBe('database-row-unreadable');
    });

    it('refuses once the replacement has been edited, and answers no-backup for an object that was never replaced', async () => {
        const to = await replaced();
        at(to, N1)?.set('ydoc', docBytes('a client edited this'));
        expect(await restoreDerivedBackup({ tenantId: 't1', reportId: 'r1' }, to, matching())).toBe('edited');
        expect(await restoreDerivedBackup({ tenantId: 't1', reportId: 'r1' }, fakeNamespace({ [N1]: stored(docBytes('x')) }), matching())).toBe('no-backup');
    });
});

describe('loadResultsBlobs', () => {
    const testD1 = lazyD1();
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    beforeEach(async () => {
        const fix = createTestDb();
        sqlite = fix.sqlite;
        await setupSchema(fix.sqlite);
        testD1.use(fix.db);
        await fix.db.insert(schema.tenants).values({ id: 't1', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        const insp = (id: string) => ({
            id, tenantId: 't1', propertyAddress: id, date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
            price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        await fix.db.insert(schema.inspections).values(['i1', 'i2', 'i3'].map(insp) as never);
        await fix.db.insert(schema.inspectionResults).values(['i1', 'i2', 'i3'].map((i, n) => ({
            id: `row-${n + 1}`, tenantId: 't1', inspectionId: i, data: n === 0 ? { 'a:b:c': { rating: 'ok' } } : {}, ydocState: new Uint8Array([1]), lastSyncedAt: new Date(), reportId: `r${n + 1}`,
        })) as never);
    });

    const refs: CollabDocRef[] = [1, 2, 3].map((n) => ({ rowId: `row-${n}`, tenantId: 't1', inspectionId: `i${n}`, reportId: `r${n}` }));

    it('maps each row to its projection, or null when it holds nothing', async () => {
        const out = await loadResultsBlobs(testD1.binding, refs);
        expect(out.get('row-1')).toEqual({ 'a:b:c': { rating: 'ok' } });
        expect(out.get('row-2')).toBeNull();
    });

    it('one malformed row does not fail the batch: it alone is marked unreadable', async () => {
        sqlite.prepare("UPDATE inspection_results SET data = 'not json {' WHERE id = 'row-2'").run();
        const out = await loadResultsBlobs(testD1.binding, refs);
        expect(out.get('row-2')).toBe(UNREADABLE);
        expect(out.get('row-1')).toEqual({ 'a:b:c': { rating: 'ok' } });
        expect(out.get('row-3')).toBeNull();
    });
});

describe('listCollabDocRefs', () => {
    const testD1 = lazyD1();
    beforeEach(async () => {
        const fix = createTestDb();
        await setupSchema(fix.sqlite);
        testD1.use(fix.db);
        const { db } = fix;
        await db.insert(schema.tenants).values({ id: 't1', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        const insp = (id: string) => ({
            id, tenantId: 't1', propertyAddress: id, date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
            price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        await db.insert(schema.inspections).values(['i1', 'i2', 'i3', 'i4', 'i5'].map(insp) as never);
        const row = (id: string, inspectionId: string, reportId: string | null, ydoc: Uint8Array | null) => ({
            id, tenantId: 't1', inspectionId, data: {}, ydocState: ydoc, lastSyncedAt: new Date(), reportId,
        });
        await db.insert(schema.inspectionResults).values([
            row('e', 'i5', 'r5', new Uint8Array([1])),
            row('a', 'i1', 'r1', new Uint8Array([1])),
            row('b', 'i2', null, new Uint8Array([1])),
            row('c', 'i3', 'r3', null),
            row('d', 'i4', 'r4', new Uint8Array([1])),
        ] as never);
    });

    it('returns the row id and inspection id, keeps rows with no report id, leaves out rows without stored state, in a stable order', async () => {
        const { refs, nextCursor } = await listCollabDocRefs(testD1.binding, { limit: 10 });
        expect(refs).toEqual([
            { rowId: 'a', tenantId: 't1', inspectionId: 'i1', reportId: 'r1' },
            { rowId: 'b', tenantId: 't1', inspectionId: 'i2', reportId: null },
            { rowId: 'd', tenantId: 't1', inspectionId: 'i4', reportId: 'r4' },
            { rowId: 'e', tenantId: 't1', inspectionId: 'i5', reportId: 'r5' },
        ]);
        expect(nextCursor).toBeNull();
    });

    it('pages by cursor without gaps or repeats, and the last page has no next cursor', async () => {
        const first = await listCollabDocRefs(testD1.binding, { limit: 3 });
        expect(first.refs.map((r) => r.rowId)).toEqual(['a', 'b', 'd']);
        expect(first.nextCursor).toBe('d');
        const second = await listCollabDocRefs(testD1.binding, { limit: 3, after: first.nextCursor });
        expect(second.refs.map((r) => r.rowId)).toEqual(['e']);
        expect(second.nextCursor).toBeNull();
    });

    it('a cursor past the end lists nothing', async () => {
        const out = await listCollabDocRefs(testD1.binding, { limit: 3, after: 'zzz' });
        expect(out).toEqual({ refs: [], nextCursor: null });
    });
});
