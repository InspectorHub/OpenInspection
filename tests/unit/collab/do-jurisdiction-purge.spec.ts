import { describe, expect, it } from 'vitest';
import { migrateCollabDocs, type CollabDocRef } from '../../../server/lib/collab/do-jurisdiction-migrate';
import { purgeMigratedSources } from '../../../server/lib/collab/do-jurisdiction-purge';
import { PURGE_IF_IDLE_HEADER, PURGE_TENANT_HEADER } from '../../../server/durable-objects/purge-path';
import { collabDocName } from '../../../server/lib/collab/doc-name';
import { docBytes, fakeNamespace, identity, stored, type FakeNamespace } from '../helpers/fake-collab-namespace';

const ref = (t: string, r: string | null, i = 'i1', rowId = `row-${t}-${r}`): CollabDocRef => ({ rowId, tenantId: t, inspectionId: i, reportId: r });
const N1 = collabDocName('t1', 'r1');
const N2 = collabDocName('t1', 'r2');
const at = (n: FakeNamespace, name: string) => n.stores.get(name);
const hasDoc = (n: FakeNamespace, name: string) => at(n, name)?.get('ydoc') !== undefined;
const sums = (r: Awaited<ReturnType<typeof purgeMigratedSources>>) => r.purged + r.alreadyPurged + r.wouldPurge + r.kept.length + r.failed.length;

/** A source and an already-copied target holding the same document: what a finished migration leaves behind. */
async function migrated(opts: { liveFor?: string[] } = {}) {
    const from = fakeNamespace({ [N1]: stored(docBytes('A')) });
    const liveFor: string[] = [];
    const to = fakeNamespace({}, { liveFor });
    await migrateCollabDocs([ref('t1', 'r1')], from, to, { dryRun: false, databaseBlob: () => null });
    from.calls.length = 0;
    to.calls.length = 0;
    liveFor.push(...(opts.liveFor ?? [])); // live only AFTER the copy, which a live target would have refused
    return { from, to };
}

