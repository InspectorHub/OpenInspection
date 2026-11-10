/**
 * Moving a collab document between Durable Object ids (workerd).
 *
 * A jurisdiction-pinned object has a different id from the unpinned one with the same name, so its stored state has to be
 * copied across once. Covers: content, identity and restore points arrive intact; a second import is refused so it can never
 * overwrite newer edits (409 with a reason code); a malformed import, including bytes that are not a Yjs document, writes nothing
 * and leaves the object able to take a good import afterwards.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';
import type { StateExport, StateImportBody } from '../../server/durable-objects/inspection-doc-state-transfer';

interface TestBindings {
    INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO>;
}
// The generated Env does not list this binding; a narrowing assertion adds it without going through unknown.
const b = env as typeof env & TestBindings;

const IDENTITY = { tenantId: 't-1', inspectionId: 'i-1', reportId: 'r-1' };
const SNAPSHOTS = [{ seq: 1, atMs: 1700000000000, byUserId: 'u-1', reason: 'manual', projection: { marker: 'restore-point' } }];

function stub(name: string) {
    return b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(name));
}

function sourceBytes(): Uint8Array {
    const doc = new Y.Doc();
    doc.getMap('results').set('finding', 'cracked flashing');
    return Y.encodeStateAsUpdate(doc);
}

async function seedSource(name: string): Promise<Uint8Array> {
    const bytes = sourceBytes();
    await runInDurableObject(stub(name), async (_i, state) => {
        await state.storage.put('ydoc', bytes);
        await state.storage.put('identity', IDENTITY);
        await state.storage.put('snapshots', SNAPSHOTS);
    });
    return bytes;
}

const url = (path: string) => `https://do.test/${path}`;

describe('InspectionDocDO state transfer', () => {
    it('exports content, identity and snapshots, and a fresh object accepts them', async () => {
        const bytes = await seedSource('src-1');
        const exported = await stub('src-1').fetch(url('state-export'));
        expect(exported.status).toBe(200);
        const payload = (await exported.json()) as StateExport;
        expect(payload.identity).toEqual(IDENTITY);
        expect(payload.snapshots).toEqual(SNAPSHOTS);

        const target = stub('dst-1');
        const imported = await target.fetch(url('state-import'), { method: 'POST', body: JSON.stringify(payload) });
        expect(imported.status).toBe(200);

        const stored = await runInDurableObject(target, async (_i, state) => ({
            ydoc: await state.storage.get<Uint8Array>('ydoc'),
            identity: await state.storage.get('identity'),
            snapshots: await state.storage.get('snapshots'),
        }));
        expect(Array.from(stored.ydoc ?? [])).toEqual(Array.from(bytes));
        expect(stored.identity).toEqual(IDENTITY);
        expect(stored.snapshots).toEqual(SNAPSHOTS);
    });

    it('refuses a second import into an object that already holds state, and keeps what it had', async () => {
        await seedSource('src-2');
        const payload = await (await stub('src-2').fetch(url('state-export'))).text();
        const target = stub('dst-2');
        expect((await target.fetch(url('state-import'), { method: 'POST', body: payload })).status).toBe(200);

        const other = JSON.parse(payload) as StateImportBody;
        other.snapshots = [];
        const again = await target.fetch(url('state-import'), { method: 'POST', body: JSON.stringify(other) });
        expect(again.status).toBe(409);
        const kept = await runInDurableObject(target, (_i, state) => state.storage.get('snapshots'));
        expect(kept).toEqual(SNAPSHOTS);
    });

    it('rejects a malformed import and writes nothing', async () => {
        const target = stub('dst-3');
        for (const body of ['not json', JSON.stringify({}), JSON.stringify({ ydoc: 'AAAA' }), JSON.stringify({ ydoc: 'AAAA', identity: { tenantId: 't' } })]) {
            const res = await target.fetch(url('state-import'), { method: 'POST', body });
            expect(res.status).toBe(400);
        }
        const stored = await runInDurableObject(target, (_i, state) => state.storage.get('ydoc'));
        expect(stored).toBeUndefined();
    });

    it('exporting an object with no state returns nulls rather than failing', async () => {
        const res = await stub('src-empty').fetch(url('state-export'));
        const out = await res.json<{ gen: string }>();
        expect(out).toEqual({ ydoc: null, identity: null, snapshots: [], derivedFromD1: false, gen: out.gen });
        expect(out.gen).toMatch(/^[A-Za-z0-9_-]{8,64}$/); // every object names its history, even an empty one
    });

    it('rejects bytes that are not a Yjs document BEFORE writing anything, so the object stays importable', async () => {
        const target = stub('dst-bad-bytes');
        const bad = { ydoc: btoa('this is not a yjs update'), identity: IDENTITY, snapshots: SNAPSHOTS };
        const res = await target.fetch(url('state-import'), { method: 'POST', body: JSON.stringify(bad) });
        expect(res.status).toBe(400);
        const stored = await runInDurableObject(target, (_i, state) => state.storage.list());
        expect([...stored.keys()]).toEqual(['gen']); // only the lineage id every object mints when it first wakes

        await seedSource('src-good');
        const good = await (await stub('src-good').fetch(url('state-export'))).text();
        expect((await target.fetch(url('state-import'), { method: 'POST', body: good })).status).toBe(200);
    });

    it('rejects text that is not base64 and a document with the wrong top-level shape', async () => {
        const target = stub('dst-bad-shape');
        const wrong = new Y.Doc();
        wrong.getMap('somethingElse').set('x', 1);
        for (const ydoc of ['%%%', btoa(String.fromCharCode(...Y.encodeStateAsUpdate(wrong)))]) {
            const res = await target.fetch(url('state-import'), { method: 'POST', body: JSON.stringify({ ydoc, identity: IDENTITY }) });
            expect(res.status).toBe(400);
        }
        expect(await runInDurableObject(target, (_i, state) => state.storage.get('ydoc'))).toBeUndefined();
    });

    it('answers 409 with a distinguishable reason and the target size, and also refuses a target holding only restore points', async () => {
        await seedSource('src-409');
        const payload = await (await stub('src-409').fetch(url('state-export'))).text();

        const holding = stub('dst-409-ydoc');
        // The size to expect is the size of the bytes that were STORED. A fresh sourceBytes() builds a new
        // Y.Doc with a random client id, whose varint is 4 or 5 bytes, so its length differs run to run.
        const stored = await seedSource('dst-409-ydoc');
        const refused = await holding.fetch(url('state-import'), { method: 'POST', body: payload });
        expect(refused.status).toBe(409);
        expect(await refused.json()).toMatchObject({ error: 'target-not-empty', reason: 'target-has-state', targetBytes: stored.length });

        const partial = stub('dst-409-snapshots');
        await runInDurableObject(partial, async (_i, state) => { await state.storage.put('snapshots', SNAPSHOTS); });
        const second = await partial.fetch(url('state-import'), { method: 'POST', body: payload });
        expect(second.status).toBe(409);
        expect(await runInDurableObject(partial, (_i, state) => state.storage.get('ydoc'))).toBeUndefined();
    });
});
