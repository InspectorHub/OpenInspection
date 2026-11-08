import { describe, expect, it } from 'vitest';
import { migrateCollabDocs, type CollabDocRef, type DocNamespace } from '../../../server/lib/collab/do-jurisdiction-migrate';
import { collabDocName } from '../../../server/lib/collab/doc-name';

interface Identity { tenantId: string; inspectionId: string }
interface Payload { ydoc: string | null; identity: Identity | null; snapshots: object[] }

/** A namespace whose objects are plain records, speaking the two verbs the migration uses. The object id is the name itself. */
interface FakeNamespace extends DocNamespace<string> {
    store: Map<string, Payload>;
    calls: string[];
}

function fakeNamespace(initial: Record<string, Payload>, opts: { failImportFor?: string } = {}): FakeNamespace {
    const store = new Map(Object.entries(initial));
    const calls: string[] = [];
    return {
        store, calls,
        idFromName: (n) => n,
        get: (name) => ({
            fetch: async (url, init) => {
                calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname} ${name}`);
                if (new URL(url).pathname === '/state-export') {
                    return Response.json(store.get(name) ?? { ydoc: null, identity: null, snapshots: [] });
                }
                if (name === opts.failImportFor) return new Response('boom', { status: 500 });
                if (store.get(name)?.ydoc) return new Response('target not empty', { status: 409 });
                store.set(name, JSON.parse(String(init?.body)) as Payload);
                return Response.json({ ok: true });
            },
        }),
    };
}

const ref = (t: string, r: string): CollabDocRef => ({ tenantId: t, reportId: r });
const doc = (marker: string): Payload => ({ ydoc: marker, identity: { tenantId: 't', inspectionId: 'i' }, snapshots: [] });

describe('migrateCollabDocs', () => {
    it('copies each document to the object of the same name in the pinned namespace', async () => {
        const from = fakeNamespace({ [collabDocName('t1', 'r1')]: doc('AAA'), [collabDocName('t1', 'r2')]: doc('BBB') });
        const to = fakeNamespace({});
        const out = await migrateCollabDocs([ref('t1', 'r1'), ref('t1', 'r2')], from, to, { dryRun: false });
        expect(out).toMatchObject({ total: 2, copied: 2, alreadyThere: 0, empty: 0, failed: [] });
        expect(to.store.get(collabDocName('t1', 'r2'))?.ydoc).toBe('BBB');
    });

    it('is repeatable: a document already in the target is counted, not overwritten', async () => {
        const name = collabDocName('t1', 'r1');
        const from = fakeNamespace({ [name]: doc('OLD') });
        const to = fakeNamespace({ [name]: doc('NEWER') });
        const out = await migrateCollabDocs([ref('t1', 'r1')], from, to, { dryRun: false });
        expect(out).toMatchObject({ copied: 0, alreadyThere: 1, failed: [] });
        expect(to.store.get(name)?.ydoc).toBe('NEWER');
    });

    it('skips an object with no stored document without writing to the target', async () => {
        const from = fakeNamespace({});
        const to = fakeNamespace({});
        const out = await migrateCollabDocs([ref('t1', 'r1')], from, to, { dryRun: false });
        expect(out).toMatchObject({ copied: 0, empty: 1 });
        expect(to.calls).toEqual([]);
    });

    it('dry run only counts: it touches neither namespace', async () => {
        const from = fakeNamespace({ [collabDocName('t1', 'r1')]: doc('AAA') });
        const to = fakeNamespace({});
        const out = await migrateCollabDocs([ref('t1', 'r1')], from, to, { dryRun: true });
        expect(out).toMatchObject({ total: 1, copied: 0, wouldCopy: 1 });
        expect(from.calls).toEqual([]);
        expect(to.calls).toEqual([]);
    });

    it('names the failed document and carries on with the rest', async () => {
        const bad = collabDocName('t1', 'r1');
        const from = fakeNamespace({ [bad]: doc('AAA'), [collabDocName('t1', 'r2')]: doc('BBB') });
        const to = fakeNamespace({}, { failImportFor: bad });
        const out = await migrateCollabDocs([ref('t1', 'r1'), ref('t1', 'r2')], from, to, { dryRun: false });
        expect(out.copied).toBe(1);
        expect(out.failed).toEqual([`${bad}: import returned 500`]);
    });

    it('never mixes tenants: the object name carries the tenant', async () => {
        const from = fakeNamespace({ [collabDocName('t1', 'r1')]: doc('T1'), [collabDocName('t2', 'r1')]: doc('T2') });
        const to = fakeNamespace({});
        await migrateCollabDocs([ref('t2', 'r1')], from, to, { dryRun: false });
        expect([...to.store.keys()]).toEqual([collabDocName('t2', 'r1')]);
    });
});