describe('purgeMigratedSources', () => {
    it('purges the old object after a verified copy, and never addresses the pinned one with the purge verb', async () => {
        const { from, to } = await migrated();
        const out = await purgeMigratedSources([ref('t1', 'r1')], from, to, { dryRun: false });
        expect(out).toMatchObject({ total: 1, purged: 1, alreadyPurged: 0, kept: [], failed: [] });
        expect(sums(out)).toBe(out.total);
        expect(hasDoc(from, N1)).toBe(false);
        expect(hasDoc(to, N1)).toBe(true);
        expect(to.calls).toEqual([`GET /state-export ${N1}`]);
    });

    it('sends the purge with the tenant of the ROW as the expected tenant', async () => {
        const { from, to } = await migrated();
        const seen: Array<string | null> = [];
        const spy: FakeNamespace = {
            ...from,
            get: (id) => {
                const stub = from.get(id);
                return { fetch: async (url, init) => { if (new URL(url).pathname === '/purge') seen.push(new Headers(init?.headers).get(PURGE_TENANT_HEADER)); return stub.fetch(url, init); } };
            },
        };
        await purgeMigratedSources([ref('t1', 'r1')], spy, to, { dryRun: false });
        expect(seen).toEqual(['t1']);
    });

    it('is idempotent: a second run finds the old object empty and reports it as already purged, not an error', async () => {
        const { from, to } = await migrated();
        await purgeMigratedSources([ref('t1', 'r1')], from, to, { dryRun: false });
        const again = await purgeMigratedSources([ref('t1', 'r1')], from, to, { dryRun: false });
        expect(again).toMatchObject({ purged: 0, alreadyPurged: 1, kept: [], failed: [] });
        expect(hasDoc(to, N1)).toBe(true);
    });

    it('a dry run addresses no object and deletes nothing', async () => {
        const { from, to } = await migrated();
        const out = await purgeMigratedSources([ref('t1', 'r1'), ref('t1', null, 'x')], from, to, { dryRun: true });
        expect(out).toMatchObject({ total: 2, purged: 0, wouldPurge: 1 });
        expect(out.kept).toEqual([{ rowId: 'row-t1-null', reason: 'no-report-id' }]);
        expect(sums(out)).toBe(out.total);
        expect(from.calls).toEqual([]);
        expect(to.calls).toEqual([]);
        expect(hasDoc(from, N1)).toBe(true);
    });

    it('a missing dryRun is a dry run: an empty options object addresses no object (fail-closed default)', async () => {
        // A maintenance script that calls the exported function with no options must not
        // get an irreversible purge out of an undefined flag.
        const { from, to } = await migrated();
        const out = await purgeMigratedSources([ref('t1', 'r1')], from, to, {});
        expect(out).toMatchObject({ total: 1, wouldPurge: 1, purged: 0, kept: [], failed: [] });
        expect(sums(out)).toBe(out.total);
        expect(from.calls).toEqual([]);
        expect(to.calls).toEqual([]);
        expect(hasDoc(from, N1)).toBe(true);
    });

    it('keeps the old object when the pinned target is live', async () => {
        const { from, to } = await migrated({ liveFor: [N1] });
        const out = await purgeMigratedSources([ref('t1', 'r1')], from, to, { dryRun: false });
        expect(out).toMatchObject({ purged: 0, kept: [{ rowId: 'row-t1-r1', reason: 'target-live' }] });
        expect(hasDoc(from, N1)).toBe(true);
    });

    it('keeps the old object when the pinned target has diverged since the copy', async () => {
        const { from, to } = await migrated();
        at(to, N1)?.set('ydoc', docBytes('edited after the copy'));
        const out = await purgeMigratedSources([ref('t1', 'r1')], from, to, { dryRun: false });
        expect(out.kept).toEqual([{ rowId: 'row-t1-r1', reason: 'target-differs' }]);
        expect(hasDoc(from, N1)).toBe(true);
    });

    it('keeps the old object when nothing was copied (the target is empty)', async () => {
        const from = fakeNamespace({ [N1]: stored(docBytes('A')) });
        const out = await purgeMigratedSources([ref('t1', 'r1')], from, fakeNamespace({}), { dryRun: false });
        expect(out.kept).toEqual([{ rowId: 'row-t1-r1', reason: 'target-empty' }]);
        expect(hasDoc(from, N1)).toBe(true);
    });

    it('keeps the old object when the old object itself is live', async () => {
        const { to } = await migrated();
        const from = fakeNamespace({ [N1]: stored(docBytes('A')) }, { liveFor: [N1] });
        const out = await purgeMigratedSources([ref('t1', 'r1')], from, to, { dryRun: false });
        expect(out.kept).toEqual([{ rowId: 'row-t1-r1', reason: 'source-live' }]);
        expect(hasDoc(from, N1)).toBe(true);
    });

    it('keeps the old object when the lineage differs, or the target was only built from the database', async () => {
        const bytes = docBytes('A');
        const from = fakeNamespace({ [N1]: { ...stored(bytes), gen: 'source-gen-0001' }, [N2]: stored(bytes, identity('t1', 'i1', 'r2')) });
        const to = fakeNamespace({
            [N1]: { ...stored(bytes), gen: 'target-gen-0002' },
            [N2]: stored(bytes, identity('t1', 'i1', 'r2'), true),
        });
        const out = await purgeMigratedSources([ref('t1', 'r1'), ref('t1', 'r2')], from, to, { dryRun: false });
        expect(out.kept).toEqual([{ rowId: 'row-t1-r1', reason: 'target-lineage-differs' }, { rowId: 'row-t1-r2', reason: 'target-derived' }]);
        expect(hasDoc(from, N1) && hasDoc(from, N2)).toBe(true);
    });

    it('keeps the old object when either side stores another document identity than the row', async () => {
        const bytes = docBytes('A');
        const wrongSource = fakeNamespace({ [N1]: stored(bytes, identity('other', 'i1', 'r1')) });
        const wrongTarget = fakeNamespace({ [N1]: stored(bytes, identity('other', 'i1', 'r1')) });
        const a = await purgeMigratedSources([ref('t1', 'r1')], wrongSource, wrongTarget, { dryRun: false });
        expect(a.kept).toEqual([{ rowId: 'row-t1-r1', reason: 'identity-mismatch' }]);
        const b = await purgeMigratedSources([ref('t1', 'r1')], fakeNamespace({ [N1]: stored(bytes) }), wrongTarget, { dryRun: false });
        expect(b.kept).toEqual([{ rowId: 'row-t1-r1', reason: 'target-identity-mismatch' }]);
        expect(hasDoc(wrongSource, N1) && hasDoc(wrongTarget, N1)).toBe(true);
    });

    it('keeps an old object the object itself refuses to attribute to the tenant (a document with no stored identity)', async () => {
        const bytes = docBytes('A');
        const from = fakeNamespace({ [N1]: stored(bytes, null) });
        const to = fakeNamespace({ [N1]: stored(bytes) });
        const out = await purgeMigratedSources([ref('t1', 'r1')], from, to, { dryRun: false });
        expect(out.kept).toEqual([{ rowId: 'row-t1-r1', reason: 'source-not-attributable' }]);
        expect(hasDoc(from, N1)).toBe(true);
    });

    it('never purges on a read error, and a failed purge is reported without detail', async () => {
        const { from, to } = await migrated();
        const sourceDown = fakeNamespace({ [N1]: stored(docBytes('A')) }, { failExportFor: N1 });
        const a = await purgeMigratedSources([ref('t1', 'r1')], sourceDown, to, { dryRun: false });
        expect(a.failed).toEqual([{ rowId: 'row-t1-r1', reason: 'source-export-failed' }]);
        expect(hasDoc(sourceDown, N1)).toBe(true);
        const targetDown = fakeNamespace({ [N1]: stored(docBytes('A')) }, { failExportFor: N1 });
        const b = await purgeMigratedSources([ref('t1', 'r1')], from, targetDown, { dryRun: false });
        expect(b.failed).toEqual([{ rowId: 'row-t1-r1', reason: 'target-export-failed' }]);
        expect(hasDoc(from, N1)).toBe(true);
        const same = docBytes('A'); // two encodings of the same text differ (random client id), so share one
        const purgeDown = fakeNamespace({ [N1]: stored(same) }, { failPurgeFor: N1 });
        const targetSame = fakeNamespace({ [N1]: stored(same) });
        const c = await purgeMigratedSources([ref('t1', 'r1')], purgeDown, targetSame, { dryRun: false });
        expect(c.failed).toEqual([{ rowId: 'row-t1-r1', reason: 'purge-failed' }]);
        expect(JSON.stringify(c)).not.toMatch(/boom|t1:r1|id[(]/);
    });

    it('a batch with every outcome sums to its total and one bad row does not stop the rest', async () => {
        const bytes = docBytes('A');
        const N3 = collabDocName('t1', 'r3');
        const N4 = collabDocName('t1', 'r4');
        const from = fakeNamespace({ [N1]: stored(bytes), [N2]: stored(bytes, identity('t1', 'i1', 'r2')), [N3]: stored(bytes, identity('t1', 'i1', 'r3')) });
        const to = fakeNamespace({ [N1]: stored(bytes), [N2]: stored(docBytes('other'), identity('t1', 'i1', 'r2')), [N3]: stored(bytes, identity('t1', 'i1', 'r3')) });
        const out = await purgeMigratedSources([ref('t1', 'r1'), ref('t1', 'r2'), ref('t1', 'r3'), ref('t1', 'r4'), ref('t1', null, 'x')], from, to, { dryRun: false });
        expect(out).toMatchObject({ total: 5, purged: 2, alreadyPurged: 1 });
        expect(out.kept.map((k) => k.reason)).toEqual(['target-differs', 'no-report-id']);
        expect(sums(out)).toBe(5);
        expect(out.keptByReason).toEqual({ 'target-differs': 1, 'no-report-id': 1 });
        expect(hasDoc(from, N4)).toBe(false);
    });

    const snap = (seq: number, note = 'n') => ({ seq, atMs: 1000 + seq, byUserId: null, reason: 'manual', projection: { 'a:b:c': { notes: note } } });

    it('keeps the old object when the pinned object lacks, or changed, one of its restore points; extra ones on the target are fine', async () => {
        const bytes = docBytes('A');
        const run = async (source: object[], target: object[]) => {
            const from = fakeNamespace({ [N1]: { ...stored(bytes), snapshots: source as never } });
            const to = fakeNamespace({ [N1]: { ...stored(bytes), snapshots: target as never } });
            return { out: await purgeMigratedSources([ref('t1', 'r1')], from, to, { dryRun: false }), from };
        };
        const missing = await run([snap(1), snap(2)], [snap(1)]);
        expect(missing.out.kept).toEqual([{ rowId: 'row-t1-r1', reason: 'target-snapshots-differ' }]);
        expect(hasDoc(missing.from, N1)).toBe(true);
        const changed = await run([snap(1), snap(2)], [snap(1), snap(2, 'edited')]);
        expect(changed.out.kept).toEqual([{ rowId: 'row-t1-r1', reason: 'target-snapshots-differ' }]);
        expect(hasDoc(changed.from, N1)).toBe(true);
        const none = await run([snap(1)], []);
        expect(none.out.kept).toEqual([{ rowId: 'row-t1-r1', reason: 'target-snapshots-differ' }]);
        const equal = await run([snap(1), snap(2)], [snap(2), snap(1)]);
        expect(equal.out.purged).toBe(1);
        const more = await run([snap(1)], [snap(1), snap(2)]);
        expect(more.out.purged).toBe(1);
        expect(hasDoc(more.from, N1)).toBe(false);
    });

    it('an old object with no document but a stored identity or restore points is partial: kept, not reported as already purged', async () => {
        const withIdentity = fakeNamespace({ [N1]: { identity: identity() } });
        const withSnapshots = fakeNamespace({ [N1]: { snapshots: [snap(1)] as never } });
        const to = fakeNamespace({});
        for (const from of [withIdentity, withSnapshots]) {
            const out = await purgeMigratedSources([ref('t1', 'r1')], from, to, { dryRun: false });
            expect(out).toMatchObject({ alreadyPurged: 0, purged: 0, kept: [{ rowId: 'row-t1-r1', reason: 'source-partial' }] });
        }
        expect(withIdentity.stores.get(N1)?.has('identity')).toBe(true);
        expect(withSnapshots.stores.get(N1)?.has('snapshots')).toBe(true);
        expect(await purgeMigratedSources([ref('t1', 'r1')], fakeNamespace({}), to, { dryRun: false })).toMatchObject({ alreadyPurged: 1, kept: [] });
    });

    it('a malformed export (a document that is neither a string nor null) is a failure with a fixed code and deletes nothing', async () => {
        const answer = (body: object): FakeNamespace => ({ ...fakeNamespace({}), get: () => ({ fetch: async () => Response.json(body) }) });
        const good = await migrated();
        const badSource = answer({ ydoc: 42, identity: null, snapshots: [], gen: null, live: false });
        const a = await purgeMigratedSources([ref('t1', 'r1')], badSource, good.to, { dryRun: false });
        expect(a.failed).toEqual([{ rowId: 'row-t1-r1', reason: 'malformed-export' }]);
        const badTarget = answer({ ydoc: { not: 'a string' }, identity: null, snapshots: [], gen: null, live: false });
        const b = await purgeMigratedSources([ref('t1', 'r1')], good.from, badTarget, { dryRun: false });
        expect(b.failed).toEqual([{ rowId: 'row-t1-r1', reason: 'malformed-export' }]);
        expect(hasDoc(good.from, N1)).toBe(true);
        expect(a.purged + b.purged).toBe(0);
    });

    it('keeps the old object when it becomes live between the read and the delete (the object refuses an idle-only purge)', async () => {
        const bytes = docBytes('A');
        const from = fakeNamespace({ [N1]: stored(bytes) }, { liveAtPurgeFor: [N1] });
        const to = fakeNamespace({ [N1]: stored(bytes) });
        const out = await purgeMigratedSources([ref('t1', 'r1')], from, to, { dryRun: false });
        expect(out.kept).toEqual([{ rowId: 'row-t1-r1', reason: 'source-live' }]);
        expect(hasDoc(from, N1)).toBe(true);
    });

    it('keeps the old object when its document changed between the read and the delete (compare-and-delete), and deletes when it did not', async () => {
        const bytes = docBytes('A');
        const make = (editBeforePurge: boolean) => {
            const from = fakeNamespace({ [N1]: stored(bytes) });
            const to = fakeNamespace({ [N1]: stored(bytes) });
            const racing: FakeNamespace = {
                ...from,
                get: (id) => {
                    const stub = from.get(id);
                    return { fetch: async (url, init) => {
                        if (editBeforePurge && new URL(url).pathname === '/purge') from.stores.get(N1)?.set('ydoc', docBytes('edited in the gap'));
                        return stub.fetch(url, init);
                    } };
                },
            };
            return { from, to, racing };
        };
        const changed = make(true);
        const out = await purgeMigratedSources([ref('t1', 'r1')], changed.racing, changed.to, { dryRun: false });
        expect(out.kept).toEqual([{ rowId: 'row-t1-r1', reason: 'source-changed' }]);
        expect(hasDoc(changed.from, N1)).toBe(true);
        const calm = make(false);
        expect((await purgeMigratedSources([ref('t1', 'r1')], calm.racing, calm.to, { dryRun: false })).purged).toBe(1);
        expect(hasDoc(calm.from, N1)).toBe(false);
    });

    it('keeps the old object when a restore point was added between the read and the delete (document unchanged)', async () => {
        const bytes = docBytes('A');
        const from = fakeNamespace({ [N1]: stored(bytes) });
        const to = fakeNamespace({ [N1]: stored(bytes) });
        const racing: FakeNamespace = {
            ...from,
            get: (id) => {
                const stub = from.get(id);
                return { fetch: async (url, init) => {
                    if (new URL(url).pathname === '/purge') from.stores.get(N1)?.set('snapshots', [{ seq: 1, atMs: 1, byUserId: null, reason: 'manual', projection: { 'a:b:c': { notes: 'x' } } }] as never);
                    return stub.fetch(url, init);
                } };
            },
        };
        const out = await purgeMigratedSources([ref('t1', 'r1')], racing, to, { dryRun: false });
        expect(out.kept).toEqual([{ rowId: 'row-t1-r1', reason: 'source-changed' }]);
        expect(hasDoc(from, N1)).toBe(true);
    });

    it('an object answering bad-precondition is a failure, not a kept or purged row', async () => {
        const bytes = docBytes('A');
        const from = fakeNamespace({ [N1]: stored(bytes) });
        const base = from.get;
        const odd: FakeNamespace = { ...from, get: (id) => { const stub = base(id); return { fetch: async (url, init) => (new URL(url).pathname === '/purge' ? Response.json({ error: 'bad-precondition' }, { status: 409 }) : stub.fetch(url, init)) }; } };
        const out = await purgeMigratedSources([ref('t1', 'r1')], odd, fakeNamespace({ [N1]: stored(bytes) }), { dryRun: false });
        expect(out.failed).toEqual([{ rowId: 'row-t1-r1', reason: 'purge-failed' }]);
        expect(hasDoc(from, N1)).toBe(true);
    });

    it('asks for an idle-only purge: the request carries the idle header', async () => {
        const { from, to } = await migrated();
        const seen: Array<string | null> = [];
        const spy: FakeNamespace = {
            ...from,
            get: (id) => {
                const stub = from.get(id);
                return { fetch: async (url, init) => { if (new URL(url).pathname === '/purge') seen.push(new Headers(init?.headers).get(PURGE_IF_IDLE_HEADER)); return stub.fetch(url, init); } };
            },
        };
        await purgeMigratedSources([ref('t1', 'r1')], spy, to, { dryRun: false });
        expect(seen).toEqual(['1']);
    });

    it('stays within three object calls per document', async () => {
        const { from, to } = await migrated();
        await purgeMigratedSources([ref('t1', 'r1')], from, to, { dryRun: false });
        expect(from.calls.length + to.calls.length).toBeLessThanOrEqual(3);
    });
});
